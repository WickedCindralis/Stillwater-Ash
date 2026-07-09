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
  selfPromptPaused: integer("self_prompt_paused").notNull().default(0),
  selfPromptIntervalOverride: integer("self_prompt_interval_override")
    .notNull()
    .default(0), // minutes; 0 = status-based
  apiKillSwitch: integer("api_kill_switch").notNull().default(0),
  selfPromptIncludeHistory: integer("self_prompt_include_history")
    .notNull()
    .default(1), // include recent chat history in proactive self-prompt windows
  modelPrimary: text("model_primary").notNull().default("gpt-5.1"),
  modelFallback: text("model_fallback").notNull().default("gpt-5-mini"),
  activeModel: text("active_model").notNull().default("primary"), // "primary" | "fallback"
  voiceId: text("voice_id").notNull().default(""),
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
  apiKillSwitch: z.number().int().min(0).max(1).optional(),
  selfPromptIncludeHistory: z.number().int().min(0).max(1).optional(),
  modelPrimary: z.string().optional(),
  modelFallback: z.string().optional(),
  activeModel: z.enum(["primary", "fallback"]).optional(),
  voiceId: z.string().optional(),
});
export type UpdateSettingsPayload = z.infer<typeof updateSettingsSchema>;
