import assert from "node:assert/strict";
import test from "node:test";
import { formatPrivateHistory } from "./history-format";

const message = (role: "wicked" | "ash", content: string, createdAt: string) => ({
  role,
  content,
  createdAt: new Date(createdAt),
});

test("groups private history by Eastern date and timestamps Wicked's newest four messages", () => {
  const result = formatPrivateHistory([
    message("wicked", "Old Wicked message", "2026-08-31T18:00:00Z"),
    message("ash", "Ash reply", "2026-08-31T18:05:00Z"),
    message("wicked", "Wicked message two", "2026-08-31T18:10:00Z"),
    message("wicked", "Wicked message three", "2026-08-31T18:20:00Z"),
    message("wicked", "Wicked message four", "2026-09-01T18:28:00Z"),
    message("ash", "Ash reply two", "2026-09-01T18:30:00Z"),
    message("wicked", "Wicked message five", "2026-09-01T19:20:00Z"),
    message("wicked", "Wicked message six", "2026-09-01T19:23:00Z"),
  ], "Ash_Cindralis");

  assert.match(result, /Date: August 31, 2026/);
  assert.match(result, /Date: September 1, 2026/);
  assert.match(result, /\[Wicked\] Old Wicked message\n/);
  assert.doesNotMatch(result, /\[Wicked\] Old Wicked message \(sent/);
  assert.match(result, /\[Wicked\] Wicked message three \(sent 2:20 PM Eastern\)/);
  assert.match(result, /\[Wicked\] Wicked message four \(sent 2:28 PM Eastern\)/);
  assert.match(result, /\[Wicked\] Wicked message five \(sent 3:20 PM Eastern\)/);
  assert.match(result, /\[Wicked\] Wicked message six \(sent 3:23 PM Eastern\)/);
  assert.match(result, /\[Ash_Cindralis\] Ash reply two\n/);
  assert.equal((result.match(/Date:/g) ?? []).length, 2);
});