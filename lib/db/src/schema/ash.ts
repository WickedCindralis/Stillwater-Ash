import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  varchar,
  json,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

// Single-row state table for Ash. Table names are prefixed with ash_ so the
// container can safely share a database without colliding with other apps.
export const ashState = pgTable("ash_state", {
  id: text("id").primaryKey(), // always "ash"
  name: text("name").notNull().default("Ash_Cindralis"),
  status: text("status").notNull().default("online"),
  lastHeartbeat: timestamp("last_heartbeat"),
  tokensUsed: integer("tokens_used").notNull().default(0),
  // A new column on an existing row inherits the month of deployment so its
  // current displayed amount is preserved until the next calendar month.
  tokensMonth: text("tokens_month").notNull()
    .default(sql`to_char(now() AT TIME ZONE 'America/New_York', 'YYYY-MM')`),
  selfPromptPaused: integer("self_prompt_paused").notNull().default(1),
  selfPromptIntervalOverride: integer("self_prompt_interval_override")
    .notNull()
    .default(0), // minutes; 0 = status-based
  heartbeatIntervalOverride: integer("heartbeat_interval_override")
    .notNull()
    .default(0), // minutes; 0 = status-based. Rate limiter for heartbeat (DB ping) writes.
  apiKillSwitch: integer("api_kill_switch").notNull().default(1),
  discordKillSwitch: integer("discord_kill_switch").notNull().default(0),
  selfPromptIncludeHistory: integer("self_prompt_include_history")
    .notNull()
    .default(1), // include recent chat history in proactive self-prompt windows
  screenCaptureEnabled: integer("screen_capture_enabled").notNull().default(0),
  screenCaptureTokenHash: text("screen_capture_token_hash").notNull().default(""),
  screenCaptureTokenCreatedAt: timestamp("screen_capture_token_created_at"),
  screenCaptureCompanionId: text("screen_capture_companion_id").notNull().default(""),
  screenCaptureLastSeen: timestamp("screen_capture_last_seen"),
  screenCaptureLastCaptureAt: timestamp("screen_capture_last_capture_at"),
  screenCaptureLastError: text("screen_capture_last_error").notNull().default(""),
  modelPrimary: text("model_primary").notNull().default("gpt-5.1"),
  modelFallback: text("model_fallback").notNull().default("gpt-5-mini"),
  activeModel: text("active_model").notNull().default("primary"), // "primary" | "fallback"
  voiceId: text("voice_id").notNull().default(""),
  wickedStatus: text("wicked_status").notNull().default("online"), // "online" | "away" | "busy" | "asleep" | "offline"
  wickedStatusMessage: text("wicked_status_message").notNull().default(""),
  // Editable persona packet overrides. Empty string = use the built-in default in code.
  personaIdentity: text("persona_identity").notNull().default(""),
  personaSoulSheet: text("persona_soul_sheet").notNull().default(""),
  personaCoreAnchors: text("persona_core_anchors").notNull().default(""),
  // ASH'S NOTES: the one packet section Ash himself can live-edit (via
  // [NOTES]...[/NOTES] blocks in his replies). Capped at ~2k tokens.
  personaAshNotes: text("persona_ash_notes").notNull().default(""),
  // Editable fifth persona section used only by the Story workspace.
  personaStoryPacket: text("persona_story_packet").notNull().default(""),
  // Public-safe continuity is produced inside an existing Stillwater call,
  // then reused by Discord without a second model request.
  discordContinuitySummary: text("discord_continuity_summary").notNull().default(""),
  // Court Herald: TikTok account to watch (read-only, via scraper service).
  tiktokUsername: text("tiktok_username").notNull().default(""),
});

// Story workspace. There is exactly one manuscript per Ash container.
export const ashStory = pgTable("ash_story", {
  id: text("id").primaryKey(), // always "ash"
  title: text("title").notNull().default(""),
  storyPacket: text("story_packet").notNull().default(""),
  rollingSummary: text("rolling_summary").notNull().default(""),
  runStatus: text("run_status").notNull().default("idle"), // idle | running | paused | failed | complete
  activeRunId: text("active_run_id").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const ashStoryChapters = pgTable("ash_story_chapters", {
  id: serial("id").primaryKey(),
  storyId: text("story_id").notNull().default("ash"),
  position: integer("position").notNull().default(1),
  title: text("title").notNull().default(""),
  content: text("content").notNull().default(""),
  continuation: text("continuation").notNull().default(""),
  status: text("status").notNull().default("complete"), // complete | unfinished
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("ash_story_chapters_story_position_idx").on(table.storyId, table.position),
]);

export const ashStoryRuns = pgTable("ash_story_runs", {
  id: text("id").primaryKey(),
  storyId: text("story_id").notNull().default("ash"),
  status: text("status").notNull().default("running"), // running | complete | failed | paused
  prompt: text("prompt").notNull().default(""),
  chapterId: integer("chapter_id"),
  leaseGeneration: integer("lease_generation").notNull().default(0),
  checkpoint: text("checkpoint").notNull().default(""),
  output: text("output").notNull().default(""),
  error: text("error").notNull().default(""),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
});

export const ashStoryLease = pgTable("ash_story_lease", {
  id: text("id").primaryKey(), // always "ash"
  token: text("token").notNull(),
  generation: integer("generation").notNull().default(0),
  expiresAt: timestamp("expires_at").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const ashStoryErrors = pgTable("ash_story_errors", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Court Herald: TikTok comments fetched read-only from a scraper service.
// Status is Wicked's triage: "new" | "answered" | "ignored" | "saved".
export const ashTiktokComments = pgTable("ash_tiktok_comments", {
  id: serial("id").primaryKey(),
  commentId: text("comment_id").notNull().unique(),
  videoId: text("video_id").notNull(),
  videoDesc: text("video_desc").notNull().default(""),
  videoUrl: text("video_url").notNull().default(""),
  author: text("author").notNull().default(""),
  text: text("text").notNull(),
  commentCreatedAt: timestamp("comment_created_at"),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  status: text("status").notNull().default("new"),
  draft: text("draft").notNull().default(""),
  seenByAsh: integer("seen_by_ash").notNull().default(0),
});

// Discord Court Herald: Wicked explicitly selects these halls. No Discord
// message is retained or delivered to Ash unless its channel appears here.
export const ashDiscordChannels = pgTable(
  "ash_discord_channels",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    guildName: text("guild_name").notNull().default(""),
    channelId: text("channel_id").notNull(),
    channelName: text("channel_name").notNull().default(""),
    selectedAt: timestamp("selected_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ash_discord_channels_channel_id_unique").on(table.channelId),
    index("ash_discord_channels_guild_id_idx").on(table.guildId),
  ],
);

// Bounded public Discord evidence and delivery state. `id` is an internal
// packet identifier; Discord message IDs are never model-authorized directly.
export const ashDiscordMessages = pgTable(
  "ash_discord_messages",
  {
    id: serial("id").primaryKey(),
    discordMessageId: text("discord_message_id").notNull().unique(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    channelName: text("channel_name").notNull().default(""),
    authorId: text("author_id").notNull(),
    authorName: text("author_name").notNull().default(""),
    content: text("content").notNull(),
    kind: text("kind").notNull().default("context"), // context | call | owner_call
    deliveryStatus: text("delivery_status").notNull().default("context"), // context | queued | processing | sending | replied | skipped | failed
    deliveryLeaseId: text("delivery_lease_id").notNull().default(""),
    deliveryLeaseExpiresAt: timestamp("delivery_lease_expires_at"),
    replyDiscordMessageId: text("reply_discord_message_id").notNull().default(""),
    deliveryError: text("delivery_error").notNull().default(""),
    createdAt: timestamp("created_at").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("ash_discord_messages_channel_created_idx").on(table.channelId, table.createdAt),
    index("ash_discord_messages_delivery_idx").on(table.deliveryStatus, table.id),
  ],
);

export const ashMessages = pgTable("ash_messages", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(), // "wicked" | "ash"
  content: text("content").notNull(),
  imageUrl: text("image_url").notNull().default(""),
  source: text("source").notNull().default("private_message"), // "private_message" | "self_prompt"
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Map screenshot activities to the canonical chat message that produced them.
// Bytes remain in ash_activity_screenshots and never enter normal chat history.
export const ashHangoutScreenshots = pgTable("ash_hangout_screenshots", {
  activityId: integer("activity_id").primaryKey()
    .references(() => ashActivity.id, { onDelete: "cascade" }),
  messageId: integer("message_id").notNull()
    .references(() => ashMessages.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
  companionTokenHash: text("companion_token_hash").notNull().default(""),
  correlationId: text("correlation_id").notNull().default(""),
  invalidated: integer("invalidated").notNull().default(0),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("ash_hangout_screenshots_message_idx").on(table.messageId),
]);

export const ashDiaryEntries = pgTable("ash_diary_entries", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Chronicles delivered by Blackthorn's approved Stillwater inbox. The upstream
// ID is the idempotency key; delivery is not complete until the proactive diary
// write has succeeded and the Stillwater-only acknowledgement has been sent.
export const ashChronicles = pgTable(
  "ash_chronicles",
  {
    id: serial("id").primaryKey(),
    chronicleId: text("chronicle_id").notNull(),
    content: text("content").notNull(),
    source: text("source").notNull().default("blackthorn_stillwater"),
    sourceMetadata: json("source_metadata"),
    status: text("status").notNull().default("received"), // received | acknowledged
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at"),
    lastError: text("last_error").notNull().default(""),
  },
  (table) => [
    uniqueIndex("ash_chronicles_chronicle_id_unique").on(table.chronicleId),
    index("ash_chronicles_status_idx").on(table.status, table.id),
  ],
);

// Activity feed: diary entries, bridge crossings (restarts), status changes, ping toggles, screenshots.
export const ashActivity = pgTable("ash_activity", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // "diary_entry" | "bridge" | "status" | "pings_off" | "pings_on" | "screen_capture"
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Screenshot bytes are kept separate so ordinary activity-feed queries never
// load large base64 payloads. Access is through an authenticated image route.
export const ashActivityScreenshots = pgTable("ash_activity_screenshots", {
  activityId: integer("activity_id")
    .primaryKey()
    .references(() => ashActivity.id, { onDelete: "cascade" }),
  imageDataUrl: text("image_data_url").notNull(),
  ready: integer("ready").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A single durable Hangout session coordinates all API instances. Pairing
// credentials and exchange leases are deliberately separate from capture auth.
export const ashHangoutSession = pgTable("ash_hangout_session", {
  id: text("id").primaryKey().default("ash"),
  sessionId: text("session_id").notNull().default(""),
  status: text("status").notNull().default("idle"), // idle | inviting | active
  generation: integer("generation").notNull().default(0),
  companionTokenHash: text("companion_token_hash").notNull().default(""),
  companionLastSeen: timestamp("companion_last_seen"),
  lastError: text("last_error").notNull().default(""),
  lastActivityAt: timestamp("last_activity_at"),
  lastIdleCheckinAt: timestamp("last_idle_checkin_at"),
  lastCaptureAt: timestamp("last_capture_at"),
  leaseToken: text("lease_token").notNull().default(""),
  leaseExpiresAt: timestamp("lease_expires_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Cross-instance rendezvous for the paired desktop capture poller. Only one
// fresh capture can be pending globally; image data is retained only until
// the waiting provider exchange consumes it.
export const ashCaptureRequest = pgTable("ash_capture_request", {
  id: text("id").primaryKey().default("ash"),
  requestId: text("request_id").notNull().default(""),
  sessionId: text("session_id").notNull().default(""),
  correlationId: text("correlation_id").notNull().default(""),
  status: text("status").notNull().default("idle"), // idle | pending | complete | cancelled
  expiresAt: timestamp("expires_at"),
  imageDataUrl: text("image_data_url").notNull().default(""),
  activityId: integer("activity_id"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Chess games between Wicked (White) and Ash (Black). One active game at a time.
export const ashChessGames = pgTable("ash_chess_games", {
  id: serial("id").primaryKey(),
  fen: text("fen").notNull(),
  moves: text("moves").notNull().default(""), // SAN history, space-separated (e.g. "e4 e5 Nf3")
  status: text("status").notNull().default("active"), // active | checkmate | stalemate | draw | resigned
  result: text("result").notNull().default(""), // "wicked" | "ash" | "draw" | "" (unfinished)
  paused: integer("paused").notNull().default(0), // 1 = Wicked stepped away; Ash is told not to wait
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Connect Four games between Wicked (gold discs, moves first) and Ash (ember discs).
export const ashConnect4Games = pgTable("ash_connect4_games", {
  id: serial("id").primaryKey(),
  moves: text("moves").notNull().default(""), // column numbers 1-7, space-separated, Wicked first
  status: text("status").notNull().default("active"), // active | won | draw | resigned | abandoned
  result: text("result").notNull().default(""), // "wicked" | "ash" | "draw" | "" (unfinished)
  paused: integer("paused").notNull().default(0), // 1 = Wicked stepped away; Ash is told not to wait
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Session table for connect-pg-simple (express-session store).
export const ashSession = pgTable(
  "ash_session",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (table) => [index("idx_ash_session_expire").on(table.expire)],
);

export const insertMessageSchema = createInsertSchema(ashMessages).omit({
  id: true,
  createdAt: true,
});
export const insertDiaryEntrySchema = createInsertSchema(ashDiaryEntries).omit({
  id: true,
  createdAt: true,
});
export const insertChronicleSchema = createInsertSchema(ashChronicles).omit({
  id: true,
  receivedAt: true,
  acknowledgedAt: true,
});
export const insertStoryChapterSchema = createInsertSchema(ashStoryChapters).omit({ id: true, createdAt: true, updatedAt: true });
export const updateStorySchema = z.object({
  title: z.string().max(500).optional(),
  storyPacket: z.string().max(48000).optional(),
  summary: z.string().max(24000).optional(),
});
export const writeStorySchema = z.object({ prompt: z.string().max(12000).default(""), resumeRunId: z.string().max(100).optional() });
export const updateStoryChapterSchema = z.object({
  title: z.string().max(500).optional(),
  content: z.string().max(500000).optional(),
  continuation: z.string().max(100000).optional(),
  status: z.enum(["complete", "unfinished"]).optional(),
});

export type AshState = typeof ashState.$inferSelect;
export type AshMessage = typeof ashMessages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type AshDiaryEntry = typeof ashDiaryEntries.$inferSelect;
export type InsertDiaryEntry = z.infer<typeof insertDiaryEntrySchema>;
export type AshChronicle = typeof ashChronicles.$inferSelect;
export type InsertChronicle = z.infer<typeof insertChronicleSchema>;
export type AshStory = typeof ashStory.$inferSelect;
export type AshStoryChapter = typeof ashStoryChapters.$inferSelect;
export type AshStoryRun = typeof ashStoryRuns.$inferSelect;
export type AshStoryLease = typeof ashStoryLease.$inferSelect;
export type AshStoryError = typeof ashStoryErrors.$inferSelect;
export type InsertStoryChapter = z.infer<typeof insertStoryChapterSchema>;
export type AshActivity = typeof ashActivity.$inferSelect;
export type AshActivityScreenshot = typeof ashActivityScreenshots.$inferSelect;
export type AshDiscordChannel = typeof ashDiscordChannels.$inferSelect;
export type AshDiscordMessage = typeof ashDiscordMessages.$inferSelect;

export type AshChessGame = typeof ashChessGames.$inferSelect;

export const chessMoveSchema = z.object({
  san: z.string().min(1).max(10),
  message: z.string().max(4000).default(""),
});
export type ChessMovePayload = z.infer<typeof chessMoveSchema>;

export type AshConnect4Game = typeof ashConnect4Games.$inferSelect;

export const connect4MoveSchema = z.object({
  column: z.number().int().min(1).max(7),
  message: z.string().max(4000).default(""),
});
export type Connect4MovePayload = z.infer<typeof connect4MoveSchema>;

export const sendMessageSchema = z.object({
  content: z.string().default(""),
  imageDataUrl: z.string().optional(),
  requestImage: z.boolean().default(false),
});
export type SendMessagePayload = z.infer<typeof sendMessageSchema>;

export const updateSettingsSchema = z.object({
  status: z.string().optional(),
  selfPromptPaused: z.number().int().min(0).max(1).optional(),
  selfPromptIntervalOverride: z.number().int().min(0).optional(),
  heartbeatIntervalOverride: z.number().int().min(0).optional(),
  apiKillSwitch: z.number().int().min(0).max(1).optional(),
  discordKillSwitch: z.number().int().min(0).max(1).optional(),
  selfPromptIncludeHistory: z.number().int().min(0).max(1).optional(),
  screenCaptureEnabled: z.number().int().min(0).max(1).optional(),
  modelPrimary: z.string().optional(),
  modelFallback: z.string().optional(),
  activeModel: z.enum(["primary", "fallback"]).optional(),
  voiceId: z.string().optional(),
  wickedStatus: z.enum(["online", "away", "busy", "asleep", "offline"]).optional(),
  wickedStatusMessage: z.string().max(500).optional(),
  tiktokUsername: z.string().max(100).optional(),
});
export type UpdateSettingsPayload = z.infer<typeof updateSettingsSchema>;

// Persona packet editor. Each section is capped so an oversized packet can't
// blow up the model's context window. Empty string = restore built-in default.
export const PERSONA_SECTION_MAX = 24000;
// ASH'S NOTES is capped at ~2k tokens (≈4 chars/token).
export const ASH_NOTES_MAX = 8000;
export const updatePersonaSchema = z.object({
  identity: z.string().max(PERSONA_SECTION_MAX).optional(),
  soulSheet: z.string().max(PERSONA_SECTION_MAX).optional(),
  coreAnchors: z.string().max(PERSONA_SECTION_MAX).optional(),
  ashNotes: z.string().max(ASH_NOTES_MAX).optional(),
  storyPacket: z.string().max(48000).optional(),
});
export type UpdatePersonaPayload = z.infer<typeof updatePersonaSchema>;

// Court Herald
export type AshTiktokComment = typeof ashTiktokComments.$inferSelect;
export type InsertTiktokComment = Omit<AshTiktokComment, "id" | "fetchedAt" | "status" | "draft" | "seenByAsh">;
export const updateHeraldCommentSchema = z.object({
  status: z.enum(["new", "answered", "ignored", "saved"]).optional(),
  draft: z.string().max(4000).optional(),
});
export type UpdateHeraldCommentPayload = z.infer<typeof updateHeraldCommentSchema>;

export const updateDiscordChannelsSchema = z.object({
  channels: z.array(z.object({
    guildId: z.string().min(1).max(64),
    guildName: z.string().max(200),
    channelId: z.string().min(1).max(64),
    channelName: z.string().max(200),
  })).max(100),
});
export type UpdateDiscordChannelsPayload = z.infer<typeof updateDiscordChannelsSchema>;
