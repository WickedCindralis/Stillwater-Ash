import assert from "node:assert/strict";
import test from "node:test";
import { createSong, pollSong, SongProviderError } from "./song-provider";

function mockFetch(body: unknown, status = 200): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    assert.match(url, /^https:\/\/api\.aimusicapi\.ai\/api\/v1\/sonic\//);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer fake-test-key");
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

test("creates one description-mode v6 task", async () => {
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://api.aimusicapi.ai/api/v1/sonic/create");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      task_type: "create_music", mv: "chirp-v6",
      custom_mode: false, gpt_description_prompt: "night-drive synthwave",
    });
    return mockFetch({ code: 200, task_id: "task-1" })(input, init);
  }) as typeof fetch;
  assert.equal(await createSong({ description: "night-drive synthwave", title: null, lyrics: null }, "fake-test-key", fetcher), "task-1");
});

test("Ash-written lyrics use custom mode and allow 700 words", async () => {
  const lyrics = Array.from({ length: 700 }, () => "la").join(" ");
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.deepEqual(JSON.parse(String(init?.body)), {
      task_type: "create_music", mv: "chirp-v6",
      custom_mode: true, title: "Lanterns", tags: "dreamy synth folk", prompt: lyrics,
    });
    return mockFetch({ code: 200, task_id: "task-long" })(input, init);
  }) as typeof fetch;
  assert.equal(await createSong({ description: "dreamy synth folk", title: "Lanterns", lyrics }, "fake-test-key", fetcher), "task-long");
  await assert.rejects(
    createSong({ description: "x".repeat(401), title: null, lyrics: null }, "fake-test-key", fetcher),
    /between 1 and 400 characters/,
  );
  const tooManyWords = Array.from({ length: 701 }, () => "la").join(" ");
  await assert.rejects(createSong({ description: "dreamy synth folk", title: "Lanterns", lyrics: tooManyWords }, "fake-test-key", fetcher), /700 words/);
  await assert.rejects(createSong({ description: "dreamy synth folk", title: "Lanterns", lyrics: "L".repeat(5_001) }, "fake-test-key", fetcher), /5,000 characters/);
});
test("polls until every clip has a final audio URL", async () => {
  assert.deepEqual(await pollSong("task-1", "fake-test-key", mockFetch({ code: 200, data: [] })), { status: "pending" });
  assert.deepEqual(await pollSong("task-1", "fake-test-key", mockFetch({
    code: 200, message: "streaming", data: [{ clip_id: "clip-1", state: "running", stream_audio_url: "https://stream.example/a", audio_url: null }],
  })), { status: "pending" });
  assert.deepEqual(await pollSong("task-1", "fake-test-key", mockFetch({
    code: 200, data: [
      { clip_id: "clip-1", state: "succeeded", title: "Night Drive", audio_url: "https://cdn.example/song.mp3", duration: 181.3 },
      { clip_id: "clip-2", state: "running", audio_url: null },
    ],
  })), { status: "pending" });
  assert.deepEqual(await pollSong("task-1", "fake-test-key", mockFetch({
    code: 200, message: "streaming",
    data: [{ clip_id: "clip-1", state: "succeeded", audio_url: "https://cdn.example/song.mp3" }],
  }, 202)), { status: "pending" });
  assert.deepEqual(await pollSong("task-1", "fake-test-key", mockFetch({
    code: 200, message: "success", data: [{ clip_id: "clip-1", state: "succeeded", title: "Night Drive", audio_url: "https://cdn.example/song.mp3", duration: 181.3 }],
  })), {
    status: "succeeded", clips: [{
      clipId: "clip-1", title: "Night Drive", audioUrl: "https://cdn.example/song.mp3",
      imageUrl: null, videoUrl: null, lyrics: null, durationSeconds: 181,
    }],
  });
});

test("failed and malformed results never create success links", async () => {
  assert.deepEqual(await pollSong("task-1", "fake-test-key", mockFetch({ code: 200, message: "success", data: [{ state: "failed" }] })), {
    status: "failed", reason: "Music provider returned no successful clips",
  });
  await assert.rejects(
    pollSong("task-1", "fake-test-key", mockFetch({ code: 200, data: [{ clip_id: "clip-1", state: "succeeded", audio_url: "javascript:alert(1)" }] })),
    SongProviderError,
  );
  await assert.rejects(createSong({ description: "demo", title: null, lyrics: null }, "fake-test-key", mockFetch({ error: "invalid" }, 401)), /HTTP 401/);
});

test("failed create errors retain status and sanitized provider response body", async () => {
  const responseBody = JSON.stringify({
    error: "insufficient credits",
    api_key: "fake-test-key",
    details: { token: "provider-secret", retry_after: 30 },
  });
  const fetcher = (async () => new Response(responseBody, {
    status: 402,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;

  await assert.rejects(
    createSong({ description: "test", title: null, lyrics: null }, "fake-test-key", fetcher),
    (error: unknown) => {
      assert.ok(error instanceof SongProviderError);
      assert.equal(error.status, 402);
      assert.match(error.responseBody ?? "", /insufficient credits/);
      assert.match(error.responseBody ?? "", /retry_after/);
      assert.doesNotMatch(error.responseBody ?? "", /fake-test-key|provider-secret/);
      return true;
    },
  );
});