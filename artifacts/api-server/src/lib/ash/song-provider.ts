const ORIGIN = "https://api.aimusicapi.ai";
const REQUEST_TIMEOUT_MS = 25_000;

export type SongClip = {
  clipId: string;
  title: string;
  audioUrl: string;
  imageUrl: string | null;
  videoUrl: string | null;
  lyrics: string | null;
  durationSeconds: number | null;
};

export type SongTaskResult =
  | { status: "pending" }
  | { status: "failed"; reason: string }
  | { status: "succeeded"; clips: SongClip[] };

export class SongProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function request(path: string, key: string, init: RequestInit, fetcher: typeof fetch): Promise<{ body: Record<string, unknown>; httpStatus: number }> {
  const response = await fetcher(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new SongProviderError(`Music provider returned HTTP ${response.status}`, response.status);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SongProviderError("Music provider returned an invalid response");
  }
  const record = body as Record<string, unknown>;
  if (typeof record.code === "number" && record.code !== 200) {
    throw new SongProviderError(`Music provider returned code ${record.code}`);
  }
  return { body: record, httpStatus: response.status };
}

export type SongRequest = { description: string; title: string | null; lyrics: string | null };

export async function createSong(song: SongRequest, key: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!song.description.trim() || song.description.length > 400) {
    throw new SongProviderError("SONG description must be between 1 and 400 characters");
  }
  if (song.lyrics !== null && (!song.lyrics.trim() || song.lyrics.length > 700 || !song.title || song.title.length > 80)) {
    throw new SongProviderError("Custom lyrics require a title of at most 80 characters and 1–700 characters of lyrics");
  }
  const description = song.lyrics === null
    ? { custom_mode: false, gpt_description_prompt: song.description }
    : { custom_mode: true, title: song.title, tags: song.description, prompt: song.lyrics };
  const { body } = await request("/api/v1/sonic/create", key, {
    method: "POST",
    body: JSON.stringify({
      task_type: "create_music",
      mv: "chirp-v6",
      ...description,
    }),
  }, fetcher);
  if (typeof body.task_id !== "string" || !body.task_id.trim()) {
    throw new SongProviderError("Music provider did not return a task ID");
  }
  return body.task_id;
}

function validAudioUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function pollSong(taskId: string, key: string, fetcher: typeof fetch = fetch): Promise<SongTaskResult> {
  const { body, httpStatus } = await request(`/api/v1/sonic/task/${encodeURIComponent(taskId)}`, key, { method: "GET" }, fetcher);
  if (String(body.status ?? "").toLowerCase() === "failed" || String(body.message ?? "").toLowerCase() === "failed") {
    return { status: "failed", reason: "Music provider marked the task as failed" };
  }
  if (!Array.isArray(body.data) || body.data.length === 0) return { status: "pending" };
  const songs = body.data as unknown[];
  const clips: SongClip[] = [];
  let unfinished = false;
  for (const value of songs) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SongProviderError("Music provider returned an invalid clip");
    }
    const song = value as Record<string, unknown>;
    const state = String(song.state ?? "").toLowerCase();
    if (state === "failed") continue;
    if (state !== "succeeded") {
      unfinished = true;
      continue;
    }
    const audioUrl = validAudioUrl(song.audio_url);
    if (!audioUrl || typeof song.clip_id !== "string" || !song.clip_id) {
      throw new SongProviderError("Completed song has no final audio URL or clip ID");
    }
    clips.push({
      clipId: song.clip_id,
      title: typeof song.title === "string" && song.title.trim() ? song.title.trim().slice(0, 200) : "Untitled song",
      audioUrl,
      imageUrl: validAudioUrl(song.image_url),
      videoUrl: validAudioUrl(song.video_url),
      lyrics: typeof song.lyrics === "string" ? song.lyrics : null,
      durationSeconds: typeof song.duration === "number" && Number.isFinite(song.duration) ? Math.round(song.duration) : null,
    });
  }
  if (unfinished) return { status: "pending" };
  // A streaming (202) response can expose one finished clip before the
  // provider has returned the complete set. Wait for task-level completion.
  if (httpStatus === 202 || (body.message !== "success" && body.status !== "succeeded")) {
    return { status: "pending" };
  }
  if (!clips.length) return { status: "failed", reason: "Music provider returned no successful clips" };
  return { status: "succeeded", clips };
}