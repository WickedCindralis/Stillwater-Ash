import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  OAuth2Scopes,
  PermissionsBitField,
  MessageType,
  type Message,
} from "discord.js";
import { randomUUID } from "node:crypto";
import type { AshDiscordChannel, AshDiscordMessage } from "@workspace/db";
import { logger } from "../logger";
import { ashBridge } from "./bridge";
import {
  classifyDiscordMessage,
  DISCORD_OWNER_DM_GUILD_ID,
  isDiscordCall,
  isDiscordPlayerTicketChannel,
  isReplyInAshThread,
  resolveDiscordReplyChain,
} from "./discord-policy";
import type { DiscordPacketMessage } from "./discord-policy";
import { storage } from "./storage";

const MESSAGE_CHARS = 1_600;
const REPLY_CHARS = 1_900;
const SEND_SPACING_MS = 800;

export type DiscordConnectionState =
  | "not_configured"
  | "connecting"
  | "connected"
  | "error";

export type DiscordAvailableChannel = {
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  canRead: boolean;
  canReply: boolean;
  permissionError: string;
};

class DiscordHerald {
  private client: Client | null = null;
  private connectionState: DiscordConnectionState = "not_configured";
  private connectionError = "";
  private connectedAt: Date | null = null;
  private lastSendAtByChannel = new Map<string, number>();
  private retentionTimer: ReturnType<typeof setInterval> | null = null;

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private setError(error: unknown): void {
    this.connectionState = "error";
    this.connectionError = error instanceof Error ? error.message : String(error);
    logger.error({ err: error }, "[discord-herald] Discord connection error");
  }

  async start(): Promise<void> {
    await storage.recoverDiscordDeliveries();
    await storage.pruneDiscordMessages();
    if (!this.retentionTimer) {
      this.retentionTimer = setInterval(() => {
        void Promise.all([
          storage.recoverDiscordDeliveries(),
          storage.pruneDiscordMessages(),
        ]).catch((error) => {
          logger.warn({ err: error }, "[discord-herald] Queue maintenance failed");
        });
      }, 60_000);
      this.retentionTimer.unref();
    }

    const token = process.env["DISCORD_BOT_TOKEN"]?.trim();
    if (!token) {
      this.connectionState = "not_configured";
      this.connectionError = "DISCORD_BOT_TOKEN is not configured";
      logger.warn("[discord-herald] DISCORD_BOT_TOKEN is not set; Discord is disabled");
      return;
    }
    if (this.client) return;

    this.connectionState = "connecting";
    this.connectionError = "";
    if (this.ownerDiscordUserId()) {
      logger.info("[discord-herald] Owner-only Discord DM route configured");
    } else {
      logger.warn("[discord-herald] Owner-only Discord DM route is not configured");
    }
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
        partials: [Partials.Channel],
    });
    this.client = client;

    client.on(Events.ClientReady, (readyClient) => {
      this.connectionState = "connected";
      this.connectionError = "";
      this.connectedAt = new Date();
      logger.info(
        { botUser: readyClient.user.tag, guildCount: readyClient.guilds.cache.size },
        "[discord-herald] Discord bot connected",
      );
      void storage.logActivity("discord", "Discord Court Herald connected").catch(() => {});
    });
    client.on(Events.MessageCreate, (message) => {
      void this.handleMessage(message);
    });
    client.on(Events.Error, (error) => this.setError(error));
    client.on(Events.ShardDisconnect, () => {
      this.connectionState = "connecting";
      this.connectionError = "Discord connection dropped; reconnecting";
    });
    client.on(Events.ShardResume, () => {
      this.connectionState = "connected";
      this.connectionError = "";
      this.connectedAt = new Date();
    });

    try {
      await client.login(token);
    } catch (error) {
      this.setError(error);
      client.destroy();
      this.client = null;
    }
  }

  stop(): void {
    this.client?.destroy();
    this.client = null;
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = null;
    this.connectionState = process.env["DISCORD_BOT_TOKEN"]
      ? "connecting"
      : "not_configured";
  }

  private availableChannels(): DiscordAvailableChannel[] {
    const client = this.client;
    if (!client?.isReady()) return [];
    const channels: DiscordAvailableChannel[] = [];
    for (const guild of client.guilds.cache.values()) {
      const me = guild.members.me;
      for (const channel of guild.channels.cache.values()) {
        if (
          channel.type !== ChannelType.GuildText
          && channel.type !== ChannelType.GuildAnnouncement
        ) continue;
        if (isDiscordPlayerTicketChannel(channel.name)) continue;
        const permissions = me ? channel.permissionsFor(me) : null;
        const canRead = !!permissions?.has([
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.ReadMessageHistory,
        ]);
        const canReply = !!permissions?.has(PermissionsBitField.Flags.SendMessages);
        const missing: string[] = [];
        if (!canRead) missing.push("View Channel + Read Message History");
        if (!canReply) missing.push("Send Messages");
        channels.push({
          guildId: guild.id,
          guildName: guild.name,
          channelId: channel.id,
          channelName: channel.name,
          canRead,
          canReply,
          permissionError: missing.length > 0 ? `Missing ${missing.join(" and ")}` : "",
        });
      }
    }
    return channels.sort((a, b) =>
      a.guildName.localeCompare(b.guildName)
      || a.channelName.localeCompare(b.channelName)
    );
  }

  async getDashboardState(): Promise<{
    connectionState: DiscordConnectionState;
    connectionError: string;
    connectedAt: Date | null;
    botUser: string;
    inviteUrl: string;
    requiredIntent: string;
    requiredPermissions: string[];
    availableChannels: DiscordAvailableChannel[];
    selectedChannels: AshDiscordChannel[];
    activity: AshDiscordMessage[];
    discordKillSwitch: number;
    ownerDmUserId: string;
    ownerDmEnabled: boolean;
  }> {
    const availableChannels = this.availableChannels();
    let selectedChannels = await storage.listDiscordChannels();
    const permittedChannels = selectedChannels.filter(
      (channel) => !isDiscordPlayerTicketChannel(channel.channelName),
    );
    if (permittedChannels.length !== selectedChannels.length) {
      selectedChannels = await storage.replaceDiscordChannels(permittedChannels);
    }
    const [activity, state] = await Promise.all([
      storage.getRecentDiscordActivity(100),
      storage.getState(),
    ]);
    let inviteUrl = "";
    if (this.client?.isReady()) {
      inviteUrl = this.client.generateInvite({
        scopes: [OAuth2Scopes.Bot],
        permissions: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.SendMessages,
        ],
      });
    }
    return {
      connectionState: this.connectionState,
      connectionError: this.connectionError,
      connectedAt: this.connectedAt,
      botUser: this.client?.user?.tag ?? "",
      inviteUrl,
      requiredIntent: "Message Content intent",
      requiredPermissions: ["View Channel", "Read Message History", "Send Messages"],
      availableChannels,
      selectedChannels,
      activity,
      discordKillSwitch: state.discordKillSwitch,
      ownerDmUserId: this.ownerDiscordUserId(),
      ownerDmEnabled: Boolean(this.ownerDiscordUserId()),
    };
  }

  private ownerDiscordUserId(): string {
    return process.env["DISCORD_OWNER_USER_ID"]?.trim() ?? "";
  }

  async setPermittedChannels(
    requested: Array<{ guildId: string; channelId: string }>,
  ): Promise<AshDiscordChannel[]> {
    if (requested.length === 0) return storage.replaceDiscordChannels([]);
    if (this.connectionState !== "connected") {
      throw new Error("Discord must be connected before halls can be selected");
    }
    const available = new Map(
      this.availableChannels().map((channel) => [channel.channelId, channel]),
    );
    const deduped = new Set<string>();
    const selected: Array<Omit<AshDiscordChannel, "id" | "selectedAt">> = [];
    for (const request of requested) {
      if (deduped.has(request.channelId)) continue;
      const channel = available.get(request.channelId);
      if (!channel || channel.guildId !== request.guildId) {
        throw new Error("A selected Discord channel is not available to this bot");
      }
      if (!channel.canRead || !channel.canReply) {
        throw new Error(`#${channel.channelName}: ${channel.permissionError}`);
      }
      deduped.add(channel.channelId);
      selected.push({
        guildId: channel.guildId,
        guildName: channel.guildName,
        channelId: channel.channelId,
        channelName: channel.channelName,
      });
    }
    const saved = await storage.replaceDiscordChannels(selected);
    await storage.logActivity(
      "discord",
      `Discord halls updated — ${saved.length} channel${saved.length === 1 ? "" : "s"} selected`,
    ).catch(() => {});
    return saved;
  }

  private async calledAsh(message: Message<true>): Promise<boolean> {
    const botId = this.client?.user?.id;
    if (isDiscordCall(message.content, !!botId && message.mentions.users.has(botId))) return true;
    if (!botId || message.type !== MessageType.Reply || !message.reference?.messageId) return false;
    try {
      const authorized = await storage.getAuthorizedDiscordChannelMessages(message.guildId, message.channelId);
      const authorizedIds = new Set(authorized.flatMap((entry) =>
        [entry.discordMessageId, entry.replyDiscordMessageId].filter(Boolean)));
      const replyingToAsh = await isReplyInAshThread<Message>(
        message,
        botId,
        (current) => current.fetchReference(),
        (current) => current.type === MessageType.Reply,
        authorizedIds,
      );
      return isDiscordCall(message.content, false, replyingToAsh);
    } catch (error) {
      logger.warn({ err: error, discordMessageId: message.id }, "[discord-herald] Reply target unavailable");
      return false;
    }
  }

  async getConversationContext(
    calls: readonly AshDiscordMessage[],
  ): Promise<{ timeline: DiscordPacketMessage[]; calls: DiscordPacketMessage[] }> {
    if (calls.length === 0) throw new Error("A Discord conversation requires a call");
    const channelId = calls[0]!.channelId;
    if (calls.some((call) => call.channelId !== channelId))
      throw new Error("Discord calls must be grouped by channel");
    const client = this.client;
    if (!client?.isReady()) throw new Error("Discord is not connected");
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !("messages" in channel))
      throw new Error("Discord conversation channel is unavailable");

    const authorized = await storage.getAuthorizedDiscordChannelMessages(calls[0]!.guildId, channelId);
    const authorizedIds = new Set(authorized.flatMap((entry) =>
      [entry.discordMessageId, entry.replyDiscordMessageId].filter(Boolean)));
    // Only fetch IDs retained during opted-in intake. A bulk "latest" request
    // could read pre-selection conversation or resurrect revoked history.
    const newestIds = [...authorizedIds]
      .sort((a, b) => BigInt(a) > BigInt(b) ? -1 : BigInt(a) < BigInt(b) ? 1 : 0);
    const cached = new Map<string, Promise<Message | null>>();
    const fetchMessage = (id: string): Promise<Message | null> => {
      if (!authorizedIds.has(id)) return Promise.resolve(null);
      const existing = cached.get(id);
      if (existing) return existing;
      const pending = channel.messages.fetch(id).catch((error: unknown) => {
        logger.warn({ err: error, channelId, discordMessageId: id },
          "[discord-herald] Authorized Discord message unavailable");
        return null;
      });
      cached.set(id, pending);
      return pending;
    };
    const nameOf = (entry: Message): string =>
      entry.author.id === client.user.id
        ? "Ash"
        : entry.member?.displayName || entry.author.globalName || entry.author.username;
    const ancestorsOf = (entry: Message) => resolveDiscordReplyChain(
      entry,
      fetchMessage,
      channelId,
      client.user.id,
      nameOf,
      (message) => message.type === MessageType.Reply,
    );
    const recent: Message[] = [];
    for (let offset = 0; offset < newestIds.length && recent.length < 20; offset += 20) {
      // Deleted/inaccessible messages must not reduce the window if older
      // authorized messages are still available.
      const batch = await Promise.all(newestIds.slice(offset, offset + 20).map(fetchMessage));
      recent.push(...batch.filter((entry): entry is Message => !!entry && entry.channelId === channelId));
    }
    const timeline = await Promise.all(
      recent.slice(0, 20)
        .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0)
        .map(async (entry): Promise<DiscordPacketMessage> => ({
          id: 0,
          guildId: calls[0]!.guildId,
          channelId,
          discordMessageId: entry.id,
          channelName: calls[0]!.channelName,
          authorName: nameOf(entry),
          content: (entry.content.trim() || (entry.attachments.size ? "(attachment)" : "(message without text)"))
            .slice(0, MESSAGE_CHARS),
          createdAt: new Date(entry.createdTimestamp),
          isAsh: entry.author.id === client.user.id,
          replyChain: await ancestorsOf(entry),
        })),
    );
    const enrichedCalls = await Promise.all(calls.map(async (call): Promise<DiscordPacketMessage> => {
      const original = await fetchMessage(call.discordMessageId);
      return {
        ...call,
        authorName: original ? nameOf(original) : call.authorName,
        replyChain: original ? await ancestorsOf(original) : [],
      };
    }));
    return { timeline, calls: enrichedCalls };
  }

  private async handleMessage(message: Message): Promise<void> {
    // Ash's sent reply is already authorized by its originating delivery ID.
    // Other bots' messages are context, never calls, after channel opt-in.
    if (message.author.bot && message.author.id === this.client?.user?.id) return;
    if (message.channel.isDMBased()) {
      await this.handleOwnerDirectMessage(message);
      return;
    }
    if (!message.inGuild()) return;
    try {
      const result = await storage.withDiscordChannelLock(message.channelId, async () => {
        // Intake and preference changes share this lock. A completed opt-out
        // therefore leaves no newly retained message behind.
        const state = await storage.getState();
        if (state.discordKillSwitch === 1) return null;
        if (!await storage.isDiscordChannelConfigured(message.channelId)) return null;
        const called = !message.author.bot && await this.calledAsh(message);
        const kind = classifyDiscordMessage(called, message.author.id, message.guild.ownerId);
        const deliveryStatus = kind === "owner_call"
          ? "processing"
          : kind === "call"
            ? "queued"
            : "context";
        const rawContent = message.content.trim()
          || (message.attachments.size ? "(attachment)"
            : called ? "(called Ash without additional text)" : "(message without text)");
        const deliveryLeaseId = kind === "owner_call" ? randomUUID() : "";
        const deliveryLeaseExpiresAt = kind === "owner_call"
          ? new Date(Date.now() + 10 * 60_000)
          : null;

        const stored = await storage.recordDiscordMessage({
          discordMessageId: message.id,
          guildId: message.guildId,
          channelId: message.channelId,
          channelName: "name" in message.channel ? message.channel.name : "",
          authorId: message.author.id,
          authorName: message.member?.displayName || message.author.globalName || message.author.username,
          content: rawContent.slice(0, MESSAGE_CHARS),
          kind,
          deliveryStatus,
          deliveryLeaseId,
          deliveryLeaseExpiresAt,
          createdAt: new Date(message.createdTimestamp),
        });
        return { ...stored, kind };
      });
      if (!result) return;
      const { message: stored, created, kind } = result;
      if (!created) return;
      await storage.pruneDiscordMessages();

      if (kind === "owner_call") {
        await ashBridge.handleDiscordOwnerCall(stored);
      } else if (kind === "call") {
        await storage.logActivity(
          "discord",
          `Discord call queued from ${stored.authorName} in #${stored.channelName}`,
        ).catch(() => {});
      }
    } catch (error) {
      logger.error(
        { err: error, guildId: message.guildId, channelId: message.channelId },
        "[discord-herald] Failed to process Discord message",
      );
    }
  }

  private async handleOwnerDirectMessage(message: Message): Promise<void> {
    const ownerUserId = this.ownerDiscordUserId();
    if (!ownerUserId || message.author.id !== ownerUserId) {
      logger.info(
        { discordUserId: message.author.id },
        "[discord-herald] Ignored DM from non-owner Discord user",
      );
      return;
    }

    try {
      const result = await storage.withDiscordChannelLock(message.channelId, async () => {
        const state = await storage.getState();
        if (state.discordKillSwitch === 1) return null;

        const deliveryLeaseId = randomUUID();
        const stored = await storage.recordDiscordMessage({
          discordMessageId: message.id,
          guildId: DISCORD_OWNER_DM_GUILD_ID,
          channelId: message.channelId,
          channelName: "Direct Message",
          authorId: message.author.id,
          authorName: message.author.globalName || message.author.username,
          content: (message.content.trim() || "(sent an empty message)").slice(0, MESSAGE_CHARS),
          kind: "owner_call",
          deliveryStatus: "processing",
          deliveryLeaseId,
          deliveryLeaseExpiresAt: new Date(Date.now() + 10 * 60_000),
          createdAt: new Date(message.createdTimestamp),
        });
        return stored;
      });

      if (!result || !result.created) return;
      await storage.createMessage({
        role: "wicked",
        content: result.message.content,
        imageUrl: "",
        source: "discord_owner",
      }).catch((error) => {
        logger.warn({ err: error, discordMessageId: message.id }, "[discord-herald] Failed to record owner DM history");
      });
      await storage.pruneDiscordMessages();
      await ashBridge.handleDiscordOwnerCall(result.message);
    } catch (error) {
      logger.error(
        { err: error, channelId: message.channelId, discordMessageId: message.id },
        "[discord-herald] Failed to process owner Discord DM",
      );
    }
  }

  async deliverDraft(messageId: number, replyText: string, leaseId: string): Promise<boolean> {
    const message = await storage.beginDiscordDelivery(messageId, leaseId);
    if (!message) return false;

    try {
      return await storage.withDiscordChannelLock(message.channelId, async () => {
        // Re-read the fenced state after acquiring the channel lock. Recovery,
        // another worker, or a completed opt-out may have invalidated this send.
        const current = await storage.getDiscordMessageById(message.id);
        if (
          !current
          || current.deliveryStatus !== "sending"
          || current.deliveryLeaseId !== leaseId
        ) return false;
        const state = await storage.getState();
        if (state.discordKillSwitch === 1) {
          await storage.failDiscordDelivery(message.id, leaseId, "Discord bridge is switched off");
          return false;
        }
        if (
          message.guildId !== DISCORD_OWNER_DM_GUILD_ID
          && !await storage.isDiscordChannelConfigured(message.channelId)
        ) {
          await storage.failDiscordDelivery(message.id, leaseId, "Channel is no longer selected");
          return false;
        }
        const client = this.client;
        if (!client?.isReady()) {
          await storage.failDiscordDelivery(message.id, leaseId, "Discord is not connected");
          return false;
        }

        const lastSent = this.lastSendAtByChannel.get(message.channelId) ?? 0;
        const waitMs = SEND_SPACING_MS - (Date.now() - lastSent);
        if (waitMs > 0) await this.sleep(waitMs);

        let replyId = "";
        if (message.guildId === DISCORD_OWNER_DM_GUILD_ID) {
          const user = await client.users.fetch(message.authorId);
          const dmChannel = await user.createDM();
          const reply = await dmChannel.send({
            content: replyText.trim().slice(0, REPLY_CHARS),
            allowedMentions: { repliedUser: false, parse: [] },
          });
          replyId = reply.id;
        } else {
          const channel = await client.channels.fetch(message.channelId);
          if (
            !channel
            || !channel.isTextBased()
            || channel.isDMBased()
            || !("messages" in channel)
          ) throw new Error("Selected Discord channel is unavailable");
          const original = await channel.messages.fetch(message.discordMessageId);
          const reply = await original.reply({
            content: replyText.trim().slice(0, REPLY_CHARS),
            allowedMentions: { repliedUser: false, parse: [] },
          });
          replyId = reply.id;
        }
        this.lastSendAtByChannel.set(message.channelId, Date.now());
        const completed = await storage.completeDiscordDelivery(message.id, leaseId, replyId);
        if (completed && message.guildId === DISCORD_OWNER_DM_GUILD_ID) {
          await storage.createMessage({
            role: "ash",
            content: replyText.trim().slice(0, REPLY_CHARS),
            imageUrl: "",
            source: "discord_owner",
          }).catch((error) => {
            logger.warn({ err: error, discordMessageId: message.discordMessageId }, "[discord-herald] Failed to record Ash owner DM history");
          });
        }
        await storage.logActivity(
          "discord",
          message.guildId === DISCORD_OWNER_DM_GUILD_ID
            ? "Ash replied to owner Discord DM"
            : `Ash replied in #${message.channelName} to ${message.authorName}`,
        ).catch(() => {});
        return true;
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await storage.failDiscordDelivery(message.id, leaseId, detail).catch(() => {});
      logger.warn(
        { err: error, channelId: message.channelId, discordMessageId: message.discordMessageId },
        "[discord-herald] Discord reply delivery failed",
      );
      return false;
    }
  }
}

export const discordHerald = new DiscordHerald();