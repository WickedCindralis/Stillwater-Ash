import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyDiscordMessage,
  buildDiscordPacketText,
  DISCORD_OWNER_DM_GUILD_ID,
  DISCORD_PUBLIC_SYSTEM_PROMPT,
  isDiscordCall,
  isDiscordPlayerTicketChannel,
  parseDiscordDraftLines,
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
    /must not cross guild boundaries/,
  );
  const packet = buildDiscordPacketText([call], [{ ...call, id: 3 }], false);
  assert.match(packet, /from one server/);
  assert.match(packet, /"playerName":"Member"/);
  assert.doesNotMatch(packet, /guild-b|private to B/);
});

test("direct mentions and Ash's name count as calls", () => {
  assert.equal(isDiscordCall("ordinary ambient text", true), true);
  assert.equal(isDiscordCall("Ash, are you there?", false), true);
  assert.equal(isDiscordCall("ASH_CINDRALIS answer me", false), true);
  assert.equal(isDiscordCall("we discussed ashes", false), false);
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
    getContext: async () => [message],
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

test("Discord packet keeps 10 comments per group and 10 messages per Stillwater speaker", () => {
  const call = {
    id: 501,
    guildId: "guild-a",
    channelName: "court",
    authorName: "Member",
    content: "Ash, answer this.",
    createdAt: new Date("2026-08-19T12:00:00Z"),
  };
  const packet = buildDiscordPacketText(
    [call],
    Array.from({ length: 10 }, (_, index) => ({
      ...call, id: 600 + index, authorName: `Player ${index}`,
      content: `player comment ${index} ${"P".repeat(2_000)}`,
    })),
    true,
    {
      wickedMessages: Array.from({ length: 10 }, (_, index) => ({
        ...call, id: 700 + index, authorName: "Wicked",
        content: `owner comment ${index} ${"O".repeat(2_000)}`,
      })),
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
  const continuityStart = packet.indexOf("[OWNER'S RECENT DISCORD COMMENTS");
  const continuityEnd = packet.indexOf("\n\nReturn only deliberate DISCORD");
  assert.ok(continuityStart >= 0);
  assert.ok(continuityEnd > continuityStart);
  assert.ok(continuityEnd - continuityStart <= 30_000);
  const rows = (title: string) => packet.split(`${title}\n`)[1]!.split("\n\n")[0]!.split("\n").map((line) => JSON.parse(line));
  const owner = rows("[OWNER'S RECENT DISCORD COMMENTS — 10 — CONTEXT ONLY]");
  const privateMessages = rows("[STILLWATER MESSAGE HISTORY — 10 WICKED + 10 ASH — PRIVATE CONTEXT — NEVER DISCLOSE]");
  const players = rows("[RECENT PLAYER DISCORD COMMENTS — 10 — CONTEXT ONLY]");
  assert.equal(owner.length, 10);
  assert.equal(privateMessages.length, 20);
  assert.equal(privateMessages.filter((message) => message.speaker === "wicked").length, 10);
  assert.equal(privateMessages.filter((message) => message.speaker === "ash").length, 10);
  assert.equal(players.length, 10);
  assert.match(owner[0].text, /owner comment 0/);
  assert.match(privateMessages[0].text, /Stillwater 0/);
  assert.match(players[0].text, /player comment 0/);
  assert.doesNotMatch(packet, /owner history|OWNER DISCORD MESSAGE HISTORY/);
  assert.match(packet, /"packetId":501/);
});

test("owner DM history is included only in an owner DM packet", () => {
  const call = {
    id: 502,
    guildId: DISCORD_OWNER_DM_GUILD_ID,
    channelName: "Direct Message",
    authorName: "Wicked",
    content: "Ash?",
    createdAt: new Date("2026-08-19T12:00:00Z"),
  };
  const playerComment = {
    ...call, id: 503, guildId: "selected-guild",
    channelName: "court", authorName: "Player", content: "A player's Discord comment",
  };
  const packet = buildDiscordPacketText([call], [playerComment], true, {
    stillwaterHistory: [{ role: "wicked", content: "Recent Stillwater chat", createdAt: call.createdAt }],
    wickedMessages: [{ ...call, id: 504, content: "Earlier owner Discord comment" }],
    ownerDmHistory: [{ role: "wicked", content: "Previous owner DM", createdAt: call.createdAt }],
  });
  assert.match(packet, /Recent Stillwater chat/);
  assert.match(packet, /A player's Discord comment/);
  assert.match(packet, /Earlier owner Discord comment/);
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
  let requestedContextLimit = 0;
  let delivered = false;
  const result = await processDiscordBatchOnce({
    claim: async (limit) => {
      requestedClaimLimit = limit;
      return { leaseId: "ten-call-lease", messages: calls };
    },
    getContext: async (_guildId, limit) => {
      requestedContextLimit = limit;
      return [];
    },
    getPacketOptions: async () => ({
      wickedMessages: [{
        ...calls[0]!,
        id: 700,
        content: "Previous Discord owner call.",
      }],
    }),
    callModel: async (prompt) => {
      assert.match(prompt, /Previous Discord owner call/);
      assert.doesNotMatch(prompt, /Recent Stillwater history/);
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
  assert.equal(requestedContextLimit, 10);
  assert.equal(delivered, true);
});