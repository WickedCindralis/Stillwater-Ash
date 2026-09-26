import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// One owner's currently paired device and at most one pending QR pairing.
// The callback token is stored only as a hash, never returned to the browser.
export const ashLovense = pgTable("ash_lovense", {
  id: text("id").primaryKey(), // always "ash"
  uid: text("uid").notNull().default(""),
  toyId: text("toy_id").notNull().default(""),
  pendingUid: text("pending_uid").notNull().default(""),
  pendingTokenHash: text("pending_token_hash").notNull().default(""),
  qrUrl: text("qr_url").notNull().default(""),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  pairedAt: timestamp("paired_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});