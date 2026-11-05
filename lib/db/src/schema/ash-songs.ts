import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Task and clip records are durable across API instances and restarts.
export const ashSongJobs = pgTable("ash_song_jobs", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  prompt: text("prompt").notNull(),
  title: text("title"),
  lyricsText: text("lyrics_text"),
  status: text("status").notNull().default("queued"), // queued | starting | pending | succeeded | failed
  providerTaskId: text("provider_task_id"),
  nextPollAt: timestamp("next_poll_at", { withTimezone: true }),
  leaseToken: text("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  lastError: text("last_error").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("ash_song_jobs_due_idx").on(table.status, table.nextPollAt),
  uniqueIndex("ash_song_jobs_provider_task_idx").on(table.providerTaskId),
]);

export const ashSongClips = pgTable("ash_song_clips", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => ashSongJobs.id),
  clipId: text("clip_id").notNull(),
  title: text("title").notNull().default("Untitled song"),
  audioUrl: text("audio_url").notNull(),
  imageUrl: text("image_url"),
  videoUrl: text("video_url"),
  lyrics: text("lyrics"),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ash_song_clips_job_clip_idx").on(table.jobId, table.clipId),
  index("ash_song_clips_job_idx").on(table.jobId),
]);

// Keeps durable App Storage paths separate from the original provider clip rows.
export const ashSongStoredAudio = pgTable("ash_song_stored_audio", {
  id: serial("id").primaryKey(),
  clipRowId: integer("clip_row_id").notNull().references(() => ashSongClips.id),
  objectPath: text("object_path").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ash_song_stored_audio_clip_idx").on(table.clipRowId),
]);

export type AshSongJob = typeof ashSongJobs.$inferSelect;