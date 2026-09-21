import assert from "node:assert/strict";
import test from "node:test";
import { parseStoryCommand, selectResumeOutput } from "./story-command";

test("marker-only response starts the dedicated Story writer", () => {
  assert.deepEqual(parseStoryCommand("  [ASH'S STORY]\n"), { kind: "start" });
});

test("prose after the marker is preserved as Story content", () => {
  assert.deepEqual(parseStoryCommand("[ASH'S STORY]\nThe tower door opened."), {
    kind: "prose",
    content: "The tower door opened.",
  });
});

test("ordinary reflection is not treated as a Story command", () => {
  assert.equal(parseStoryCommand("DIARY: A quiet hour."), null);
});

test("edited chapter content wins over an older run checkpoint on resume", () => {
  assert.equal(selectResumeOutput("Wicked's edited ending.", "Older streamed ending."), "Wicked's edited ending.");
});

test("run output is retained when no chapter exists yet", () => {
  assert.equal(selectResumeOutput(null, "Saved stream output."), "Saved stream output.");
});