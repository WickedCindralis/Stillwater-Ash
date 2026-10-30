import assert from "node:assert/strict";
import test from "node:test";
import { extractOpenDoors } from "./door-command";

test("extracts and strips at most two valid door requests", () => {
  assert.deepEqual(extractOpenDoors("Hello.\nOPEN: STATUS\nOPEN: books\nOPEN: NOTES"), {
    doors: ["STATUS", "BOOKS"],
    text: "Hello.",
  });
});

test("strips unknown door names without opening them", () => {
  assert.deepEqual(extractOpenDoors("OPEN: UNKNOWN\nStill talking."), {
    doors: [],
    text: "Still talking.",
  });
});
