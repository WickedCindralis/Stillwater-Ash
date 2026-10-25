import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTiktokHandle } from "./tiktok-handle";

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
