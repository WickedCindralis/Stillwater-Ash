import assert from "node:assert/strict";
import test from "node:test";
import {
  createProactiveWindowActivity,
  formatProactiveWindowActivity,
  recordProactiveAction,
  recordProactiveFailure,
  recordProactiveSongOutcome,
} from "./proactive-window-activity";

test("formats only completed proactive actions and failures with counts", () => {
  const activity = createProactiveWindowActivity();
  recordProactiveAction(activity, "diaryEntry");
  recordProactiveAction(activity, "memoriesReviewed", 7);
  recordProactiveFailure(activity, "song");
  assert.equal(
    formatProactiveWindowActivity(activity),
    "PROACTIVE WINDOW: 1 diary entry, 7 memories reviewed, 1 song failed",
  );
});

test("formats a proactive ping with no actions", () => {
  assert.equal(
    formatProactiveWindowActivity(createProactiveWindowActivity()),
    "PROACTIVE WINDOW: no action",
  );
});

test("counts generated clips only after completion and reports pending songs", () => {
  const activity = createProactiveWindowActivity();
  recordProactiveSongOutcome(activity, "succeeded", 2);
  recordProactiveSongOutcome(activity, "in_progress");
  assert.equal(
    formatProactiveWindowActivity(activity),
    "PROACTIVE WINDOW: 2 songs generated, 1 song in progress",
  );
});
