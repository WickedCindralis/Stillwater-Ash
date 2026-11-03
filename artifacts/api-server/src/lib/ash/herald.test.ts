import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTiktokHandle } from "./tiktok-handle";
import {
  deriveHeraldAlertMessages,
  getCommentPageStopReason,
  getHeraldCommentSkipReason,
  isHeraldScheduleEnabled,
} from "./herald-policy";

test("normalizes TikTok handles and profile URLs", () => {
  assert.equal(normalizeTiktokHandle("wickedsread"), "wickedsread");
  assert.equal(normalizeTiktokHandle("@wickedsread"), "wickedsread");
  assert.equal(normalizeTiktokHandle("https://www.tiktok.com/@wickedsread?lang=en"), "wickedsread");
  assert.equal(normalizeTiktokHandle("www.tiktok.com/@wickedsread"), "wickedsread");
});

test("rejects non-TikTok URLs and invalid handles", () => {
  assert.equal(normalizeTiktokHandle("https://example.com/@wickedsread"), "");
  assert.equal(normalizeTiktokHandle("https://www.tiktok.com/video/123"), "");
  assert.equal(normalizeTiktokHandle(""), "");
});

test("scheduler requires an enabled flag and production runtime", () => {
  assert.equal(isHeraldScheduleEnabled("true", "production", undefined), true);
  assert.equal(isHeraldScheduleEnabled("true", "development", undefined), false);
  assert.equal(isHeraldScheduleEnabled("false", "production", undefined), false);
  assert.equal(isHeraldScheduleEnabled("true", "development", "1"), true);
});

test("comment skips distinguish missing IDs, missing text, and duplicates", () => {
  const seen = new Set(["existing"]);
  assert.equal(getHeraldCommentSkipReason("", "text", seen), "missing-id");
  assert.equal(getHeraldCommentSkipReason("id", "   ", seen), "missing-text");
  assert.equal(getHeraldCommentSkipReason("existing", "text", seen), "duplicate");
  assert.equal(getHeraldCommentSkipReason("new", "text", seen), null);
});

test("pagination stops on a stored comment, exhaustion, or page cap", () => {
  const base = { hasStoredComment: false, hasMore: true, cursor: 20, pageNumber: 1, maxPages: 5 };
  assert.equal(getCommentPageStopReason(base), null);
  assert.equal(getCommentPageStopReason({ ...base, hasStoredComment: true }), "stored-comment");
  assert.equal(getCommentPageStopReason({ ...base, hasMore: false }), "no-more-pages");
  assert.equal(getCommentPageStopReason({ ...base, cursor: null }), "no-more-pages");
  assert.equal(getCommentPageStopReason({ ...base, pageNumber: 5 }), "page-cap");
});

test("Herald alerts ignore skipped attempts and require three consecutive failures", () => {
  const now = new Date("2026-11-03T20:00:00.000Z");
  const history = [
    { message: "Herald sweep skipped\nreason: cooldown", createdAt: "2026-11-03T19:59:00.000Z" },
    { message: "Herald sweep failed", createdAt: "2026-11-03T19:00:00.000Z" },
    { message: "Herald sweep failed", createdAt: "2026-11-03T16:00:00.000Z" },
    { message: "Herald sweep failed", createdAt: "2026-11-03T13:00:00.000Z" },
  ];
  assert.deepEqual(deriveHeraldAlertMessages(history, now), [
    "Herald failing — the last 3 recorded sweeps failed.",
    "Herald quiet — no successful sweep in the last 24 hours.",
  ]);
  const withRecentSuccess = [
    { message: "Herald sweep complete", createdAt: "2026-11-03T19:30:00.000Z" },
    ...history,
  ];
  assert.deepEqual(deriveHeraldAlertMessages(withRecentSuccess, now), []);
});
