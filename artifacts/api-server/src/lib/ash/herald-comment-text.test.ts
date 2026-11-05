import assert from "node:assert/strict";
import test from "node:test";
import { extractHeraldCommentText, summarizeHeraldTextFields } from "./herald-comment-text";

test("keeps plain text including mentions, links, and emoji-only comments", () => {
  assert.deepEqual(extractHeraldCommentText({ text: "@Ash https://example.test 🖤" }), {
    text: "@Ash https://example.test 🖤",
    source: "text",
  });
  assert.deepEqual(extractHeraldCommentText({ text: "🥰🥰" }), { text: "🥰🥰", source: "text" });
});

test("recovers comment text from provider share and reply fields", () => {
  assert.deepEqual(extractHeraldCommentText({
    text: "",
    share_info: { desc: "Creator’s comment: I still love this! @Ash 🖤" },
  }), { text: "I still love this! @Ash 🖤", source: "share_info.desc" });
  assert.deepEqual(extractHeraldCommentText({ text: "", reply: { text: "A reply with a link https://example.test" } }), {
    text: "A reply with a link https://example.test",
    source: "reply.text",
  });
  assert.deepEqual(extractHeraldCommentText({ text: "", text_extra: [{ user_name: "wickedsread" }] }), {
    text: "@wickedsread",
    source: "text_extra",
  });
});

test("skip diagnostics summarize provider text fields and cap values", () => {
  const summary = summarizeHeraldTextFields({
    text: "",
    share_info: { desc: "T's comment: " + "x".repeat(200) },
    text_extra: [{ user_name: "test" }],
  });
  assert.match(summary, /text=""/);
  assert.match(summary, /share_info\.desc=/);
  assert.match(summary, /text_extra=/);
  assert.ok(summary.length < 400);
});
