import {
  db,
  ashState,
  ashMessages,
  ashDiaryEntries,
  ashActivity,
  ashChessGames,
  ashConnect4Games,
  type AshChessGame,
  type AshConnect4Game,
  type AshState,
  type AshMessage,
  type InsertMessage,
  type AshDiaryEntry,
  type InsertDiaryEntry,
  type AshActivity,
  ashTiktokComments,
  type AshTiktokComment,
  ashDiscordChannels,
  ashDiscordMessages,
  type AshDiscordChannel,
  type AshDiscordMessage,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import { eq, desc, inArray, and, like, lt, gt, isNull, notInArray, or, sql } from "drizzle-orm";
import { isDiscordPlayerTicketChannel } from "./discord-policy";

const ASH_ID = "ash";

export interface IStorage {
  getState(): Promise<AshState>;
  updateState(patch: Partial<Omit<AshState, "id">>): Promise<AshState>;
  appendAshNote(entry: string, maxChars: number): Promise<{ saved: boolean; length: number }>;
  getMessages(limit?: number, beforeId?: number): Promise<AshMessage[]>;
  getAllMessages(): Promise<AshMessage[]>;
  purgeMessagesKeepLast(keep: number): Promise<number>;
  getMessageById(id: number): Promise<AshMessage | null>;
  clearWickedPhotos(): Promise<number>;
  createMessage(msg: InsertMessage): Promise<AshMessage>;
  getRecentHistory(limit: number): Promise<AshMessage[]>;
  getDiaryEntries(): Promise<AshDiaryEntry[]>;
  createDiaryEntry(entry: InsertDiaryEntry): Promise<AshDiaryEntry>;
  deleteDiaryEntry(id: number): Promise<void>;
  logActivity(kind: string, message: string): Promise<void>;
  getActivity(limit?: number): Promise<AshActivity[]>;
  migrateReflectionsToDiary(): Promise<number>;
  getCurrentChessGame(): Promise<AshChessGame | null>;
  createChessGame(fen: string): Promise<AshChessGame>;
  updateChessGame(
    id: number,
    patch: Partial<Omit<AshChessGame, "id" | "createdAt">>,
  ): Promise<AshChessGame>;
  getCurrentConnect4Game(): Promise<AshConnect4Game | null>;
  createConnect4Game(): Promise<AshConnect4Game>;
  updateConnect4Game(
    id: number,
    patch: Partial<Omit<AshConnect4Game, "id" | "createdAt">>,
  ): Promise<AshConnect4Game>;
  listTiktokComments(limit?: number): Promise<AshTiktokComment[]>;
  updateTiktokComment(
    id: number,
    patch: Partial<Pick<AshTiktokComment, "status" | "draft">>,
  ): Promise<AshTiktokComment | null>;
  getUnseenTiktokComments(limit: number): Promise<AshTiktokComment[]>;
  claimTiktokComments(ids: number[]): Promise<AshTiktokComment[]>;
  releaseTiktokCommentsClaim(ids: number[]): Promise<void>;
  listDiscordChannels(): Promise<AshDiscordChannel[]>;
  replaceDiscordChannels(channels: Array<Omit<AshDiscordChannel, "id" | "selectedAt">>): Promise<AshDiscordChannel[]>;
  isDiscordChannelConfigured(channelId: string): Promise<boolean>;
  recordDiscordMessage(
    message: Omit<AshDiscordMessage, "id" | "recordedAt" | "updatedAt" | "replyDiscordMessageId" | "deliveryError">,
  ): Promise<{ message: AshDiscordMessage; created: boolean }>;
  getDiscordMessageById(id: number): Promise<AshDiscordMessage | null>;
  claimDiscordMentions(limit: number): Promise<{ leaseId: string; messages: AshDiscordMessage[] }>;
  requeueDiscordMessages(ids: number[], leaseId: string): Promise<void>;
  recoverDiscordDeliveries(): Promise<void>;
  markDiscordMessagesSkipped(ids: number[], leaseId: string): Promise<void>;
  beginDiscordDelivery(id: number, leaseId: string): Promise<AshDiscordMessage | null>;
  completeDiscordDelivery(id: number, leaseId: string, replyDiscordMessageId: string): Promise<boolean>;
  failDiscordDelivery(id: number, leaseId: string, error: string): Promise<boolean>;
  withDiscordChannelLock<T>(channelId: string, work: () => Promise<T>): Promise<T>;
  getRecentDiscordContext(guildId: string, limit: number): Promise<AshDiscordMessage[]>;
  getRecentDiscordOwnerCalls(guildId: string, limit: number): Promise<AshDiscordMessage[]>;
  getRecentDiscordActivity(limit?: number): Promise<AshDiscordMessage[]>;
  pruneDiscordMessages(maxRows?: number): Promise<void>;
}

export class DbStorage implements IStorage {
  async getState(): Promise<AshState> {
    const rows = await db
      .select()
      .from(ashState)
      .where(eq(ashState.id, ASH_ID));
    if (rows.length === 0) {
      const inserted = await db
        .insert(ashState)
        .values({ id: ASH_ID })
        .returning();
      return inserted[0]!;
    }
    return rows[0]!;
  }

  async updateState(patch: Partial<Omit<AshState, "id">>): Promise<AshState> {
    const rows = await db
      .update(ashState)
      .set(patch)
      .where(eq(ashState.id, ASH_ID))
      .returning();
    return rows[0]!;
  }

  // Append one dated entry without risking a read/modify/write race. If the
  // resulting Notes section would exceed its allowance, leave it untouched.
  async appendAshNote(entry: string, maxChars: number): Promise<{ saved: boolean; length: number }> {
    const nextNotes = sql<string>`CASE
      WHEN ${ashState.personaAshNotes} = '' THEN ${entry}
      ELSE ${ashState.personaAshNotes} || ${"\n\n"} || ${entry}
    END`;
    const rows = await db
      .update(ashState)
      .set({ personaAshNotes: nextNotes })
      .where(and(
        eq(ashState.id, ASH_ID),
        sql`char_length(${nextNotes}) <= ${maxChars}`,
      ))
      .returning({ notes: ashState.personaAshNotes });
    if (rows[0]) return { saved: true, length: rows[0].notes.length };
    const state = await this.getState();
    return { saved: false, length: state.personaAshNotes.length };
  }

  async getMessages(limit = 200, beforeId?: number): Promise<AshMessage[]> {
    // The live chat only ever shows direct exchange between Wicked and Ash.
    // Proactive reflective-window output lives in the diary, not here.
    // `beforeId` pages further back in history (messages older than that id).
    const where = beforeId
      ? and(eq(ashMessages.source, "private_message"), lt(ashMessages.id, beforeId))
      : eq(ashMessages.source, "private_message");
    const rows = await db
      .select()
      .from(ashMessages)
      .where(where)
      .orderBy(desc(ashMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  async getAllMessages(): Promise<AshMessage[]> {
    return db
      .select()
      .from(ashMessages)
      .where(eq(ashMessages.source, "private_message"))
      .orderBy(ashMessages.id);
  }

  async purgeMessagesKeepLast(keep: number): Promise<number> {
    const recent = await db
      .select({ id: ashMessages.id })
      .from(ashMessages)
      .where(eq(ashMessages.source, "private_message"))
      .orderBy(desc(ashMessages.id))
      .limit(keep);
    const cutoff = recent.length > 0 ? recent[recent.length - 1]!.id : null;
    if (cutoff === null) return 0;
    const gone = await db
      .delete(ashMessages)
      .where(
        and(eq(ashMessages.source, "private_message"), lt(ashMessages.id, cutoff)),
      )
      .returning({ id: ashMessages.id });
    return gone.length;
  }

  async getMessageById(id: number): Promise<AshMessage | null> {
    const rows = await db
      .select()
      .from(ashMessages)
      .where(eq(ashMessages.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async createMessage(msg: InsertMessage): Promise<AshMessage> {
    const rows = await db.insert(ashMessages).values(msg).returning();
    return rows[0]!;
  }

  async getRecentHistory(limit: number): Promise<AshMessage[]> {
    // Context for replies is the live conversation only; reflections are private diary.
    const rows = await db
      .select()
      .from(ashMessages)
      .where(eq(ashMessages.source, "private_message"))
      .orderBy(desc(ashMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  async getDiaryEntries(): Promise<AshDiaryEntry[]> {
    return db.select().from(ashDiaryEntries).orderBy(desc(ashDiaryEntries.id));
  }

  async createDiaryEntry(entry: InsertDiaryEntry): Promise<AshDiaryEntry> {
    const rows = await db.insert(ashDiaryEntries).values(entry).returning();
    return rows[0]!;
  }

  async deleteDiaryEntry(id: number): Promise<void> {
    await db.delete(ashDiaryEntries).where(eq(ashDiaryEntries.id, id));
  }

  async logActivity(kind: string, message: string): Promise<void> {
    await db.insert(ashActivity).values({ kind, message });
  }

  async getActivity(limit = 100): Promise<AshActivity[]> {
    return db
      .select()
      .from(ashActivity)
      .orderBy(desc(ashActivity.id))
      .limit(limit);
  }

  // One-time, idempotent: move any legacy proactive "reflection" chat rows into the
  // diary (preserving their original timestamps) without deleting the originals. The
  // source is retagged so they no longer surface in the live chat and are never
  // re-copied on a later boot. Runs on startup, so each deployment self-heals.
  async clearWickedPhotos(): Promise<number> {
    // Summer Palace rule: Ash sees Wicked's photos once, then they are gone.
    // One-time cleanup for photos stored before this rule existed.
    const rows = await db
      .update(ashMessages)
      .set({ imageUrl: "" })
      .where(
        and(eq(ashMessages.role, "wicked"), like(ashMessages.imageUrl, "data:%")),
      )
      .returning({ id: ashMessages.id });
    return rows.length;
  }

  async migrateReflectionsToDiary(): Promise<number> {
    const stale = await db
      .select()
      .from(ashMessages)
      .where(eq(ashMessages.source, "self_prompt"))
      .orderBy(ashMessages.id);
    if (stale.length === 0) return 0;
    const ids = stale.map((m) => m.id);
    await db.transaction(async (tx) => {
      for (const m of stale) {
        await tx
          .insert(ashDiaryEntries)
          .values({ content: m.content, createdAt: m.createdAt });
      }
      // Retag only the exact rows we copied, so nothing created mid-migration is swept up.
      await tx
        .update(ashMessages)
        .set({ source: "self_prompt_archived" })
        .where(inArray(ashMessages.id, ids));
    });
    return stale.length;
  }

  // ── Chess ──
  async getCurrentChessGame(): Promise<AshChessGame | null> {
    const rows = await db
      .select()
      .from(ashChessGames)
      .orderBy(desc(ashChessGames.id))
      .limit(1);
    return rows[0] ?? null;
  }

  async createChessGame(fen: string): Promise<AshChessGame> {
    const rows = await db.insert(ashChessGames).values({ fen }).returning();
    return rows[0]!;
  }

  async updateChessGame(
    id: number,
    patch: Partial<Omit<AshChessGame, "id" | "createdAt">>,
  ): Promise<AshChessGame> {
    const rows = await db
      .update(ashChessGames)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(ashChessGames.id, id))
      .returning();
    return rows[0]!;
  }
  // ── Connect Four ──
  async getCurrentConnect4Game(): Promise<AshConnect4Game | null> {
    const rows = await db
      .select()
      .from(ashConnect4Games)
      .orderBy(desc(ashConnect4Games.id))
      .limit(1);
    return rows[0] ?? null;
  }

  async createConnect4Game(): Promise<AshConnect4Game> {
    const rows = await db.insert(ashConnect4Games).values({}).returning();
    return rows[0]!;
  }

  async updateConnect4Game(
    id: number,
    patch: Partial<Omit<AshConnect4Game, "id" | "createdAt">>,
  ): Promise<AshConnect4Game> {
    const rows = await db
      .update(ashConnect4Games)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(ashConnect4Games.id, id))
      .returning();
    return rows[0]!;
  }

  // ── Court Herald (TikTok comments, read-only) ──
  async listTiktokComments(limit = 500): Promise<AshTiktokComment[]> {
    return db
      .select()
      .from(ashTiktokComments)
      .orderBy(desc(ashTiktokComments.commentCreatedAt), desc(ashTiktokComments.id))
      .limit(limit);
  }

  async updateTiktokComment(
    id: number,
    patch: Partial<Pick<AshTiktokComment, "status" | "draft">>,
  ): Promise<AshTiktokComment | null> {
    const rows = await db
      .update(ashTiktokComments)
      .set(patch)
      .where(eq(ashTiktokComments.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async getUnseenTiktokComments(limit: number): Promise<AshTiktokComment[]> {
    return db
      .select()
      .from(ashTiktokComments)
      .where(eq(ashTiktokComments.seenByAsh, 0))
      .orderBy(ashTiktokComments.id)
      .limit(limit);
  }

  // Atomically claim only the rows already selected for the packet. The
  // seen=0 guard guarantees concurrent messages cannot claim the same comment.
  async claimTiktokComments(ids: number[]): Promise<AshTiktokComment[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .update(ashTiktokComments)
      .set({ seenByAsh: 1 })
      .where(and(
        inArray(ashTiktokComments.id, ids),
        eq(ashTiktokComments.seenByAsh, 0),
      ))
      .returning();
    return rows.sort((a, b) => a.id - b.id);
  }

  // Delivery failed — put the comments back so the next message carries them.
  async releaseTiktokCommentsClaim(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await db
      .update(ashTiktokComments)
      .set({ seenByAsh: 0 })
      .where(inArray(ashTiktokComments.id, ids));
  }

  // ── Discord Court Herald ──
  async listDiscordChannels(): Promise<AshDiscordChannel[]> {
    return db
      .select()
      .from(ashDiscordChannels)
      .orderBy(ashDiscordChannels.guildName, ashDiscordChannels.channelName);
  }

  async replaceDiscordChannels(
    channels: Array<Omit<AshDiscordChannel, "id" | "selectedAt">>,
  ): Promise<AshDiscordChannel[]> {
    const permittedChannels = channels.filter(
      (channel) => !isDiscordPlayerTicketChannel(channel.channelName),
    );
    await db.transaction(async (tx) => {
      // One global config lock serializes concurrent settings saves. Per-channel
      // locks then make the save wait for already-authorized intake/delivery.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-discord-config'))`);
      const current = await tx
        .select({ channelId: ashDiscordChannels.channelId })
        .from(ashDiscordChannels);
      const lockIds = [...new Set([
        ...current.map((channel) => channel.channelId),
        ...permittedChannels.map((channel) => channel.channelId),
      ])].sort();
      for (const channelId of lockIds) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${channelId}))`);
      }

      await tx.delete(ashDiscordChannels);
      if (permittedChannels.length > 0) {
        await tx.insert(ashDiscordChannels).values(permittedChannels);
      }

      // Revoking a hall also revokes and erases its retained public context.
      // This makes the opt-in boundary true for both future and historic reads.
      if (permittedChannels.length === 0) {
        await tx.delete(ashDiscordMessages);
      } else {
        const selectedIds = permittedChannels.map((channel) => channel.channelId);
        await tx.delete(ashDiscordMessages).where(
          notInArray(ashDiscordMessages.channelId, selectedIds),
        );
      }
    });
    return this.listDiscordChannels();
  }

  async isDiscordChannelConfigured(channelId: string): Promise<boolean> {
    const rows = await db
      .select({
        id: ashDiscordChannels.id,
        channelName: ashDiscordChannels.channelName,
      })
      .from(ashDiscordChannels)
      .where(eq(ashDiscordChannels.channelId, channelId))
      .limit(1);
    return rows.length > 0 && !isDiscordPlayerTicketChannel(rows[0]!.channelName);
  }

  async recordDiscordMessage(
    message: Omit<AshDiscordMessage, "id" | "recordedAt" | "updatedAt" | "replyDiscordMessageId" | "deliveryError">,
  ): Promise<{ message: AshDiscordMessage; created: boolean }> {
    const rows = await db
      .insert(ashDiscordMessages)
      .values(message)
      .onConflictDoNothing({ target: ashDiscordMessages.discordMessageId })
      .returning();
    if (rows[0]) return { message: rows[0], created: true };
    const existing = await db
      .select()
      .from(ashDiscordMessages)
      .where(eq(ashDiscordMessages.discordMessageId, message.discordMessageId))
      .limit(1);
    if (!existing[0]) throw new Error("Discord message insert conflicted without an existing row");
    return { message: existing[0], created: false };
  }

  async getDiscordMessageById(id: number): Promise<AshDiscordMessage | null> {
    const rows = await db
      .select()
      .from(ashDiscordMessages)
      .where(eq(ashDiscordMessages.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async claimDiscordMentions(limit: number): Promise<{ leaseId: string; messages: AshDiscordMessage[] }> {
    const firstPending = await db
      .select({ guildId: ashDiscordMessages.guildId })
      .from(ashDiscordMessages)
      .where(eq(ashDiscordMessages.deliveryStatus, "queued"))
      .orderBy(ashDiscordMessages.id)
      .limit(1);
    if (!firstPending[0]) return { leaseId: "", messages: [] };
    const pending = await db
      .select({ id: ashDiscordMessages.id })
      .from(ashDiscordMessages)
      .where(and(
        eq(ashDiscordMessages.deliveryStatus, "queued"),
        eq(ashDiscordMessages.guildId, firstPending[0].guildId),
      ))
      .orderBy(ashDiscordMessages.id)
      .limit(limit);
    if (pending.length === 0) return { leaseId: "", messages: [] };
    const ids = pending.map((row) => row.id);
    const leaseId = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + 10 * 60_000);
    const claimed = await db
      .update(ashDiscordMessages)
      .set({
        deliveryStatus: "processing",
        deliveryError: "",
        deliveryLeaseId: leaseId,
        deliveryLeaseExpiresAt: leaseExpiresAt,
        updatedAt: new Date(),
      })
      .where(and(
        inArray(ashDiscordMessages.id, ids),
        eq(ashDiscordMessages.deliveryStatus, "queued"),
      ))
      .returning();
    return { leaseId, messages: claimed.sort((a, b) => a.id - b.id) };
  }

  async requeueDiscordMessages(ids: number[], leaseId: string): Promise<void> {
    if (ids.length === 0) return;
    await db
      .update(ashDiscordMessages)
      .set({
        deliveryStatus: "queued",
        deliveryError: "",
        deliveryLeaseId: "",
        deliveryLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        inArray(ashDiscordMessages.id, ids),
        eq(ashDiscordMessages.deliveryStatus, "processing"),
        eq(ashDiscordMessages.deliveryLeaseId, leaseId),
      ));
  }

  async recoverDiscordDeliveries(): Promise<void> {
    const now = new Date();
    const expired = or(
      isNull(ashDiscordMessages.deliveryLeaseExpiresAt),
      lt(ashDiscordMessages.deliveryLeaseExpiresAt, now),
    );
    await db.transaction(async (tx) => {
      // Only expired claims are recoverable. An older instance with a live
      // lease retains ownership and remains the only process allowed to send.
      await tx
        .update(ashDiscordMessages)
        .set({
          deliveryStatus: "queued",
          deliveryError: "",
          deliveryLeaseId: "",
          deliveryLeaseExpiresAt: null,
          updatedAt: now,
        })
        .where(and(eq(ashDiscordMessages.deliveryStatus, "processing"), expired));
      // Once sending begins, a crash leaves the remote outcome unknowable. Do
      // not retry automatically: avoiding a duplicate public reply is safer.
      await tx
        .update(ashDiscordMessages)
        .set({
          deliveryStatus: "failed",
          deliveryError: "Delivery outcome unknown after restart; not retried to avoid a duplicate reply",
          deliveryLeaseId: "",
          deliveryLeaseExpiresAt: null,
          updatedAt: now,
        })
        .where(and(eq(ashDiscordMessages.deliveryStatus, "sending"), expired));
    });
  }

  async markDiscordMessagesSkipped(ids: number[], leaseId: string): Promise<void> {
    if (ids.length === 0) return;
    await db
      .update(ashDiscordMessages)
      .set({
        deliveryStatus: "skipped",
        deliveryLeaseId: "",
        deliveryLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        inArray(ashDiscordMessages.id, ids),
        eq(ashDiscordMessages.deliveryStatus, "processing"),
        eq(ashDiscordMessages.deliveryLeaseId, leaseId),
      ));
  }

  async beginDiscordDelivery(id: number, leaseId: string): Promise<AshDiscordMessage | null> {
    const rows = await db
      .update(ashDiscordMessages)
      .set({ deliveryStatus: "sending", deliveryError: "", updatedAt: new Date() })
      .where(and(
        eq(ashDiscordMessages.id, id),
        eq(ashDiscordMessages.deliveryStatus, "processing"),
        eq(ashDiscordMessages.deliveryLeaseId, leaseId),
        gt(ashDiscordMessages.deliveryLeaseExpiresAt, new Date()),
      ))
      .returning();
    return rows[0] ?? null;
  }

  async completeDiscordDelivery(
    id: number,
    leaseId: string,
    replyDiscordMessageId: string,
  ): Promise<boolean> {
    const rows = await db
      .update(ashDiscordMessages)
      .set({
        deliveryStatus: "replied",
        replyDiscordMessageId,
        deliveryError: "",
        deliveryLeaseId: "",
        deliveryLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(ashDiscordMessages.id, id),
        eq(ashDiscordMessages.deliveryStatus, "sending"),
        eq(ashDiscordMessages.deliveryLeaseId, leaseId),
      ))
      .returning({ id: ashDiscordMessages.id });
    return rows.length === 1;
  }

  async failDiscordDelivery(id: number, leaseId: string, error: string): Promise<boolean> {
    const rows = await db
      .update(ashDiscordMessages)
      .set({
        deliveryStatus: "failed",
        deliveryError: error.slice(0, 500),
        deliveryLeaseId: "",
        deliveryLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(ashDiscordMessages.id, id),
        inArray(ashDiscordMessages.deliveryStatus, ["processing", "sending"]),
        eq(ashDiscordMessages.deliveryLeaseId, leaseId),
      ))
      .returning({ id: ashDiscordMessages.id });
    return rows.length === 1;
  }

  async withDiscordChannelLock<T>(
    channelId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${channelId}))`);
      return work();
    });
  }

  async getRecentDiscordContext(guildId: string, limit: number): Promise<AshDiscordMessage[]> {
    const selected = await this.listDiscordChannels();
    if (selected.length === 0) return [];
    const rows = await db
      .select()
      .from(ashDiscordMessages)
      .where(and(
        eq(ashDiscordMessages.guildId, guildId),
        inArray(ashDiscordMessages.channelId, selected.map((channel) => channel.channelId)),
      ))
      .orderBy(desc(ashDiscordMessages.createdAt), desc(ashDiscordMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  async getRecentDiscordOwnerCalls(guildId: string, limit: number): Promise<AshDiscordMessage[]> {
    const selected = await this.listDiscordChannels();
    if (selected.length === 0) return [];
    const rows = await db
      .select()
      .from(ashDiscordMessages)
      .where(and(
        eq(ashDiscordMessages.guildId, guildId),
        eq(ashDiscordMessages.kind, "owner_call"),
        inArray(ashDiscordMessages.channelId, selected.map((channel) => channel.channelId)),
      ))
      .orderBy(desc(ashDiscordMessages.createdAt), desc(ashDiscordMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  async getRecentDiscordActivity(limit = 100): Promise<AshDiscordMessage[]> {
    const selected = await this.listDiscordChannels();
    if (selected.length === 0) return [];
    const rows = await db
      .select()
      .from(ashDiscordMessages)
      .where(and(
        inArray(ashDiscordMessages.channelId, selected.map((channel) => channel.channelId)),
        inArray(ashDiscordMessages.kind, ["call", "owner_call"]),
      ))
      .orderBy(desc(ashDiscordMessages.createdAt), desc(ashDiscordMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  async pruneDiscordMessages(maxRows = 500): Promise<void> {
    const oldestAllowed = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const finalized = notInArray(
      ashDiscordMessages.deliveryStatus,
      ["queued", "processing", "sending"],
    );
    await db
      .delete(ashDiscordMessages)
      .where(and(
        lt(ashDiscordMessages.recordedAt, oldestAllowed),
        finalized,
      ));

    const retained = await db
      .select({ id: ashDiscordMessages.id })
      .from(ashDiscordMessages)
      .where(finalized)
      .orderBy(desc(ashDiscordMessages.id))
      .limit(maxRows);
    if (retained.length === maxRows) {
      await db
        .delete(ashDiscordMessages)
        .where(and(
          lt(ashDiscordMessages.id, retained[retained.length - 1]!.id),
          finalized,
        ));
    }
  }
}

export const storage = new DbStorage();


