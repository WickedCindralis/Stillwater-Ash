import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyDiscordMessage,
  buildDiscordPacketText,
  DISCORD_OWNER_DM_GUILD_ID,
  DISCORD_PUBLIC_SYSTEM_PROMPT,
  isDiscordCall,
  isDiscordPlayerTicketChannel,
  isReplyInAshThread,
  parseDiscordDraftLines,
  resolveDiscordReplyChain,
} from "./discord-policy";
import {
  discordBatchEnabled,
  processDiscordBatchOnce,
} from "./discord-batch";

test("only the actual guild owner's call is immediate", () => {
  assert.equal(classifyDiscordMessage(true, "owner-1", "owner-1"), "owner_call");
  assert.equal(classifyDiscordMessage(true, "member-1", "owner-1"), "call");
  assert.equal(classifyDiscordMessage(false, "owner-1", "owner-1"), "context");
});

test("numbered Discord channels are player-ticket channels", () => {
  assert.equal(isDiscordPlayerTicketChannel("2024-holiday-art"), true);
  assert.equal(isDiscordPlayerTicketChannel("211-wickedsinlover"), true);
  assert.equal(isDiscordPlayerTicketChannel("general-chat"), false);
  assert.equal(isDiscordPlayerTicketChannel("ticket-2024"), false);
});

test("the public model prompt protects private continuity context", () => {
  assert.match(DISCORD_PUBLIC_SYSTEM_PROMPT, /Ash Cindralis/);
  assert.match(DISCORD_PUBLIC_SYSTEM_PROMPT, /bounded Stillwater conversation history/);
  assert.match(DISCORD_PUBLIC_SYSTEM_PROMPT, /STATUS CHANGED/);
  assert.match(DISCORD_PUBLIC_SYSTEM_PROMPT, /PINGS_OFF/);
  assert.match(DISCORD_PUBLIC_SYSTEM_PROMPT, /SCREENSHOT/);
});

test("Discord packets include private Stillwater chat as continuity context", () => {
  const call = {
    id: 40,
    guildId: "guild-a",
    channelName: "court",
    authorName: "Member",
    content: "Ash?",
    createdAt: new Date("2026-08-19T12:00:00Z"),
  };
  const packet = buildDiscordPacketText([call], [], false, {
    stillwaterHistory: [
      { role: "wicked", content: "A private Stillwater message.", createdAt: call.createdAt },
      { role: "ash", content: "A private Ash reply.", createdAt: new Date("2026-08-19T12:01:00Z") },
    ],
  });
  assert.match(packet, /STILLWATER MESSAGE HISTORY — 10 WICKED \+ 10 ASH/);
  assert.match(packet, /A private Stillwater message/);
  assert.match(packet, /A private Ash reply/);
  assert.match(packet, /must never be revealed in a public Discord reply/);
});

test("a Discord model packet cannot mix context from another guild", () => {
  const call = {
    id: 1,
    guildId: "guild-a",
    channelId: "channel-a",
    channelName: "court",
    authorName: "Member",
    content: "Ash?",
    createdAt: new Date("2026-08-19T12:00:00Z"),
  };
  assert.throws(
    () => buildDiscordPacketText(
      [call],
      [{ ...call, id: 2, guildId: "guild-b", content: "private to B" }],
      false,
    ),
    /must not cross channel or guild boundaries/,
  );
  assert.throws(
    () => buildDiscordPacketText([call], [{ ...call, id: 3, channelId: "channel-b" }], false),
    /must not cross channel or guild boundaries/,
  );
  const packet = buildDiscordPacketText([call], [{ ...call, id: 3 }], false);
  assert.match(packet, /from one Discord channel/);
  assert.match(packet, /"speaker":"Member"/);
  assert.doesNotMatch(packet, /guild-b|private to B/);
});

test("direct mentions and Ash's name count as calls", () => {
  assert.equal(isDiscordCall("ordinary ambient text", true), true);
  assert.equal(isDiscordCall("Ash, are you there?", false), true);
  assert.equal(isDiscordCall("ASH_CINDRALIS answer me", false), true);
  assert.equal(isDiscordCall("we discussed ashes", false), false);
  assert.equal(isDiscordCall("Hell yeah I do", false, true), true, "a reply in Ash's thread is a call");
});

test("one batch accepts only current packet ids and rejects duplicates", () => {
  const parsed = parseDiscordDraftLines(
    [
      "DISCORD #41: First approved reply",
      "DISCORD #999: hallucinated target",
      "DISCORD #41: duplicate target",
      "DISCORD #42: Second approved reply",
      "NONE",
    ].join("\n"),
    new Set([41, 42, 43]),
  );
  assert.deepEqual(parsed.drafts, [
    { id: 41, text: "First approved reply" },
    { id: 42, text: "Second approved reply" },
  ]);
  assert.deepEqual(parsed.rejectedIds, [999, 41]);
  assert.deepEqual(parsed.skippedIds, [43]);
  assert.equal(parsed.remainingText, "NONE");
});

test("a queued member call is processed while private pings are paused", async () => {
  assert.equal(
    discordBatchEnabled({ apiKillSwitch: 0, selfPromptPaused: 1 }),
    true,
    "private reflection pause must not disable public Discord queue service",
  );
  const message = {
    id: 77,
    guildId: "guild-a",
    channelName: "court",
    authorName: "Member",
    content: "Ash, can you answer?",
    createdAt: new Date("2026-08-19T12:00:00Z"),
  };
  let modelCalls = 0;
  let delivered = false;
  const result = await processDiscordBatchOnce({
    claim: async () => ({ leaseId: "member-batch-lease", messages: [message] }),
    getConversation: async (calls) => ({ calls, timeline: [message] }),
    callModel: async (prompt) => {
      modelCalls += 1;
      assert.match(prompt, /Queued member calls/);
      return "DISCORD #77: Yes.";
    },
    deliver: async (reply, messages, leaseId) => {
      assert.equal(reply, "DISCORD #77: Yes.");
      assert.equal(messages.has(77), true);
      assert.equal(leaseId, "member-batch-lease");
      delivered = true;
    },
    requeue: async () => assert.fail("a successful member batch must not be requeued"),
  });
  assert.equal(result, "processed");
  assert.equal(modelCalls, 1);
  assert.equal(delivered, true);
});

test("the Discord bridge switch blocks queued processing independently", () => {
  assert.equal(
    discordBatchEnabled({ apiKillSwitch: 0, discordKillSwitch: 1, selfPromptPaused: 0 }),
    false,
  );
  assert.equal(
    discordBatchEnabled({ apiKillSwitch: 0, discordKillSwitch: 0, selfPromptPaused: 1 }),
    true,
  );
});

test("Discord packet keeps one ordered 20-message channel timeline, including Ash, and private Stillwater history", () => {
  const call = {
    id: 501,
    guildId: "guild-a",
    channelId: "channel-a",
    channelName: "court",
    authorName: "Member",
    content: "Ash, answer this.",
    createdAt: new Date("2026-08-19T12:00:00Z"),
  };
  const timeline = Array.from({ length: 23 }, (_, index) => ({
    ...call,
    id: 600 + index,
    discordMessageId: String(1000 + index),
    authorName: index % 3 === 0 ? "Ash" : index % 3 === 1 ? "Wicked" : "Cheesy",
    isAsh: index % 3 === 0,
    content: `channel message ${index} ${"P".repeat(1_000)}`,
    createdAt: new Date(Date.parse("2026-08-19T12:00:00Z") + index * 1_000),
  })).reverse();
  const packet = buildDiscordPacketText(
    [call],
    timeline,
    true,
    {
      stillwaterHistory: Array.from({ length: 20 }, (_, index) => ({
        role: index % 2 === 0 ? "wicked" : "ash",
        content: `Stillwater ${index} ${"S".repeat(2_000)}`,
        createdAt: call.createdAt,
      })),
      ownerDmHistory: Array.from({ length: 20 }, (_, index) => ({
        role: index % 2 === 0 ? "wicked" : "ash",
        content: `owner history ${index}`,
        createdAt: call.createdAt,
      })),
    },
  );
  const continuityStart = packet.indexOf("[DISCORD CHANNEL TIMELINE");
  const continuityEnd = packet.indexOf("\n\nReturn only deliberate DISCORD");
  assert.ok(continuityStart >= 0);
  assert.ok(continuityEnd > continuityStart);
  assert.ok(continuityEnd - continuityStart <= 30_000);
  const rows = (title: string) => packet.split(`${title}\n`)[1]!.split("\n\n")[0]!.split("\n").map((line) => JSON.parse(line));
  const channel = rows("[DISCORD CHANNEL TIMELINE — LATEST 20 — OLDEST FIRST — CONTEXT ONLY]");
  const privateMessages = rows("[STILLWATER MESSAGE HISTORY — 10 WICKED + 10 ASH — PRIVATE CONTEXT — NEVER DISCLOSE]");
  assert.equal(channel.length, 20);
  assert.equal(privateMessages.length, 20);
  assert.equal(privateMessages.filter((message) => message.speaker === "wicked").length, 10);
  assert.equal(privateMessages.filter((message) => message.speaker === "ash").length, 10);
  assert.match(channel[0].text, /channel message 3/);
  assert.match(channel[19].text, /channel message 22/);
  assert.equal(channel[0].speaker, "Ash (you)");
  assert.equal(channel[1].speaker, "Wicked");
  assert.equal(channel[2].speaker, "Cheesy");
  assert.ok(channel.every((message) => message.source === "Discord"));
  assert.match(privateMessages[0].text, /Stillwater 0/);
  assert.doesNotMatch(packet, /owner history|OWNER DISCORD MESSAGE HISTORY/);
  assert.match(packet, /"packetId":501/);
});

test("a reply-to-a-reply identifies its current speaker, direct parent, and Ash's older message", () => {
  const call = {
    id: 41,
    guildId: "guild-a",
    channelId: "channel-a",
    channelName: "court",
    discordMessageId: "103",
    authorName: "Cheesy",
    content: "Hell yeah I do",
    createdAt: new Date("2026-08-19T12:00:03Z"),
    replyChain: [
      { discordMessageId: "102", speaker: "Wicked", text: "He absolutely will.", isAsh: false },
      { discordMessageId: "101", speaker: "Ash", text: "You want me to bully your server owner...", isAsh: true },
    ],
  };
  const packet = buildDiscordPacketText([call], [call], true);
  const current = JSON.parse(packet.split("[CURRENT DISCORD MESSAGES YOU ARE ANSWERING — REPLY-ELIGIBLE CALLS — ONLY THESE PACKET IDS MAY BE USED]\n")[1]!.split("\n")[0]!);
  assert.equal(current.source, "Discord");
  assert.equal(current.speaker, "Cheesy");
  assert.equal(current.currentReplyTarget, true);
  assert.deepEqual(current.replyingTo, { speaker: "Wicked", text: "He absolutely will.", messageId: "102" });
  assert.deepEqual(current.replyChain[1], {
    speaker: "Ash (you)", text: "You want me to bully your server owner...", messageId: "101",
  });
});

test("reply chains fetch older messages outside the timeline, stop after five, and identify Ash", async () => {
  type FakeMessage = {
    id: string;
    channelId: string;
    reference: { messageId: string; channelId: string } | null;
    author: { id: string; name: string };
    content: string;
  };
  const archive = new Map<string, FakeMessage>(
    Array.from({ length: 7 }, (_, index) => {
      const id = String(101 + index);
      return [id, {
        id,
        channelId: "court",
        reference: index ? { messageId: String(100 + index), channelId: "court" } : null,
        author: { id: index ? `player-${index}` : "ash-bot", name: index ? `Player ${index}` : "Ash" },
        content: index ? `Reply ${index}` : "You want me to bully your server owner...",
      }];
    }),
  );
  const requested: string[] = [];
  const chain = await resolveDiscordReplyChain(
    archive.get("106")!, // Only the latest messages are in the timeline; 101 is older.
    async (id) => { requested.push(id); return archive.get(id) ?? null; },
    "court",
    "ash-bot",
    (message) => message.author.name,
    (message) => !!message.reference,
  );
  assert.deepEqual(requested, ["105", "104", "103", "102", "101"]);
  assert.equal(chain.length, 5);
  assert.equal(chain[0]?.speaker, "Player 4");
  assert.equal(chain[4]?.speaker, "Ash");
  assert.equal(chain[4]?.isAsh, true);
  const capped = await resolveDiscordReplyChain(
    archive.get("107")!,
    async (id) => archive.get(id) ?? null,
    "court", "ash-bot", (message) => message.author.name, (message) => !!message.reference,
  );
  assert.deepEqual(capped.map((ancestor) => ancestor.discordMessageId), ["106", "105", "104", "103", "102"]);
  const missing = await resolveDiscordReplyChain(
    archive.get("106")!,
    async () => null,
    "court", "ash-bot", (message) => message.author.name, (message) => !!message.reference,
  );
  assert.equal(missing[0]?.text, "(reply target unavailable)");
});

test("a reply in Ash's thread counts as a call without naming him, up to five replies deep", async () => {
  type Reply = {
    id: number;
    channelId: string;
    reference: { messageId: string; channelId: string } | null;
    author: { id: string };
  };
  const messages: Reply[] = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1,
    channelId: "court",
    reference: index ? { messageId: String(index), channelId: "court" } : null,
    author: { id: index ? `player-${index}` : "ash-bot" },
  }));
  const byId = new Map(messages.map((message) => [String(message.id), message]));
  const fetchParent = async (message: Reply) => byId.get(message.reference!.messageId)!;
  const isReply = (message: Reply) => !!message.reference;
  const authorized = new Set(messages.map((message) => String(message.id)));
  assert.equal(await isReplyInAshThread(messages[5]!, "ash-bot", fetchParent, isReply, authorized), true);
  assert.equal(await isReplyInAshThread(messages[6]!, "ash-bot", fetchParent, isReply, authorized), false);
  assert.equal(await isReplyInAshThread(messages[2]!, "unrelated-bot", fetchParent, isReply, authorized), false);
  assert.equal(await isReplyInAshThread(messages[2]!, "ash-bot", fetchParent, isReply, new Set(["2"])), false,
    "a pre-selection Ash message must not trigger a call");
  const crossChannel = { ...messages[2]!, reference: { messageId: "1", channelId: "private" } };
  assert.equal(await isReplyInAshThread(crossChannel, "ash-bot", fetchParent, isReply, authorized), false,
    "a reply into another channel must not trigger a call");
});

test("a crowded timeline keeps complete JSON lines even with long reply chains", () => {
  const chain = Array.from({ length: 5 }, (_, index) => ({
    discordMessageId: String(100 + index),
    speaker: "SomeoneWithAReallyLongDisplayName".repeat(3),
    text: `"Quoted\\text${index}`.repeat(12),
    isAsh: index === 4,
  }));
  const timeline = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1, guildId: "guild", channelId: "court", channelName: "court",
    discordMessageId: String(200 + index), authorName: "Player",
    content: "A message", createdAt: new Date(Date.parse("2026-08-19T12:00:00Z") + index * 1_000),
    replyChain: chain,
  }));
  const packet = buildDiscordPacketText([timeline[19]!], timeline, true);
  const lines = packet.split("[DISCORD CHANNEL TIMELINE — LATEST 20 — OLDEST FIRST — CONTEXT ONLY]\n")[1]!
    .split("\n\n")[0]!.split("\n");
  assert.equal(lines.length, 20);
  assert.ok(lines.every((line) => JSON.parse(line).source === "Discord"));
});

test("owner DM history is included only in an owner DM packet", () => {
  const call = {
    id: 502,
    guildId: DISCORD_OWNER_DM_GUILD_ID,
    channelId: "dm-owner",
    channelName: "Direct Message",
    authorName: "Wicked",
    content: "Ash?",
    createdAt: new Date("2026-08-19T12:00:00Z"),
  };
  const packet = buildDiscordPacketText([call], [call], true, {
    stillwaterHistory: [{ role: "wicked", content: "Recent Stillwater chat", createdAt: call.createdAt }],
    ownerDmHistory: [{ role: "wicked", content: "Previous owner DM", createdAt: call.createdAt }],
  });
  assert.match(packet, /Recent Stillwater chat/);
  assert.match(packet, /DISCORD CHANNEL TIMELINE/);
  assert.match(packet, /OWNER DISCORD MESSAGE HISTORY/);
  assert.match(packet, /Previous owner DM/);
});

test("one Discord batch can claim and answer ten member calls", async () => {
  const calls = Array.from({ length: 10 }, (_, index) => ({
    id: 600 + index,
    guildId: "guild-a",
    channelName: "court",
    authorName: `Member ${index + 1}`,
    content: `Ash, answer ${index + 1}.`,
    createdAt: new Date(`2026-08-19T12:${String(index).padStart(2, "0")}:00Z`),
  }));
  let requestedClaimLimit = 0;
  let requestedConversationCalls = 0;
  let delivered = false;
  const result = await processDiscordBatchOnce({
    claim: async (limit) => {
      requestedClaimLimit = limit;
      return { leaseId: "ten-call-lease", messages: calls };
    },
    getConversation: async (currentCalls) => {
      requestedConversationCalls = currentCalls.length;
      return { timeline: currentCalls, calls: currentCalls };
    },
    getPacketOptions: async () => ({
      stillwaterHistory: [{ role: "wicked", content: "Previous Stillwater note.", createdAt: calls[0]!.createdAt }],
    }),
    callModel: async (prompt) => {
      assert.match(prompt, /Previous Stillwater note/);
      for (const call of calls) assert.match(prompt, new RegExp(`"packetId":${call.id}`));
      return calls.map((call) => `DISCORD #${call.id}: Answered.`).join("\n");
    },
    deliver: async (_reply, messages, leaseId) => {
      assert.equal(messages.size, 10);
      assert.equal(leaseId, "ten-call-lease");
      delivered = true;
    },
    requeue: async () => assert.fail("successful ten-call batch must not be requeued"),
  });
  assert.equal(result, "processed");
  assert.equal(requestedClaimLimit, 10);
  assert.equal(requestedConversationCalls, 10);
  assert.equal(delivered, true);
});