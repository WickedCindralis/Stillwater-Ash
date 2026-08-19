import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyDiscordMessage,
  buildDiscordPacketText,
  DISCORD_PUBLIC_SYSTEM_PROMPT,
  isDiscordCall,
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

test("the public model prompt is immutable and contains no private packet material", () => {
  assert.match(DISCORD_PUBLIC_SYSTEM_PROMPT, /Ash Cindralis/);
  assert.doesNotMatch(DISCORD_PUBLIC_SYSTEM_PROMPT, /Wicked|SOUL-SHEET|CORE ANCHORS|STATUS CHANGED|PINGS_OFF/);
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