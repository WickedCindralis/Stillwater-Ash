import test from "node:test";
import assert from "node:assert/strict";
import { isCompanionConnected, parseHangoutApproval, privateMessageHangoutMode } from "./hangout-policy";

test("companion must have sent a heartbeat within the last minute", () => {
  const now = 100_000;
  assert.equal(isCompanionConnected(new Date(now - 59_999), now), true);
  assert.equal(isCompanionConnected(new Date(now - 60_000), now), false);
  assert.equal(isCompanionConnected(null, now), false);
});

test("private chat rejects during invitation rather than falling back to normal chat", () => {
  assert.equal(privateMessageHangoutMode("inviting"), "inviting");
  assert.equal(privateMessageHangoutMode("active"), "active");
  assert.equal(privateMessageHangoutMode("idle"), "idle");
});

test("approval requires machine-readable explicit approve decision", () => {
  assert.deepEqual(parseHangoutApproval('{"decision":"approve","reply":"Yes, let us."}'), {
    decision: "approve",
    reply: "Yes, let us.",
  });
});

test("decline is preserved as a distinct decision", () => {
  assert.deepEqual(parseHangoutApproval('{"decision":"decline","reply":"Not right now."}'), {
    decision: "decline",
    reply: "Not right now.",
  });
});

test("free-form, ambiguous, malformed, and empty output never approves", () => {
  for (const value of [
    "Sure, I would love to hang out.",
    '{"decision":"maybe","reply":"Perhaps"}',
    '{"decision":"approve","reply":" "}',
    "```json\n{\"decision\":\"approve\",\"reply\":\"yes\"}\n```",
  ]) assert.equal(parseHangoutApproval(value), null);
});