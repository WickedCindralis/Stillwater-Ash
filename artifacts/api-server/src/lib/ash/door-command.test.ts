import assert from "node:assert/strict";
import test from "node:test";
import { extractOpenDoors, launchDoorFollowUps, type AshDoor } from "./door-command";

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

test("only explicit doors are dispatched; follow-up output is not recursively parsed", async () => {
  const started: AshDoor[] = [];
  let doorOutput = "";
  let finished!: () => void;
  const done = new Promise<void>((resolve) => { finished = resolve; });

  launchDoorFollowUps(["SONG"], async (door) => {
    started.push(door);
    // The real door runner consumes output with that door's parser and
    // returns void; the launcher never receives or re-parses this text.
    doorOutput = "OPEN: STATUS";
    finished();
  }, () => assert.fail("door follow-up should not fail"));

  await done;
  await Promise.resolve();
  assert.equal(doorOutput, "OPEN: STATUS");
  assert.deepEqual(started, ["SONG"]);
});

test("a slow or failed door follow-up never blocks its caller and reports failure", async () => {
  let rejectDoor!: (error: Error) => void;
  const blocked = new Promise<void>((_resolve, reject) => { rejectDoor = reject; });
  const failures: Array<{ door: AshDoor; error: unknown }> = [];
  let failureHandled!: () => void;
  const handled = new Promise<void>((resolve) => { failureHandled = resolve; });

  launchDoorFollowUps(["DIARY"], () => blocked, (door, error) => {
    failures.push({ door, error });
    failureHandled();
  });

  assert.equal(failures.length, 0, "the caller returns while the door is still pending");
  rejectDoor(new Error("provider unavailable"));
  await handled;
  const observed = () => failures.slice();
  assert.equal(observed()[0]?.door, "DIARY");
  assert.match(String(observed()[0]?.error), /provider unavailable/);
});
