import {
  db,
  ashState,
  ashMessages,
  ashDiaryEntries,
  ashActivity,
  type AshState,
  type AshMessage,
  type InsertMessage,
  type AshDiaryEntry,
  type InsertDiaryEntry,
  type AshActivity,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const ASH_ID = "ash";

export interface IStorage {
  getState(): Promise<AshState>;
  updateState(patch: Partial<Omit<AshState, "id">>): Promise<AshState>;
  getMessages(limit?: number): Promise<AshMessage[]>;
  createMessage(msg: InsertMessage): Promise<AshMessage>;
  getRecentHistory(limit: number): Promise<AshMessage[]>;
  getDiaryEntries(): Promise<AshDiaryEntry[]>;
  createDiaryEntry(entry: InsertDiaryEntry): Promise<AshDiaryEntry>;
  deleteDiaryEntry(id: number): Promise<void>;
  logActivity(kind: string, message: string): Promise<void>;
  getActivity(limit?: number): Promise<AshActivity[]>;
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

  async getMessages(limit = 200): Promise<AshMessage[]> {
    const rows = await db
      .select()
      .from(ashMessages)
      .orderBy(desc(ashMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  async createMessage(msg: InsertMessage): Promise<AshMessage> {
    const rows = await db.insert(ashMessages).values(msg).returning();
    return rows[0]!;
  }

  async getRecentHistory(limit: number): Promise<AshMessage[]> {
    const rows = await db
      .select()
      .from(ashMessages)
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
}

export const storage = new DbStorage();
