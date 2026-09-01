import assert from "node:assert/strict";
import test from "node:test";
import { stripScreenCaptureCommand } from "./screen-capture-command";

test("recognizes and removes an exact live screenshot command", () => {
  const result = stripScreenCaptureCommand("I need a closer look.\n[SCREENSHOT]\n");
  assert.equal(result.requested, true);
  assert.equal(result.text, "I need a closer look.");
});

test("does not treat inline screenshot text as a command", () => {
  const result = stripScreenCaptureCommand("Please say [SCREENSHOT] if you need one.");
  assert.equal(result.requested, false);
  assert.equal(result.text, "Please say [SCREENSHOT] if you need one.");
});