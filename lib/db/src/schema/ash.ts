import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  varchar,
  json,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Single-row state table for Ash. Table names are prefixed with ash_ so the
// container can safely share a database without colliding with other apps.
export const ashState = pgTable("ash_state", {
  id: text("id").primaryKey(), // always "ash"
  name: text("name").notNull().default("Ash_Cindralis"),
  status: text("status").notNull().default("online"),
  lastHeartbeat: timestamp("last_heartbeat"),
  tokensUsed: integer("tokens_used").notNull().default(0),
  selfPromptPaused: integer("self_prompt_paused").notNull().default(1),
  selfPromptIntervalOverride: integer("self_prompt_interval_override")
    .notNull()
    .default(0), // minutes; 0 = status-based
  heartbeatIntervalOverride: integer("heartbeat_interval_override")
    .notNull()
    .default(0), // minutes; 0 = status-based. Rate limiter for heartbeat (DB ping) writes.
  apiKillSwitch: integer("api_kill_switch").notNull().default(1),
  selfPromptIncludeHistory: integer("self_prompt_include_history")
    .notNull()
    .default(1), // include recent chat history in proactive self-prompt windows
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
  // Court Herald: TikTok account to watch (read-only, via scraper service).
  tiktokUsername: text("tiktok_username").notNull().default(""),
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

export const ashMessages = pgTable("ash_messages", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(), // "wicked" | "ash"
  content: text("content").notNull(),
  imageUrl: text("image_url").notNull().default(""),
  source: text("source").notNull().default("private_message"), // "private_message" | "self_prompt"
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const ashDiaryEntries = pgTable("ash_diary_entries", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Activity feed: diary entries, bridge crossings (restarts), status changes, ping toggles.
export const ashActivity = pgTable("ash_activity", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // "diary_entry" | "bridge" | "status" | "pings_off" | "pings_on"
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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

export type AshState = typeof ashState.$inferSelect;
export type AshMessage = typeof ashMessages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type AshDiaryEntry = typeof ashDiaryEntries.$inferSelect;
export type InsertDiaryEntry = z.infer<typeof insertDiaryEntrySchema>;
export type AshActivity = typeof ashActivity.$inferSelect;

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
  selfPromptIncludeHistory: z.number().int().min(0).max(1).optional(),
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
export const updatePersonaSchema = z.object({
  identity: z.string().max(PERSONA_SECTION_MAX).optional(),
  soulSheet: z.string().max(PERSONA_SECTION_MAX).optional(),
  coreAnchors: z.string().max(PERSONA_SECTION_MAX).optional(),
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
