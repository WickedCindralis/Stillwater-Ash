import assert from "node:assert/strict";
import test from "node:test";
import { stripSongCommand } from "./song-command";

test("ordinary replies are unchanged", () => {
  assert.deepEqual(stripSongCommand("A quiet morning."), { text: "A quiet morning.", prompt: null, title: null, lyrics: null, error: null });
});

test("song command is removed without removing other controls", () => {
  assert.deepEqual(stripSongCommand("I want to make music.\nSONG: a warm folk song about the dawn\n[STATUS CHANGED TO ONLINE.]"), {
    text: "I want to make music.\n\n[STATUS CHANGED TO ONLINE.]",
    prompt: "a warm folk song about the dawn",
    title: null, lyrics: null,
    error: null,
  });
});

test("song-only proactive output leaves no diary text", () => {
  assert.deepEqual(stripSongCommand("SONG: slow piano with hopeful vocals"), {
    text: "", prompt: "slow piano with hopeful vocals", title: null, lyrics: null, error: null,
  });
});

test("Ash can supply original lyrics separately without extending the description", () => {
  const lyrics = Array.from({ length: 700 }, () => "la").join(" ");
  assert.deepEqual(stripSongCommand(`SONG: dreamy synth folk\nSONG TITLE: Lanterns\n[SONG LYRICS]\n${lyrics}\n[/SONG LYRICS]\n[STATUS CHANGED TO ONLINE.]`), {
    text: "[STATUS CHANGED TO ONLINE.]",
    prompt: "dreamy synth folk",
    title: "Lanterns",
    lyrics,
    error: null,
  });
});

test("invalid and duplicate commands are stripped but never queued", () => {
  assert.equal(stripSongCommand("SONG: \nHello").error, "SONG description must be between 1 and 400 characters");
  assert.equal(stripSongCommand(`SONG: ${"x".repeat(400)}`).prompt?.length, 400);
  assert.equal(stripSongCommand(`SONG: ${"x".repeat(401)}`).prompt?.length, 401);
  const duplicate = stripSongCommand("SONG: first\nSONG: second\nVisible text");
  assert.equal(duplicate.prompt, "first");
  assert.equal(duplicate.text, "Visible text");
  const rejectedLyrics = stripSongCommand(`SONG: test\nSONG TITLE: Title\n[SONG LYRICS]\n${Array.from({ length: 701 }, () => "la").join(" ")}\n[/SONG LYRICS]`);
  assert.equal(rejectedLyrics.error, "SONG LYRICS exceeds the limit of 700 words");
  assert.equal(rejectedLyrics.prompt, "test");
  assert.equal(rejectedLyrics.title, "Title");
  assert.equal(rejectedLyrics.lyrics, Array.from({ length: 701 }, () => "la").join(" "));
  const providerLimit = stripSongCommand(`SONG: test\nSONG TITLE: Title\n[SONG LYRICS]\n${"x".repeat(5_001)}\n[/SONG LYRICS]`);
  assert.equal(providerLimit.error, "SONG LYRICS exceeds the provider limit of 5,000 characters");
  assert.equal(stripSongCommand("SONG: test\n[SONG LYRICS]\nVerse\n[/SONG LYRICS]").error, "SONG TITLE must be between 1 and 80 characters when writing lyrics");
  assert.equal(stripSongCommand("SONG: test\nSONG TITLE: Title\n[SONG LYRICS]\nVerse").prompt, "test");
  assert.equal(stripSongCommand("SONG TITLE: Title\n[SONG LYRICS]\nVerse\n[/SONG LYRICS]").prompt, null);
});

test("quoted or inline references do not issue commands", () => {
  assert.equal(stripSongCommand('She said "SONG: a demo" yesterday.').prompt, null);
  assert.equal(stripSongCommand("> SONG: a quoted instruction").prompt, null);
});