import {
  buildDiscordPacketText,
  type DiscordPacketMessage,
  type DiscordPacketOptions,
} from "./discord-policy";

export function discordBatchEnabled(state: {
  apiKillSwitch: number;
  discordKillSwitch?: number;
  selfPromptPaused?: number;
}): boolean {
  // Both switches must be open. Private reflection pause is deliberately
  // absent from this decision: public Discord queue service is independent.
  return state.apiKillSwitch !== 1 && state.discordKillSwitch !== 1;
}

export async function processDiscordBatchOnce<T extends DiscordPacketMessage>(
  dependencies: {
    claim: (limit: number) => Promise<{ leaseId: string; messages: T[] }>;
    getConversation: (calls: T[]) => Promise<{
      timeline: DiscordPacketMessage[];
      calls: DiscordPacketMessage[];
    }>;
    getPacketOptions?: (guildId: string) => Promise<DiscordPacketOptions>;
    callModel: (prompt: string, messages: T[]) => Promise<string>;
    deliver: (
      reply: string,
      messages: ReadonlyMap<number, T>,
      leaseId: string,
    ) => Promise<void>;
    requeue: (ids: number[], leaseId: string) => Promise<void>;
  },
): Promise<"idle" | "requeued" | "processed"> {
  const claim = await dependencies.claim(10);
  if (claim.messages.length === 0) return "idle";

  const ids = claim.messages.map((message) => message.id);
  try {
    const guildId = claim.messages[0]!.guildId;
    const conversation = await dependencies.getConversation(claim.messages);
    const packetOptions = dependencies.getPacketOptions
      ? await dependencies.getPacketOptions(guildId)
      : {};
    const response = await dependencies.callModel(
      buildDiscordPacketText(conversation.calls, conversation.timeline, false, packetOptions),
      claim.messages,
    );
    if (!response) {
      await dependencies.requeue(ids, claim.leaseId);
      return "requeued";
    }
    await dependencies.deliver(
      response,
      new Map(claim.messages.map((message) => [message.id, message])),
      claim.leaseId,
    );
    return "processed";
  } catch (error) {
    await dependencies.requeue(ids, claim.leaseId).catch(() => {});
    throw error;
  }
}