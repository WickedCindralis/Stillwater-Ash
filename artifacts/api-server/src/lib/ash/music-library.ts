import { asc, desc, eq, isNull } from "drizzle-orm";
import { db, ashSongJobs, ashSongClips, ashSongStoredAudio } from "@workspace/db";
import { logger } from "../logger";
import { readSongAudioObject, saveSongAudioFromUrl } from "../image-storage";

function readableFailure(value: string): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { message?: string; providerStatus?: number | null; providerResponseBody?: string | null };
    const reason = parsed.message || "Song request failed";
    const status = parsed.providerStatus == null ? "" : ` (HTTP ${parsed.providerStatus})`;
    return `${reason}${status}${parsed.providerResponseBody ? `\n${parsed.providerResponseBody}` : ""}`;
  } catch {
    return value;
  }
}

function triggerLabel(source: string): string {
  if (source === "door:SONG") return "Song door";
  if (source === "proactive:door:SONG") return "Proactive window · Song door";
  if (source === "self_prompt") return "Proactive window";
  if (source === "private_message") return "Private chat";
  if (source.startsWith("discord")) return "Discord";
  return source;
}

async function storeClip(clipRowId: number, jobId: string, clipId: string, audioUrl: string): Promise<void> {
  const [existing] = await db.select({ id: ashSongStoredAudio.id }).from(ashSongStoredAudio)
    .where(eq(ashSongStoredAudio.clipRowId, clipRowId)).limit(1);
  if (existing) return;
  const stored = await saveSongAudioFromUrl(audioUrl, jobId, clipId);
  await db.insert(ashSongStoredAudio).values({
    clipRowId, objectPath: stored.objectPath, contentType: stored.contentType,
  }).onConflictDoNothing({ target: ashSongStoredAudio.clipRowId });
}

export async function backfillSongAudio(): Promise<{ stored: number; failed: string[] }> {
  const rows = await db.select({
    clipRowId: ashSongClips.id,
    jobId: ashSongClips.jobId,
    clipId: ashSongClips.clipId,
    audioUrl: ashSongClips.audioUrl,
  }).from(ashSongClips)
    .leftJoin(ashSongStoredAudio, eq(ashSongStoredAudio.clipRowId, ashSongClips.id))
    .where(isNull(ashSongStoredAudio.id));
  let stored = 0;
  const failed: string[] = [];
  for (const clip of rows) {
    try {
      await storeClip(clip.clipRowId, clip.jobId, clip.clipId, clip.audioUrl);
      stored++;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failed.push(`${clip.jobId}/${clip.clipId}: ${reason}`);
      logger.error({ jobId: clip.jobId, clipId: clip.clipId, reason }, "[ash-music] Audio backfill failed");
    }
  }
  return { stored, failed };
}

export async function storeGeneratedSongAudio(jobId: string): Promise<void> {
  const clips = await db.select({
    clipRowId: ashSongClips.id,
    clipId: ashSongClips.clipId,
    audioUrl: ashSongClips.audioUrl,
  }).from(ashSongClips).where(eq(ashSongClips.jobId, jobId));
  for (const clip of clips) await storeClip(clip.clipRowId, jobId, clip.clipId, clip.audioUrl);
}

export async function listMusicEntries() {
  await backfillSongAudio();
  const jobs = await db.select().from(ashSongJobs).orderBy(desc(ashSongJobs.createdAt));
  const entries = [];
  for (const job of jobs) {
    const clips = await db.select({
      id: ashSongClips.id,
      title: ashSongClips.title,
      audioUrl: ashSongClips.audioUrl,
      objectPath: ashSongStoredAudio.objectPath,
    }).from(ashSongClips)
      .leftJoin(ashSongStoredAudio, eq(ashSongStoredAudio.clipRowId, ashSongClips.id))
      .where(eq(ashSongClips.jobId, job.id)).orderBy(asc(ashSongClips.id));
    entries.push({
      id: job.id,
      title: job.title || clips[0]?.title || "Untitled",
      sound: job.prompt,
      lyrics: job.lyricsText || "",
      createdAt: job.createdAt,
      trigger: triggerLabel(job.source),
      status: job.status === "succeeded" ? "generated" : job.status === "failed" ? "failed" : "in_progress",
      failureReason: readableFailure(job.lastError),
      clips: clips.map((clip) => ({
        id: clip.id,
        title: clip.title,
        audioUrl: `/api/music/audio/${clip.id}`,
        downloadUrl: `/api/music/audio/${clip.id}?download=1`,
        stored: Boolean(clip.objectPath),
        fallbackUrl: clip.objectPath ? null : clip.audioUrl,
      })),
    });
  }
  return entries;
}

export async function getStoredSongAudio(clipRowId: number) {
  const [stored] = await db.select({
    objectPath: ashSongStoredAudio.objectPath,
    contentType: ashSongStoredAudio.contentType,
  }).from(ashSongStoredAudio).where(eq(ashSongStoredAudio.clipRowId, clipRowId)).limit(1);
  if (!stored) return null;
  return { ...await readSongAudioObject(stored.objectPath), contentType: stored.contentType };
}
