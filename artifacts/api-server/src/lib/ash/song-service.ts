import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, ashActivity, ashSongClips, ashSongJobs, type AshSongJob } from "@workspace/db";
import { logger } from "../logger";
import { storage } from "./storage";
import { createSong, pollSong, SongProviderError, type SongClip } from "./song-provider";

export const SONG_POLL_INTERVAL_MS = 2 * 60_000;
const WORKER_TICK_MS = 30_000;
const MAX_JOB_AGE_MS = 2 * 60 * 60_000;
const START_TIMEOUT_MS = 5 * 60_000;
const LEASE_MS = 90_000;
// All Ash contexts share one budget so untrusted public Discord traffic
// cannot cause unbounded paid creates, even across preview/production workers.
const MAX_DAILY_SONGS = 12;
let working = false;
let started = false;
let warnedMissingKey = false;

export async function enqueueSong(prompt: string, source: string, responseId: string): Promise<void> {
  if (!process.env["AIMUSICAPI_KEY"]?.trim()) {
    throw new Error("Music provider is not configured");
  }
  const id = responseId && responseId !== "unknown" ? `openai:${responseId}` : randomUUID();
  const inserted = await db.transaction(async (tx) => {
    // The transaction-scoped lock serializes the limit check across instances.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(8812339)`);
    const [existing] = await tx.select({ id: ashSongJobs.id }).from(ashSongJobs).where(eq(ashSongJobs.id, id)).limit(1);
    if (existing) return false;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(ashSongJobs)
      .where(gte(ashSongJobs.createdAt, today));
    if ((usage?.count ?? 0) >= MAX_DAILY_SONGS) {
      throw new Error(`Daily song limit of ${MAX_DAILY_SONGS} reached`);
    }
    await tx.insert(ashSongJobs).values({ id, source, prompt });
    return true;
  });
  if (!inserted) return;
  logger.info({ jobId: id, source }, "[ash-song] Song command queued");
  void processSongJobs().catch((error) => logger.error({ error }, "[ash-song] Worker failed"));
}

async function failSong(job: AshSongJob, token: string, reason: string): Promise<void> {
  const saved = await db.transaction(async (tx) => {
    const rows = await tx.update(ashSongJobs).set({
      status: "failed", lastError: reason.slice(0, 500), leaseToken: null,
      leaseUntil: null, updatedAt: new Date(),
    }).where(and(eq(ashSongJobs.id, job.id), eq(ashSongJobs.status, job.status), eq(ashSongJobs.leaseToken, token)))
      .returning({ id: ashSongJobs.id });
    if (!rows.length) return false;
    await tx.insert(ashActivity).values({ kind: "song_failed", message: `Song generation failed: ${reason.slice(0, 300)}` });
    return true;
  });
  if (saved) logger.error({ jobId: job.id, taskId: job.providerTaskId, reason }, "[ash-song] Generation failed");
}

async function finishSong(job: AshSongJob, token: string, clips: SongClip[]): Promise<void> {
  const saved = await db.transaction(async (tx) => {
    const rows = await tx.update(ashSongJobs).set({
      status: "succeeded", leaseToken: null, leaseUntil: null, lastError: "", updatedAt: new Date(),
    }).where(and(eq(ashSongJobs.id, job.id), eq(ashSongJobs.status, "pending"), eq(ashSongJobs.leaseToken, token)))
      .returning({ id: ashSongJobs.id });
    if (!rows.length) return false;
    for (const clip of clips) {
      await tx.insert(ashSongClips).values({
        jobId: job.id, clipId: clip.clipId, title: clip.title, audioUrl: clip.audioUrl,
        imageUrl: clip.imageUrl, videoUrl: clip.videoUrl, lyrics: clip.lyrics,
        durationSeconds: clip.durationSeconds,
      }).onConflictDoNothing({ target: [ashSongClips.jobId, ashSongClips.clipId] });
      await tx.insert(ashActivity).values({
        kind: "song_generated", message: `Song generated: ${clip.title}\n${clip.audioUrl}`,
      });
    }
    return true;
  });
  if (saved) {
    for (const clip of clips) logger.info({ jobId: job.id, taskId: job.providerTaskId, audioUrl: clip.audioUrl }, "[ash-song] Song generated and saved");
  }
}

async function rescheduleSong(job: AshSongJob, token: string, reason = ""): Promise<void> {
  await db.update(ashSongJobs).set({
    nextPollAt: new Date(Date.now() + SONG_POLL_INTERVAL_MS),
    leaseToken: null, leaseUntil: null, lastError: reason.slice(0, 500), updatedAt: new Date(),
  }).where(and(eq(ashSongJobs.id, job.id), eq(ashSongJobs.status, "pending"), eq(ashSongJobs.leaseToken, token)));
}

async function submitSong(job: AshSongJob, token: string, key: string): Promise<void> {
  try {
    if ((await storage.getState()).apiKillSwitch === 1) {
      await db.update(ashSongJobs).set({ status: "queued", leaseToken: null, leaseUntil: null, updatedAt: new Date() })
        .where(and(eq(ashSongJobs.id, job.id), eq(ashSongJobs.status, "starting"), eq(ashSongJobs.leaseToken, token)));
      return;
    }
    logger.info({ jobId: job.id, source: job.source }, "[ash-song] Provider create request started");
    const taskId = await createSong(job.prompt, key);
    const rows = await db.update(ashSongJobs).set({
      status: "pending", providerTaskId: taskId, leaseToken: null, leaseUntil: null,
      nextPollAt: new Date(Date.now() + SONG_POLL_INTERVAL_MS), updatedAt: new Date(),
    }).where(and(eq(ashSongJobs.id, job.id), eq(ashSongJobs.status, "starting"), eq(ashSongJobs.leaseToken, token)))
      .returning({ id: ashSongJobs.id });
    if (!rows.length) {
      logger.error({ jobId: job.id, taskId }, "[ash-song] Provider accepted request but job claim was lost");
      return;
    }
    logger.info({ jobId: job.id, taskId, nextPollMs: SONG_POLL_INTERVAL_MS }, "[ash-song] Provider task accepted");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await failSong({ ...job, status: "starting" }, token, reason);
  }
}

async function checkSong(job: AshSongJob, token: string, key: string): Promise<void> {
  if (!job.providerTaskId) {
    await failSong(job, token, "Pending song has no provider task ID");
    return;
  }
  if (Date.now() - job.createdAt.getTime() >= MAX_JOB_AGE_MS) {
    await failSong(job, token, "Music provider did not finish within two hours");
    return;
  }
  try {
    if ((await storage.getState()).apiKillSwitch === 1) {
      await rescheduleSong(job, token);
      return;
    }
    logger.info({ jobId: job.id, taskId: job.providerTaskId }, "[ash-song] Polling provider task");
    const result = await pollSong(job.providerTaskId, key);
    if (result.status === "succeeded") await finishSong(job, token, result.clips);
    else if (result.status === "failed") await failSong(job, token, result.reason);
    else await rescheduleSong(job, token);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof SongProviderError && [400, 401, 403, 404].includes(error.status ?? 0)) {
      await failSong(job, token, reason);
    } else {
      logger.error({ jobId: job.id, taskId: job.providerTaskId, reason }, "[ash-song] Poll failed; retrying in two minutes");
      await rescheduleSong(job, token, reason);
    }
  }
}

export async function processSongJobs(): Promise<void> {
  if (working) return;
  working = true;
  try {
    const key = process.env["AIMUSICAPI_KEY"]?.trim();
    if (!key) {
      if (!warnedMissingKey) logger.warn("[ash-song] AIMUSICAPI_KEY not configured; song tasks remain queued");
      warnedMissingKey = true;
      return;
    }
    warnedMissingKey = false;
    if ((await storage.getState()).apiKillSwitch === 1) return;

    // Never resubmit an uncertain create call after a crash: it might have been
    // accepted and billed before the provider task ID could be saved.
    const stale = await db.update(ashSongJobs).set({
      status: "failed", lastError: "Create request interrupted; provider task ID unknown",
      leaseToken: null, leaseUntil: null, updatedAt: new Date(),
    }).where(and(eq(ashSongJobs.status, "starting"), lt(ashSongJobs.updatedAt, new Date(Date.now() - START_TIMEOUT_MS))))
      .returning({ id: ashSongJobs.id });
    for (const row of stale) {
      logger.error({ jobId: row.id }, "[ash-song] Interrupted create cannot be retried safely");
      await storage.logActivity("song_failed", "Song generation interrupted before the provider task ID was saved");
    }

    const queued = await db.select().from(ashSongJobs).where(eq(ashSongJobs.status, "queued"))
      .orderBy(asc(ashSongJobs.createdAt)).limit(5);
    await Promise.all(queued.map(async (job) => {
      const token = randomUUID();
      const [claimed] = await db.update(ashSongJobs).set({
        status: "starting", leaseToken: token, leaseUntil: new Date(Date.now() + LEASE_MS), updatedAt: new Date(),
      }).where(and(eq(ashSongJobs.id, job.id), eq(ashSongJobs.status, "queued"))).returning();
      if (claimed) await submitSong(claimed, token, key);
    }));

    const now = new Date();
    const due = await db.select().from(ashSongJobs).where(and(
      eq(ashSongJobs.status, "pending"), lte(ashSongJobs.nextPollAt, now),
      or(isNull(ashSongJobs.leaseUntil), lte(ashSongJobs.leaseUntil, now)),
    )).orderBy(asc(ashSongJobs.nextPollAt)).limit(10);
    await Promise.all(due.map(async (job) => {
      const token = randomUUID();
      const [claimed] = await db.update(ashSongJobs).set({
        leaseToken: token, leaseUntil: new Date(Date.now() + LEASE_MS), updatedAt: new Date(),
      }).where(and(
        eq(ashSongJobs.id, job.id), eq(ashSongJobs.status, "pending"),
        lte(ashSongJobs.nextPollAt, new Date()),
        or(isNull(ashSongJobs.leaseUntil), lte(ashSongJobs.leaseUntil, new Date())),
      )).returning();
      if (claimed) await checkSong(claimed, token, key);
    }));
  } finally {
    working = false;
  }
}

export function startSongWorker(): void {
  if (started) return;
  started = true;
  const run = () => void processSongJobs().catch((error) => logger.error({ error }, "[ash-song] Worker failed"));
  run();
  setInterval(run, WORKER_TICK_MS);
}