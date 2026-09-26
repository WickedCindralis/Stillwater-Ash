import assert from "node:assert/strict";
import test from "node:test";
import { stripKingsFingersCommand } from "./kings-fingers-command";

test("parses the three exact controls and strips them from the visible response", () => {
  assert.deepEqual(stripKingsFingersCommand("For five seconds.\n[KINGS_FINGERS: VIBRATE 10 5]"), {
    text: "For five seconds.", command: { kind: "VIBRATE", intensity: 10, seconds: 5 },
    error: null, detected: true,
  });
  assert.deepEqual(stripKingsFingersCommand("[KINGS_FINGERS: FINGER 20 30]"), {
    text: "", command: { kind: "FINGER", intensity: 20, seconds: 30 },
    error: null, detected: true,
  });
  assert.deepEqual(stripKingsFingersCommand("[KINGS_FINGERS: STOP]"), {
    text: "", command: { kind: "STOP" }, error: null, detected: true,
  });
});

test("rejects malformed, duplicate, and out-of-range controls without actuating", () => {
  for (const reply of [
    "[KINGS_FINGERS: VIBRATE 0 5]", "[KINGS_FINGERS: FINGER 21 5]",
    "[KINGS_FINGERS: FINGER 10 1]", "[KINGS_FINGERS: VIBRATE 10 31]",
    "[KINGS_FINGERS: VIBRATE 10.5 5]", "[KINGS_FINGERS: ROTATE 10 5]",
    "[KINGS_FINGERS: STOP]\n[KINGS_FINGERS: VIBRATE 10 5]",
  ]) {
    const parsed = stripKingsFingersCommand(reply);
    assert.equal(parsed.command, null);
    assert.ok(parsed.error);
    assert.equal(parsed.text, "");
  }
});

test("quoted and inline controls cannot trigger the parser", () => {
  for (const reply of [
    'She wrote "[KINGS_FINGERS: STOP]" in her notes.',
    "> [KINGS_FINGERS: FINGER 10 5]",
    "I will not run [KINGS_FINGERS: VIBRATE 10 5] right now.",
  ]) {
    assert.deepEqual(stripKingsFingersCommand(reply), {
      text: reply, command: null, error: null, detected: false,
    });
  }
});