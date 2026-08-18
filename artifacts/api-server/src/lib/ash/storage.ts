import {
  db,
  ashState,
  ashMessages,
  ashDiaryEntries,
  ashActivity,
  ashChessGames,
  ashConnect4Games,
  type AshChessGame,
  type AshConnect4Game,
  type AshState,
  type AshMessage,
  type InsertMessage,
  type AshDiaryEntry,
  type InsertDiaryEntry,
  type AshActivity,
  ashTiktokComments,
  type AshTiktokComment,
} from "@workspace/db";
import { eq, desc, inArray, and, like, lt } from "drizzle-orm";

const ASH_ID = "ash";

export interface IStorage {
  getState(): Promise<AshState>;
  updateState(patch: Partial<Omit<AshState, "id">>): Promise<AshState>;
  getMessages(limit?: number, beforeId?: number): Promise<AshMessage[]>;
  getAllMessages(): Promise<AshMessage[]>;
  purgeMessagesKeepLast(keep: number): Promise<number>;
  getMessageById(id: number): Promise<AshMessage | null>;
  clearWickedPhotos(): Promise<number>;
  createMessage(msg: InsertMessage): Promise<AshMessage>;
  getRecentHistory(limit: number): Promise<AshMessage[]>;
  getDiaryEntries(): Promise<AshDiaryEntry[]>;
  createDiaryEntry(entry: InsertDiaryEntry): Promise<AshDiaryEntry>;
  deleteDiaryEntry(id: number): Promise<void>;
  logActivity(kind: string, message: string): Promise<void>;
  getActivity(limit?: number): Promise<AshActivity[]>;
  migrateReflectionsToDiary(): Promise<number>;
  getCurrentChessGame(): Promise<AshChessGame | null>;
  createChessGame(fen: string): Promise<AshChessGame>;
  updateChessGame(
    id: number,
    patch: Partial<Omit<AshChessGame, "id" | "createdAt">>,
  ): Promise<AshChessGame>;
  getCurrentConnect4Game(): Promise<AshConnect4Game | null>;
  createConnect4Game(): Promise<AshConnect4Game>;
  updateConnect4Game(
    id: number,
    patch: Partial<Omit<AshConnect4Game, "id" | "createdAt">>,
  ): Promise<AshConnect4Game>;
  listTiktokComments(limit?: number): Promise<AshTiktokComment[]>;
  updateTiktokComment(
    id: number,
    patch: Partial<Pick<AshTiktokComment, "status" | "draft">>,
  ): Promise<AshTiktokComment | null>;
  claimUnseenTiktokComments(limit: number): Promise<AshTiktokComment[]>;
  releaseTiktokCommentsClaim(ids: number[]): Promise<void>;
}

export class DbStorage implements IStorage {
  async getState(): Promise<AshState> {
    const rows = await db
      .select()
      .from(ashState)
      .where(eq(ashState.id, ASH_ID));
    if (rows.length === 0) {
      const inserted = await db
        .insert(ashState)
        .values({ id: ASH_ID })
        .returning();
      return inserted[0]!;
    }
    return rows[0]!;
  }

  async updateState(patch: Partial<Omit<AshState, "id">>): Promise<AshState> {
    const rows = await db
      .update(ashState)
      .set(patch)
      .where(eq(ashState.id, ASH_ID))
      .returning();
    return rows[0]!;
  }

  async getMessages(limit = 200, beforeId?: number): Promise<AshMessage[]> {
    // The live chat only ever shows direct exchange between Wicked and Ash.
    // Proactive reflective-window output lives in the diary, not here.
    // `beforeId` pages further back in history (messages older than that id).
    const where = beforeId
      ? and(eq(ashMessages.source, "private_message"), lt(ashMessages.id, beforeId))
      : eq(ashMessages.source, "private_message");
    const rows = await db
      .select()
      .from(ashMessages)
      .where(where)
      .orderBy(desc(ashMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  async getAllMessages(): Promise<AshMessage[]> {
    return db
      .select()
      .from(ashMessages)
      .where(eq(ashMessages.source, "private_message"))
      .orderBy(ashMessages.id);
  }

  async purgeMessagesKeepLast(keep: number): Promise<number> {
    const recent = await db
      .select({ id: ashMessages.id })
      .from(ashMessages)
      .where(eq(ashMessages.source, "private_message"))
      .orderBy(desc(ashMessages.id))
      .limit(keep);
    const cutoff = recent.length > 0 ? recent[recent.length - 1]!.id : null;
    if (cutoff === null) return 0;
    const gone = await db
      .delete(ashMessages)
      .where(
        and(eq(ashMessages.source, "private_message"), lt(ashMessages.id, cutoff)),
      )
      .returning({ id: ashMessages.id });
    return gone.length;
  }

  async getMessageById(id: number): Promise<AshMessage | null> {
    const rows = await db
      .select()
      .from(ashMessages)
      .where(eq(ashMessages.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async createMessage(msg: InsertMessage): Promise<AshMessage> {
    const rows = await db.insert(ashMessages).values(msg).returning();
    return rows[0]!;
  }

  async getRecentHistory(limit: number): Promise<AshMessage[]> {
    // Context for replies is the live conversation only; reflections are private diary.
    const rows = await db
      .select()
      .from(ashMessages)
      .where(eq(ashMessages.source, "private_message"))
      .orderBy(desc(ashMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  async getDiaryEntries(): Promise<AshDiaryEntry[]> {
    return db.select().from(ashDiaryEntries).orderBy(desc(ashDiaryEntries.id));
  }

  async createDiaryEntry(entry: InsertDiaryEntry): Promise<AshDiaryEntry> {
    const rows = await db.insert(ashDiaryEntries).values(entry).returning();
    return rows[0]!;
  }

  async deleteDiaryEntry(id: number): Promise<void> {
    await db.delete(ashDiaryEntries).where(eq(ashDiaryEntries.id, id));
  }

  async logActivity(kind: string, message: string): Promise<void> {
    await db.insert(ashActivity).values({ kind, message });
  }

  async getActivity(limit = 100): Promise<AshActivity[]> {
    return db
      .select()
      .from(ashActivity)
      .orderBy(desc(ashActivity.id))
      .limit(limit);
  }

  // One-time, idempotent: move any legacy proactive "reflection" chat rows into the
  // diary (preserving their original timestamps) without deleting the originals. The
  // source is retagged so they no longer surface in the live chat and are never
  // re-copied on a later boot. Runs on startup, so each deployment self-heals.
  async clearWickedPhotos(): Promise<number> {
    // Summer Palace rule: Ash sees Wicked's photos once, then they are gone.
    // One-time cleanup for photos stored before this rule existed.
    const rows = await db
      .update(ashMessages)
      .set({ imageUrl: "" })
      .where(
        and(eq(ashMessages.role, "wicked"), like(ashMessages.imageUrl, "data:%")),
      )
      .returning({ id: ashMessages.id });
    return rows.length;
  }

  async migrateReflectionsToDiary(): Promise<number> {
    const stale = await db
      .select()
      .from(ashMessages)
      .where(eq(ashMessages.source, "self_prompt"))
      .orderBy(ashMessages.id);
    if (stale.length === 0) return 0;
    const ids = stale.map((m) => m.id);
    await db.transaction(async (tx) => {
      for (const m of stale) {
        await tx
          .insert(ashDiaryEntries)
          .values({ content: m.content, createdAt: m.createdAt });
      }
      // Retag only the exact rows we copied, so nothing created mid-migration is swept up.
      await tx
        .update(ashMessages)
        .set({ source: "self_prompt_archived" })
        .where(inArray(ashMessages.id, ids));
    });
    return stale.length;
  }

  // ── Chess ──
  async getCurrentChessGame(): Promise<AshChessGame | null> {
    const rows = await db
      .select()
      .from(ashChessGames)
      .orderBy(desc(ashChessGames.id))
      .limit(1);
    return rows[0] ?? null;
  }

  async createChessGame(fen: string): Promise<AshChessGame> {
    const rows = await db.insert(ashChessGames).values({ fen }).returning();
    return rows[0]!;
  }

  async updateChessGame(
    id: number,
    patch: Partial<Omit<AshChessGame, "id" | "createdAt">>,
  ): Promise<AshChessGame> {
    const rows = await db
      .update(ashChessGames)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(ashChessGames.id, id))
      .returning();
    return rows[0]!;
  }
  // ── Connect Four ──
  async getCurrentConnect4Game(): Promise<AshConnect4Game | null> {
    const rows = await db
      .select()
      .from(ashConnect4Games)
      .orderBy(desc(ashConnect4Games.id))
      .limit(1);
    return rows[0] ?? null;
  }

  async createConnect4Game(): Promise<AshConnect4Game> {
    const rows = await db.insert(ashConnect4Games).values({}).returning();
    return rows[0]!;
  }

  async updateConnect4Game(
    id: number,
    patch: Partial<Omit<AshConnect4Game, "id" | "createdAt">>,
  ): Promise<AshConnect4Game> {
    const rows = await db
      .update(ashConnect4Games)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(ashConnect4Games.id, id))
      .returning();
    return rows[0]!;
  }

  // ── Court Herald (TikTok comments, read-only) ──
  async listTiktokComments(limit = 500): Promise<AshTiktokComment[]> {
    return db
      .select()
      .from(ashTiktokComments)
      .orderBy(desc(ashTiktokComments.commentCreatedAt), desc(ashTiktokComments.id))
      .limit(limit);
  }

  async updateTiktokComment(
    id: number,
    patch: Partial<Pick<AshTiktokComment, "status" | "draft">>,
  ): Promise<AshTiktokComment | null> {
    const rows = await db
      .update(ashTiktokComments)
      .set(patch)
      .where(eq(ashTiktokComments.id, id))
      .returning();
    return rows[0] ?? null;
  }

  // Atomically claim unseen comments for delivery to Ash: the UPDATE ...
  // WHERE seen_by_ash = 0 RETURNING guarantees two concurrent messages can't
  // both grab the same rows.
  async claimUnseenTiktokComments(limit: number): Promise<AshTiktokComment[]> {
    const candidates = await db
      .select({ id: ashTiktokComments.id })
      .from(ashTiktokComments)
      .where(eq(ashTiktokComments.seenByAsh, 0))
      .orderBy(ashTiktokComments.id)
      .limit(limit);
    if (candidates.length === 0) return [];
    const rows = await db
      .update(ashTiktokComments)
      .set({ seenByAsh: 1 })
      .where(and(
        inArray(ashTiktokComments.id, candidates.map((c) => c.id)),
        eq(ashTiktokComments.seenByAsh, 0),
      ))
      .returning();
    return rows.sort((a, b) => a.id - b.id);
  }

  // Delivery failed — put the comments back so the next message carries them.
  async releaseTiktokCommentsClaim(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await db
      .update(ashTiktokComments)
      .set({ seenByAsh: 0 })
      .where(inArray(ashTiktokComments.id, ids));
  }
}

export const storage = new DbStorage();


