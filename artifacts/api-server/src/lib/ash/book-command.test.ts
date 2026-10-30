import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBookTitle, parseBookCommand } from "./book-command";

test("parses WRITE titles regardless of command casing and surrounding spaces", () => {
  assert.deepEqual(parseBookCommand("  write:   The   Long Road  "), {
    kind: "write",
    title: "The   Long Road",
  });
  assert.equal(normalizeBookTitle("  THE   long road "), "the long road");
});

test("parses NEW with an optional premise", () => {
  assert.deepEqual(parseBookCommand("NEW: Glass Harbor"), {
    kind: "new",
    title: "Glass Harbor",
    premise: "",
  });
  assert.deepEqual(parseBookCommand("NEW: Glass Harbor  |  Two sisters return home."), {
    kind: "new",
    title: "Glass Harbor",
    premise: "Two sisters return home.",
  });
});

test("preserves pipe characters after the title-premise separator", () => {
  assert.deepEqual(parseBookCommand("NEW: The Test | First | second"), {
    kind: "new",
    title: "The Test",
    premise: "First | second",
  });
});

test("ignores commands without titles", () => {
  assert.equal(parseBookCommand("NEW: | a premise"), null);
  assert.equal(parseBookCommand("WRITE:   "), null);
});
