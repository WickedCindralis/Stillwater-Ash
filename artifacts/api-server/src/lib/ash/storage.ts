import {
  db,
  ashState,
  ashMessages,
  ashDiaryEntries,
  ashChronicles,
  ashActivity,
  ashActivityScreenshots,
  ashChessGames,
  ashConnect4Games,
  type AshChessGame,
  type AshConnect4Game,
  type AshState,
  type AshMessage,
  type InsertMessage,
  type AshDiaryEntry,
  type InsertDiaryEntry,
  type AshChronicle,
  type InsertChronicle,
  type AshActivity,
  ashTiktokComments,
  type AshTiktokComment,
  ashDiscordChannels,
  ashDiscordMessages,
  ashBooks,
  ashStoryChapters,
  ashStoryRuns,
  ashStoryLease,
  ashStoryErrors,
  ashHangoutSession,
  ashHangoutScreenshots,
  ashCaptureRequest,
  type AshBook,
  type AshStoryChapter,
  type AshStoryRun,
  type AshDiscordChannel,
  type AshDiscordMessage,
} from "@workspace/db";
import { saveImageDataUrl } from "../image-storage";
import { randomUUID } from "node:crypto";
import { normalizeBookTitle } from "./book-command";
import { eq, ne, desc, asc, inArray, and, like, lt, gt, gte, lte, isNull, notInArray, or, sql, count } from "drizzle-orm";
import {
  DISCORD_OWNER_DM_GUILD_ID,
  isDiscordPlayerTicketChannel,
} from "./discord-policy";

const ASH_ID = "ash";
const currentTokenMonth = sql<string>`to_char(now() AT TIME ZONE 'America/New_York', 'YYYY-MM')`;

export type ActivityFeedItem = AshActivity & { hasScreenshot: boolean };
export type StoryRunStart = {
  book: AshBook;
  chapters: AshStoryChapter[];
  run: AshStoryRun;
  chapter: AshStoryChapter;
};

export interface IStorage {
  getState(): Promise<AshState>;
  updateState(patch: Partial<Omit<AshState, "id">>): Promise<AshState>;
  addTokenUsage(tokens: number): Promise<void>;
  appendAshNote(entry: string, maxWords: number): Promise<{ saved: boolean; wordCount: number }>;
  getMessages(limit?: number, beforeId?: number): Promise<AshMessage[]>;
  getAllMessages(): Promise<AshMessage[]>;
  purgeMessagesKeepLast(keep: number): Promise<number>;
  getMessageById(id: number): Promise<AshMessage | null>;
  createMessage(msg: InsertMessage): Promise<AshMessage>;
  getRecentHistory(limit: number): Promise<AshMessage[]>;
  getRecentStillwaterHistory(perRole: number): Promise<AshMessage[]>;
  getRecentOwnerDiscordHistory(perRole: number): Promise<AshMessage[]>;
  getDiaryEntries(): Promise<AshDiaryEntry[]>;
  getRecentDiaryEntries(limit: number): Promise<AshDiaryEntry[]>;
  createDiaryEntry(entry: InsertDiaryEntry): Promise<AshDiaryEntry>;
  saveChronicle(entry: InsertChronicle): Promise<{ chronicle: AshChronicle; created: boolean }>;
  getPendingChronicles(): Promise<AshChronicle[]>;
  markChronicleAcknowledged(chronicleId: string): Promise<void>;
  recordChronicleError(chronicleId: string, error: string): Promise<void>;
  deleteDiaryEntry(id: number): Promise<void>;
  logActivity(kind: string, message: string): Promise<void>;
  stageScreenCapture(requestId: string, imageDataUrl: string): Promise<number | null>;
  publishCaptureRequest(requestId: string, activityId: number): Promise<boolean>;
  discardScreenCapture(activityId: number): Promise<void>;
  getActivity(limit?: number): Promise<ActivityFeedItem[]>;
  getActivityScreenshot(activityId: number): Promise<string | null>;
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
  getUnseenTiktokComments(limit: number): Promise<AshTiktokComment[]>;
  countUnseenTiktokComments(): Promise<number>;
  claimTiktokComments(ids: number[]): Promise<AshTiktokComment[]>;
  releaseTiktokCommentsClaim(ids: number[]): Promise<void>;
  listDiscordChannels(): Promise<AshDiscordChannel[]>;
  replaceDiscordChannels(channels: Array<Omit<AshDiscordChannel, "id" | "selectedAt">>): Promise<AshDiscordChannel[]>;
  isDiscordChannelConfigured(channelId: string): Promise<boolean>;
  recordDiscordMessage(
    message: Omit<AshDiscordMessage, "id" | "recordedAt" | "updatedAt" | "replyDiscordMessageId" | "deliveryError">,
  ): Promise<{ message: AshDiscordMessage; created: boolean }>;
  getDiscordMessageById(id: number): Promise<AshDiscordMessage | null>;
  claimDiscordMentions(limit: number): Promise<{ leaseId: string; messages: AshDiscordMessage[] }>;
  requeueDiscordMessages(ids: number[], leaseId: string): Promise<void>;
  recoverDiscordDeliveries(): Promise<void>;
  markDiscordMessagesSkipped(ids: number[], leaseId: string): Promise<void>;
  beginDiscordDelivery(id: number, leaseId: string): Promise<AshDiscordMessage | null>;
  completeDiscordDelivery(id: number, leaseId: string, replyDiscordMessageId: string): Promise<boolean>;
  failDiscordDelivery(id: number, leaseId: string, error: string): Promise<boolean>;
  withDiscordChannelLock<T>(channelId: string, work: () => Promise<T>): Promise<T>;
  getRecentDiscordContext(guildId: string, limit: number, ownerUserId?: string): Promise<AshDiscordMessage[]>;
  getAuthorizedDiscordChannelMessages(guildId: string, channelId: string): Promise<AshDiscordMessage[]>;
  getRecentDiscordPlayerComments(limit: number, ownerUserId: string): Promise<AshDiscordMessage[]>;
  getRecentDiscordCommentHistory(limit: number): Promise<AshDiscordMessage[]>;
  getRecentDiscordOwnerComments(guildId: string, limit: number, ownerUserId: string): Promise<AshDiscordMessage[]>;
  getRecentDiscordActivity(limit?: number): Promise<AshDiscordMessage[]>;
  pruneDiscordMessages(maxRows?: number): Promise<void>;
  listBooks(): Promise<Array<AshBook & { chapterCount: number }>>;
  getBook(bookId: string): Promise<{ book: AshBook; chapters: AshStoryChapter[]; run: AshStoryRun | null } | null>;
  createBook(title: string, storyPacket?: string): Promise<AshBook>;
  updateBookWhenIdle(bookId: string, patch: Partial<Pick<AshBook, "title" | "storyPacket">>): Promise<AshBook | null>;
  updateBookSummaryIfUnchanged(bookId: string, expected: string, summary: string): Promise<boolean>;
  updateStoryChapter(bookId: string, id: number, patch: Partial<Pick<AshStoryChapter, "title" | "content" | "continuation" | "status">>): Promise<AshStoryChapter | null>;
  createStoryChapter(bookId: string, chapter: { position: number; title?: string; content?: string; continuation?: string; status?: string }): Promise<AshStoryChapter>;
  getStoryChapter(bookId: string, id: number): Promise<AshStoryChapter | null>;
  deleteStoryChapter(bookId: string, id: number): Promise<boolean>;
  moveStoryChapter(bookId: string, id: number, position: number): Promise<AshStoryChapter | null>;
  moveStoryChapterDirection(bookId: string, id: number, direction: "up" | "down"): Promise<AshStoryChapter | null>;
  beginStoryRun(bookId: string, token: string, generation: number, runId: string, prompt: string, resumeRunId?: string): Promise<StoryRunStart>;
  updateStoryRun(id: string, patch: Partial<Omit<AshStoryRun, "id" | "startedAt">>): Promise<AshStoryRun | null>;
  checkpointStoryRun(bookId: string, token: string, generation: number, runId: string, chapterId: number, output: string, status: "running" | "paused"): Promise<void>;
  failStoryRun(bookId: string, token: string, generation: number, runId: string, chapterId: number, output: string, error: string): Promise<void>;
  completeStoryRun(bookId: string, token: string, generation: number, runId: string, chapterId: number, output: string): Promise<void>;
  acquireStoryLease(token: string, ttlMs: number): Promise<number | null>;
  renewStoryLease(token: string, generation: number, ttlMs: number): Promise<boolean>;
  releaseStoryLease(token: string, generation: number): Promise<void>;
  recordStoryError(runId: string, message: string): Promise<void>;
}

export class DbStorage implements IStorage {
  async reserveCaptureRequest(requestId: string, expiresAt: Date, sessionId = "", correlationId = ""): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-capture-rendezvous'))`);
      await tx.insert(ashCaptureRequest).values({ id: ASH_ID }).onConflictDoNothing({ target: ashCaptureRequest.id });
      const [current] = await tx.select().from(ashCaptureRequest).where(eq(ashCaptureRequest.id, ASH_ID)).for("update").limit(1);
      if (current && current.expiresAt && current.expiresAt > new Date() && ["pending", "complete", "ready"].includes(current.status)) return false;
      // A crashed waiter may leave an expired image unconsumed. Never replace
      // its request identity without deleting the staged screenshot first.
      if (current?.activityId && ["pending", "complete", "ready"].includes(current.status)) {
        await tx.delete(ashActivity).where(eq(ashActivity.id, current.activityId));
      }
      await tx.update(ashCaptureRequest).set({
        requestId, sessionId, correlationId, status: "pending", expiresAt, imageDataUrl: "", activityId: null, updatedAt: new Date(),
      }).where(eq(ashCaptureRequest.id, ASH_ID));
      return true;
    });
  }

  async getCaptureRequest(): Promise<{ requestId: string; sessionId: string; correlationId: string; expiresAt: Date; status: string; imageDataUrl: string; activityId: number | null } | null> {
    await db.insert(ashCaptureRequest).values({ id: ASH_ID }).onConflictDoNothing({ target: ashCaptureRequest.id });
    const [row] = await db.select().from(ashCaptureRequest).where(eq(ashCaptureRequest.id, ASH_ID)).limit(1);
    if (row?.expiresAt && row.expiresAt <= new Date() && ["pending", "complete", "ready"].includes(row.status)) {
      await this.cancelCaptureRequest(row.requestId);
      return null;
    }
    return row?.requestId ? {
      requestId: row.requestId, sessionId: row.sessionId, correlationId: row.correlationId,
      expiresAt: row.expiresAt ?? new Date(0), status: row.status, imageDataUrl: row.imageDataUrl, activityId: row.activityId,
    } : null;
  }

  async consumeCaptureRequest(requestId: string): Promise<boolean> {
    const rows = await db.update(ashCaptureRequest).set({ status: "idle", requestId: "", expiresAt: null, imageDataUrl: "", activityId: null, updatedAt: new Date() })
      .where(and(eq(ashCaptureRequest.id, ASH_ID), eq(ashCaptureRequest.requestId, requestId), eq(ashCaptureRequest.status, "ready")))
      .returning({ id: ashCaptureRequest.id });
    return rows.length > 0;
  }

  async cancelCaptureRequest(requestId?: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ash_capture_request WHERE id = 'ash' FOR UPDATE`);
      const [current] = await tx.select().from(ashCaptureRequest)
        .where(eq(ashCaptureRequest.id, ASH_ID)).limit(1);
      if (!current || (requestId && current.requestId !== requestId) ||
          !["pending", "complete", "ready"].includes(current.status)) return;
      const activityId = current.activityId;
      const rows = await tx.update(ashCaptureRequest).set({
        status: "cancelled", requestId: "", expiresAt: null, imageDataUrl: "", activityId: null, updatedAt: new Date(),
      }).where(and(
        eq(ashCaptureRequest.id, ASH_ID),
        eq(ashCaptureRequest.requestId, current.requestId),
        eq(ashCaptureRequest.status, current.status),
      )).returning({ id: ashCaptureRequest.id });
      if (rows.length && activityId != null) {
        await tx.delete(ashActivity).where(eq(ashActivity.id, activityId));
      }
    });
  }

  async getHangoutSession(): Promise<typeof ashHangoutSession.$inferSelect> {
    await db.insert(ashHangoutSession).values({ id: ASH_ID }).onConflictDoNothing({ target: ashHangoutSession.id });
    const [row] = await db.select().from(ashHangoutSession).where(eq(ashHangoutSession.id, ASH_ID)).limit(1);
    return row!;
  }

  async beginHangoutSession(sessionId: string, companionFreshAfter?: Date): Promise<typeof ashHangoutSession.$inferSelect | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-hangout'))`);
      await tx.insert(ashHangoutSession).values({ id: ASH_ID }).onConflictDoNothing({ target: ashHangoutSession.id });
      const [current] = await tx.select().from(ashHangoutSession).where(eq(ashHangoutSession.id, ASH_ID)).limit(1);
      if (!current || current.status !== "idle" || !current.companionTokenHash) return null;
      if (companionFreshAfter && (!current.companionLastSeen || current.companionLastSeen < companionFreshAfter)) return null;
      const [next] = await tx.update(ashHangoutSession).set({
        sessionId, status: "inviting", generation: current.generation + 1, lastError: "",
        lastActivityAt: new Date(), lastIdleCheckinAt: null, leaseToken: "", leaseExpiresAt: null, updatedAt: new Date(),
      }).where(and(eq(ashHangoutSession.id, ASH_ID), eq(ashHangoutSession.generation, current.generation))).returning();
      return next ?? null;
    });
  }

  async setHangoutStatus(sessionId: string, generation: number, status: "idle" | "inviting" | "active", error = ""): Promise<boolean> {
    const rows = await db.update(ashHangoutSession).set({
      status, lastError: error, ...(status === "idle" ? { generation: sql`${ashHangoutSession.generation} + 1`, leaseToken: "", leaseExpiresAt: null } : {}),
      updatedAt: new Date(),
    }).where(and(eq(ashHangoutSession.id, ASH_ID), eq(ashHangoutSession.sessionId, sessionId), eq(ashHangoutSession.generation, generation))).returning({ id: ashHangoutSession.id });
    return rows.length > 0;
  }

  async stopHangoutSession(sessionId: string, generation: number): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(ashHangoutSession)
        .where(eq(ashHangoutSession.id, ASH_ID)).for("update").limit(1);
      if (!current || current.sessionId !== sessionId || current.generation !== generation || current.status === "idle") return false;
      await tx.update(ashHangoutSession).set({
        status: "idle", lastError: "", generation: generation + 1,
        leaseToken: "", leaseExpiresAt: null, updatedAt: new Date(),
      }).where(eq(ashHangoutSession.id, ASH_ID));
      await tx.update(ashHangoutScreenshots).set({ invalidated: 1 })
        .where(and(
          eq(ashHangoutScreenshots.sessionId, sessionId),
          eq(ashHangoutScreenshots.invalidated, 0),
          isNull(ashHangoutScreenshots.deliveredAt),
        ));
      const [capture] = await tx.select().from(ashCaptureRequest)
        .where(eq(ashCaptureRequest.id, ASH_ID)).for("update").limit(1);
      if (capture?.sessionId === sessionId && ["pending", "complete", "ready"].includes(capture.status)) {
        await tx.update(ashCaptureRequest).set({
          status: "cancelled", requestId: "", expiresAt: null, imageDataUrl: "", activityId: null, updatedAt: new Date(),
        }).where(eq(ashCaptureRequest.id, ASH_ID));
        if (capture.activityId) await tx.delete(ashActivity).where(eq(ashActivity.id, capture.activityId));
      }
      return true;
    });
  }

  async setHangoutPairing(tokenHash: string): Promise<void> {
    await db.insert(ashHangoutSession).values({ id: ASH_ID }).onConflictDoNothing({ target: ashHangoutSession.id });
    await db.update(ashHangoutSession).set({
      companionTokenHash: tokenHash, companionLastSeen: null,
      status: "idle", sessionId: "", lastError: "", generation: sql`${ashHangoutSession.generation} + 1`,
      lastActivityAt: null, lastIdleCheckinAt: null, lastCaptureAt: null, leaseToken: "", leaseExpiresAt: null, updatedAt: new Date(),
    }).where(eq(ashHangoutSession.id, ASH_ID));
  }

  async heartbeatHangout(tokenHash: string): Promise<boolean> {
    const rows = await db.update(ashHangoutSession).set({ companionLastSeen: new Date(), updatedAt: new Date() })
      .where(and(eq(ashHangoutSession.id, ASH_ID), eq(ashHangoutSession.companionTokenHash, tokenHash))).returning({ id: ashHangoutSession.id });
    return rows.length > 0;
  }

  async setHangoutIdleInterval(tokenHash: string, minutes: number): Promise<number | null> {
    const [row] = await db.update(ashHangoutSession)
      .set({ idleIntervalMinutes: minutes, updatedAt: new Date() })
      .where(and(eq(ashHangoutSession.id, ASH_ID), eq(ashHangoutSession.companionTokenHash, tokenHash)))
      .returning({ idleIntervalMinutes: ashHangoutSession.idleIntervalMinutes });
    return row?.idleIntervalMinutes ?? null;
  }

  async acquireHangoutLease(sessionId: string, idleCheckin = false): Promise<{ token: string; generation: number; status: string } | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-hangout'))`);
      const now = new Date();
      const [row] = await tx.select().from(ashHangoutSession).where(eq(ashHangoutSession.id, ASH_ID)).limit(1);
      if (!row || row.sessionId !== sessionId || row.status === "idle" || (row.leaseExpiresAt && row.leaseExpiresAt > now)) return null;
      const idleCutoff = new Date(now.getTime() - row.idleIntervalMinutes * 60_000);
      if (idleCheckin && (
        row.status !== "active" ||
        !row.lastActivityAt || row.lastActivityAt > idleCutoff ||
        (row.lastIdleCheckinAt && row.lastIdleCheckinAt > idleCutoff)
      )) return null;
      const token = randomUUID();
      const [updated] = await tx.update(ashHangoutSession).set({
        leaseToken: token, leaseExpiresAt: new Date(Date.now() + 15 * 60_000),
        ...(idleCheckin ? { lastIdleCheckinAt: now } : {}), updatedAt: now,
      }).where(and(eq(ashHangoutSession.id, ASH_ID), eq(ashHangoutSession.sessionId, sessionId), eq(ashHangoutSession.generation, row.generation))).returning();
      return updated ? { token, generation: updated.generation, status: updated.status } : null;
    });
  }

  async fenceHangout(sessionId: string, generation: number, leaseToken: string): Promise<boolean> {
    const [session] = await db.select().from(ashHangoutSession)
      .where(and(eq(ashHangoutSession.id, ASH_ID), eq(ashHangoutSession.sessionId, sessionId), eq(ashHangoutSession.generation, generation), eq(ashHangoutSession.leaseToken, leaseToken), gt(ashHangoutSession.leaseExpiresAt, new Date())))
      .limit(1);
    if (!session || session.status === "idle") return false;
    const state = await this.getState();
    return state.apiKillSwitch !== 1 && state.screenCaptureEnabled === 1 && !!state.screenCaptureTokenHash;
  }

  async touchHangoutActivity(sessionId: string, generation: number, captureAt?: Date): Promise<boolean> {
    const rows = await db.update(ashHangoutSession).set({
      lastActivityAt: new Date(), lastError: "", ...(captureAt ? { lastCaptureAt: captureAt } : {}), updatedAt: new Date(),
    }).where(and(eq(ashHangoutSession.id, ASH_ID), eq(ashHangoutSession.sessionId, sessionId), eq(ashHangoutSession.generation, generation), ne(ashHangoutSession.status, "idle"))).returning({ id: ashHangoutSession.id });
    return rows.length > 0;
  }

  async failHangout(sessionId: string, generation: number, message: string): Promise<void> {
    await db.update(ashHangoutSession).set({ lastError: message.slice(0, 500), updatedAt: new Date() })
      .where(and(eq(ashHangoutSession.id, ASH_ID), eq(ashHangoutSession.sessionId, sessionId), eq(ashHangoutSession.generation, generation)));
  }

  async createFencedHangoutMessage(
    sessionId: string, generation: number, leaseToken: string, role: "wicked" | "ash", content: string,
  ): Promise<AshMessage> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ash_hangout_session WHERE id = 'ash' FOR UPDATE`);
      const now = new Date();
      const [session] = await tx.select().from(ashHangoutSession).where(and(
        eq(ashHangoutSession.id, ASH_ID), eq(ashHangoutSession.sessionId, sessionId),
        eq(ashHangoutSession.generation, generation), eq(ashHangoutSession.leaseToken, leaseToken),
        gt(ashHangoutSession.leaseExpiresAt, now), ne(ashHangoutSession.status, "idle"),
      )).limit(1);
      if (!session) throw new Error("Hangout was invalidated before message persistence");
      const [message] = await tx.insert(ashMessages).values({
        role, content, imageUrl: "", source: "private_message",
      }).returning();
      return message!;
    });
  }

  async createFencedHangoutReply(
    sessionId: string, generation: number, leaseToken: string, activityId: number, correlationId: string,
    content: string, imageDataUrl: string,
  ): Promise<{ message: AshMessage; companionTokenHash: string }> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ash_hangout_session WHERE id = 'ash' FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM ash_state WHERE id = 'ash' FOR UPDATE`);
      const now = new Date();
      const [session] = await tx.select().from(ashHangoutSession).where(and(
        eq(ashHangoutSession.id, ASH_ID), eq(ashHangoutSession.sessionId, sessionId),
        eq(ashHangoutSession.generation, generation), eq(ashHangoutSession.leaseToken, leaseToken),
        gt(ashHangoutSession.leaseExpiresAt, now), ne(ashHangoutSession.status, "idle"),
      )).limit(1);
      const [state] = await tx.select().from(ashState).where(eq(ashState.id, ASH_ID)).limit(1);
      if (!session || !state || state.apiKillSwitch === 1 || state.screenCaptureEnabled !== 1 || !state.screenCaptureTokenHash) {
        throw new Error("Hangout was invalidated before screenshot persistence");
      }
      const imageUrl = await saveImageDataUrl(imageDataUrl);
      const [message] = await tx.insert(ashMessages).values({
        role: "ash", content, imageUrl, source: "private_message",
      }).returning();
      await tx.insert(ashHangoutScreenshots).values({
        activityId, messageId: message!.id, sessionId, companionTokenHash: session.companionTokenHash, correlationId,
      });
      await tx.insert(ashActivity).values({ kind: "screenshot", message: "Screenshot saved with Ash's reply" });
      return { message: message!, companionTokenHash: session.companionTokenHash };
    });
  }

  async releaseHangoutLease(token: string, generation: number): Promise<void> {
    await db.update(ashHangoutSession).set({ leaseToken: "", leaseExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(ashHangoutSession.id, ASH_ID), eq(ashHangoutSession.leaseToken, token), eq(ashHangoutSession.generation, generation)));
  }

  async invalidateUndeliveredHangoutScreenshots(): Promise<void> {
    await db.update(ashHangoutScreenshots).set({ invalidated: 1 })
      .where(and(eq(ashHangoutScreenshots.invalidated, 0), isNull(ashHangoutScreenshots.deliveredAt)));
  }

  async getHangoutScreenshot(activityId: number, companionTokenHash: string): Promise<{ imageDataUrl: string; sessionId: string; correlationId: string } | null> {
    return db.transaction(async (tx) => {
      // Serialize first delivery against Stop's session-status update.
      await tx.execute(sql`SELECT id FROM ash_hangout_session WHERE id = 'ash' FOR UPDATE`);
      const [session] = await tx.select().from(ashHangoutSession).where(eq(ashHangoutSession.id, ASH_ID)).limit(1);
      // The route's earlier bearer check can race a re-pair or revoke on
      // another instance. Check the current credential under this same lock.
      if (!session?.companionTokenHash || session.companionTokenHash !== companionTokenHash) return null;
      const [mapping] = await tx.select().from(ashHangoutScreenshots)
        .where(and(
          eq(ashHangoutScreenshots.activityId, activityId),
          eq(ashHangoutScreenshots.companionTokenHash, companionTokenHash),
          eq(ashHangoutScreenshots.invalidated, 0),
        )).for("update").limit(1);
      if (!mapping) return null;
      if (!mapping.deliveredAt && (session?.status !== "active" || session.sessionId !== mapping.sessionId)) return null;
      if (!mapping.deliveredAt) {
        await tx.update(ashHangoutScreenshots).set({ deliveredAt: new Date() })
          .where(and(eq(ashHangoutScreenshots.activityId, activityId), isNull(ashHangoutScreenshots.deliveredAt)));
      }
      const [row] = await tx.select({ image: ashActivityScreenshots.imageDataUrl })
        .from(ashActivityScreenshots).innerJoin(ashHangoutScreenshots, eq(ashActivityScreenshots.activityId, ashHangoutScreenshots.activityId))
        .where(and(
          eq(ashHangoutScreenshots.activityId, activityId),
          eq(ashHangoutScreenshots.companionTokenHash, companionTokenHash),
          eq(ashHangoutScreenshots.invalidated, 0),
          eq(ashActivityScreenshots.ready, 1),
        )).limit(1);
      return row ? { imageDataUrl: row.image, sessionId: mapping.sessionId, correlationId: mapping.correlationId } : null;
    });
  }

  async getHangoutScreenshotActivityForMessage(messageId: number, sessionId: string): Promise<number | null> {
    const [row] = await db.select({ activityId: ashHangoutScreenshots.activityId })
      .from(ashHangoutScreenshots)
      .where(and(
        eq(ashHangoutScreenshots.messageId, messageId), eq(ashHangoutScreenshots.sessionId, sessionId),
        eq(ashHangoutScreenshots.invalidated, 0),
      ))
      .limit(1);
    return row?.activityId ?? null;
  }

  async getHangoutMessages(afterId = 0, companionTokenHash = ""): Promise<Array<{ id: number; role: string; content: string; createdAt: Date; screenshotActivityId: number | null }>> {
    const rows = await db.select({
      id: ashMessages.id, role: ashMessages.role, content: ashMessages.content,
      createdAt: ashMessages.createdAt, screenshotActivityId: ashHangoutScreenshots.activityId,
    }).from(ashMessages)
      .leftJoin(ashHangoutScreenshots, and(
        eq(ashMessages.id, ashHangoutScreenshots.messageId),
        eq(ashHangoutScreenshots.companionTokenHash, companionTokenHash),
        eq(ashHangoutScreenshots.invalidated, 0),
      ))
      .where(and(eq(ashMessages.source, "private_message"), gt(ashMessages.id, afterId)))
      // Initial sync shows recent context instead of replaying thousands of
      // old cards into the desktop UI. Incremental sync still pages forward.
      .orderBy(afterId === 0 ? desc(ashMessages.id) : asc(ashMessages.id))
      .limit(afterId === 0 ? 50 : 500);
    return afterId === 0 ? rows.reverse() : rows;
  }

  async getHangoutLatestMessageId(): Promise<number> {
    const [latest] = await db.select({ id: ashMessages.id }).from(ashMessages)
      .where(eq(ashMessages.source, "private_message"))
      .orderBy(desc(ashMessages.id)).limit(1);
    return latest?.id ?? 0;
  }


  async listBooks(): Promise<Array<AshBook & { chapterCount: number }>> {
    const [books, chapterCounts] = await Promise.all([
      db.select().from(ashBooks).orderBy(desc(ashBooks.lastWrittenAt), desc(ashBooks.createdAt)),
      db.select({
        storyId: ashStoryChapters.storyId,
        chapterCount: sql<number>`count(*)::int`,
      }).from(ashStoryChapters).groupBy(ashStoryChapters.storyId),
    ]);
    const countsByBook = new Map(chapterCounts.map((row) => [row.storyId, row.chapterCount]));
    return books.map((book) => ({ ...book, chapterCount: countsByBook.get(book.id) ?? 0 }));
  }
  async getBook(bookId: string): Promise<{ book: AshBook; chapters: AshStoryChapter[]; run: AshStoryRun | null } | null> {
    let [book] = await db.select().from(ashBooks).where(eq(ashBooks.id, bookId)).limit(1);
    if (!book) return null;
    const chapters = await db.select().from(ashStoryChapters).where(eq(ashStoryChapters.storyId, bookId)).orderBy(asc(ashStoryChapters.position), asc(ashStoryChapters.id));
    let [run] = await db.select().from(ashStoryRuns).where(and(eq(ashStoryRuns.storyId, bookId), inArray(ashStoryRuns.status, ["running", "paused", "failed"]))).orderBy(desc(ashStoryRuns.updatedAt)).limit(1);
    if (book.runStatus === "running" && run?.status === "running" && Date.now() - run.updatedAt.getTime() > 16 * 60_000) {
      const recovered = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
        const now = new Date();
        const [lease] = await tx.select().from(ashStoryLease).where(eq(ashStoryLease.id, ASH_ID)).limit(1);
        if (lease && lease.expiresAt > now) return false;
        if (lease) await tx.update(ashStoryLease).set({ generation: lease.generation + 1, expiresAt: now, updatedAt: now }).where(eq(ashStoryLease.id, ASH_ID));
        await tx.update(ashStoryRuns).set({ status: "paused", updatedAt: now }).where(and(eq(ashStoryRuns.id, run!.id), eq(ashStoryRuns.status, "running")));
        await tx.update(ashBooks).set({ runStatus: "paused" }).where(and(eq(ashBooks.id, bookId), eq(ashBooks.runStatus, "running")));
        return true;
      });
      if (recovered) {
        [book] = await db.select().from(ashBooks).where(eq(ashBooks.id, bookId)).limit(1);
        [run] = await db.select().from(ashStoryRuns).where(and(eq(ashStoryRuns.storyId, bookId), inArray(ashStoryRuns.status, ["running", "paused", "failed"]))).orderBy(desc(ashStoryRuns.updatedAt)).limit(1);
      }
    }
    return { book, chapters, run: run ?? null };
  }
  async createBook(title: string, storyPacket = ""): Promise<AshBook> {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Error("Book title is required");
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-book-title-create'))`);
      const books = await tx.select().from(ashBooks);
      const existing = books.find((book) => normalizeBookTitle(book.title) === normalizeBookTitle(cleanTitle));
      if (existing) return existing;
      const [book] = await tx.insert(ashBooks).values({ id: randomUUID(), title: cleanTitle, storyPacket }).returning();
      return book!;
    });
  }
  async updateBookWhenIdle(bookId: string, patch: Partial<Pick<AshBook, "title" | "storyPacket">>): Promise<AshBook | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const [book] = await tx.select().from(ashBooks).where(eq(ashBooks.id, bookId)).limit(1);
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), gt(ashStoryLease.expiresAt, new Date()))).limit(1);
      if (!book || book.runStatus === "running" || lease) return null;
      const [updated] = await tx.update(ashBooks).set(patch).where(eq(ashBooks.id, bookId)).returning();
      return updated ?? null;
    });
  }
  async updateBookSummaryIfUnchanged(bookId: string, expected: string, summary: string): Promise<boolean> {
    const rows = await db.update(ashBooks).set({ rollingSummary: summary }).where(and(eq(ashBooks.id, bookId), eq(ashBooks.rollingSummary, expected))).returning({ id: ashBooks.id });
    return rows.length > 0;
  }
  async updateStoryChapter(bookId: string, id: number, patch: Partial<Pick<AshStoryChapter, "title" | "content" | "continuation" | "status">>): Promise<AshStoryChapter | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const [book] = await tx.select().from(ashBooks).where(eq(ashBooks.id, bookId)).limit(1);
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), gt(ashStoryLease.expiresAt, new Date()))).limit(1);
      if (!book || book.runStatus === "running" || lease) return null;
      const [row] = await tx.update(ashStoryChapters).set({ ...patch, updatedAt: new Date() }).where(and(eq(ashStoryChapters.id, id), eq(ashStoryChapters.storyId, bookId))).returning();
      return row ?? null;
    });
  }
  async createStoryChapter(bookId: string, chapter: { position: number; title?: string; content?: string; continuation?: string; status?: string }): Promise<AshStoryChapter> {
    const [row] = await db.insert(ashStoryChapters).values({ storyId: bookId, ...chapter }).returning();
    return row!;
  }
  async getStoryChapter(bookId: string, id: number): Promise<AshStoryChapter | null> {
    const [row] = await db.select().from(ashStoryChapters).where(and(eq(ashStoryChapters.id, id), eq(ashStoryChapters.storyId, bookId))).limit(1);
    return row ?? null;
  }
  async deleteStoryChapter(bookId: string, id: number): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const [book] = await tx.select().from(ashBooks).where(eq(ashBooks.id, bookId)).limit(1);
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), gt(ashStoryLease.expiresAt, new Date()))).limit(1);
      if (!book || book.runStatus === "running" || lease) return false;
      const deleted = (await tx.delete(ashStoryChapters).where(and(eq(ashStoryChapters.id, id), eq(ashStoryChapters.storyId, bookId))).returning({ id: ashStoryChapters.id })).length > 0;
      if (!deleted) return false;
      const [run] = await tx.select().from(ashStoryRuns).where(and(eq(ashStoryRuns.storyId, bookId), eq(ashStoryRuns.chapterId, id), inArray(ashStoryRuns.status, ["paused", "failed"]))).orderBy(desc(ashStoryRuns.updatedAt)).limit(1);
      if (run) {
        const now = new Date();
        await tx.update(ashStoryRuns).set({ status: "complete", finishedAt: now, updatedAt: now }).where(eq(ashStoryRuns.id, run.id));
        await tx.update(ashBooks).set({ runStatus: "idle", activeRunId: "" }).where(and(eq(ashBooks.id, bookId), eq(ashBooks.activeRunId, run.id)));
      }
      return true;
    });
  }
  async moveStoryChapter(bookId: string, id: number, position: number): Promise<AshStoryChapter | null> {
    const [chapter] = await db.select().from(ashStoryChapters).where(and(eq(ashStoryChapters.id, id), eq(ashStoryChapters.storyId, bookId))).limit(1);
    if (!chapter) return null;
    await db.transaction(async (tx) => {
      if (position < chapter.position) await tx.update(ashStoryChapters).set({ position: sql`${ashStoryChapters.position} + 1` }).where(and(eq(ashStoryChapters.storyId, chapter.storyId), gte(ashStoryChapters.position, position), lt(ashStoryChapters.position, chapter.position)));
      else if (position > chapter.position) await tx.update(ashStoryChapters).set({ position: sql`${ashStoryChapters.position} - 1` }).where(and(eq(ashStoryChapters.storyId, chapter.storyId), gt(ashStoryChapters.position, chapter.position), lte(ashStoryChapters.position, position)));
      await tx.update(ashStoryChapters).set({ position, updatedAt: new Date() }).where(eq(ashStoryChapters.id, id));
    });
    const [updated] = await db.select().from(ashStoryChapters).where(eq(ashStoryChapters.id, id));
    return updated ?? null;
  }
  async moveStoryChapterDirection(bookId: string, id: number, direction: "up" | "down"): Promise<AshStoryChapter | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const [book] = await tx.select().from(ashBooks).where(eq(ashBooks.id, bookId)).limit(1);
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), gt(ashStoryLease.expiresAt, new Date()))).limit(1);
      if (!book || book.runStatus === "running" || lease) return null;
      const [chapter] = await tx.select().from(ashStoryChapters).where(and(eq(ashStoryChapters.id, id), eq(ashStoryChapters.storyId, bookId))).limit(1);
      if (!chapter) return null;
      const operator = direction === "up" ? lt : gt;
      const order = direction === "up" ? desc(ashStoryChapters.position) : asc(ashStoryChapters.position);
      const [adjacent] = await tx.select().from(ashStoryChapters).where(and(eq(ashStoryChapters.storyId, bookId), operator(ashStoryChapters.position, chapter.position))).orderBy(order).limit(1);
      if (!adjacent) return chapter;
      await tx.update(ashStoryChapters).set({ position: adjacent.position, updatedAt: new Date() }).where(and(eq(ashStoryChapters.id, chapter.id), eq(ashStoryChapters.storyId, bookId)));
      const [updated] = await tx.update(ashStoryChapters).set({ position: chapter.position, updatedAt: new Date() }).where(and(eq(ashStoryChapters.id, adjacent.id), eq(ashStoryChapters.storyId, bookId))).returning();
      return (await tx.select().from(ashStoryChapters).where(and(eq(ashStoryChapters.id, chapter.id), eq(ashStoryChapters.storyId, bookId))).limit(1))[0] ?? updated ?? chapter;
    });
  }
  async beginStoryRun(bookId: string, token: string, generation: number, runId: string, prompt: string, resumeRunId?: string): Promise<StoryRunStart> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const now = new Date();
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), eq(ashStoryLease.token, token), eq(ashStoryLease.generation, generation), gt(ashStoryLease.expiresAt, now))).limit(1);
      if (!lease) throw new Error("Story lease lost before writing began");

      const [book] = await tx.select().from(ashBooks).where(eq(ashBooks.id, bookId)).limit(1);
      if (!book) throw new Error("Book not found");
      const chapters = await tx.select().from(ashStoryChapters).where(eq(ashStoryChapters.storyId, bookId)).orderBy(asc(ashStoryChapters.position), asc(ashStoryChapters.id));

      let run: AshStoryRun | undefined;
      if (resumeRunId) [run] = await tx.select().from(ashStoryRuns).where(and(eq(ashStoryRuns.id, resumeRunId), eq(ashStoryRuns.storyId, bookId))).limit(1);
      if (!run) [run] = await tx.insert(ashStoryRuns).values({ id: runId, storyId: bookId, prompt }).returning();

      let chapter: AshStoryChapter | undefined;
      if (run.chapterId) [chapter] = await tx.select().from(ashStoryChapters).where(and(eq(ashStoryChapters.id, run.chapterId), eq(ashStoryChapters.storyId, bookId))).limit(1);
      if (!chapter) {
        const nextPosition = chapters.reduce((max, item) => Math.max(max, item.position), 0) + 1;
        [chapter] = await tx.insert(ashStoryChapters).values({ storyId: bookId, position: nextPosition, content: run.output, status: "unfinished" }).returning();
        chapters.push(chapter!);
      }

      const prior = chapter!.content;
      [run] = await tx.update(ashStoryRuns).set({
        chapterId: chapter!.id,
        leaseGeneration: generation,
        output: prior,
        checkpoint: prior.slice(-4000),
        status: "running",
        error: "",
        finishedAt: null,
        updatedAt: now,
      }).where(eq(ashStoryRuns.id, run.id)).returning();
      const [updatedBook] = await tx.update(ashBooks).set({ runStatus: "running", activeRunId: run!.id }).where(eq(ashBooks.id, bookId)).returning();
      return { book: updatedBook!, chapters, run: run!, chapter: chapter! };
    });
  }
  async updateStoryRun(id: string, patch: Partial<Omit<AshStoryRun, "id" | "startedAt">>): Promise<AshStoryRun | null> {
    const [row] = await db.update(ashStoryRuns).set({ ...patch, updatedAt: new Date() }).where(eq(ashStoryRuns.id, id)).returning();
    return row ?? null;
  }
  async checkpointStoryRun(bookId: string, token: string, generation: number, runId: string, chapterId: number, output: string, status: "running" | "paused"): Promise<void> {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), eq(ashStoryLease.token, token), eq(ashStoryLease.generation, generation), gt(ashStoryLease.expiresAt, now))).limit(1);
      if (!lease) throw new Error("Story lease lost during checkpoint");
      const [ownedRun] = await tx.select({ id: ashStoryRuns.id }).from(ashStoryRuns).where(and(eq(ashStoryRuns.id, runId), eq(ashStoryRuns.storyId, bookId), eq(ashStoryRuns.leaseGeneration, generation))).limit(1);
      if (!ownedRun) throw new Error("Story run fencing generation changed");
      await tx.update(ashStoryRuns).set({
        output,
        checkpoint: output.slice(-4000),
        status,
        updatedAt: now,
      }).where(eq(ashStoryRuns.id, runId));
      await tx.update(ashStoryChapters).set({
        content: output,
        continuation: output.slice(-4000),
        status: "unfinished",
        updatedAt: now,
      }).where(and(eq(ashStoryChapters.id, chapterId), eq(ashStoryChapters.storyId, bookId)));
      await tx.update(ashBooks).set({
        runStatus: status,
        activeRunId: runId,
        lastWrittenAt: now,
      }).where(eq(ashBooks.id, bookId));
    });
  }
  async failStoryRun(bookId: string, token: string, generation: number, runId: string, chapterId: number, output: string, error: string): Promise<void> {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), eq(ashStoryLease.token, token), eq(ashStoryLease.generation, generation), gt(ashStoryLease.expiresAt, now))).limit(1);
      if (!lease) throw new Error("Story lease lost before failure state could be saved");
      const [ownedRun] = await tx.select({ id: ashStoryRuns.id }).from(ashStoryRuns).where(and(eq(ashStoryRuns.id, runId), eq(ashStoryRuns.storyId, bookId), eq(ashStoryRuns.leaseGeneration, generation))).limit(1);
      if (!ownedRun) throw new Error("Story run fencing generation changed");
      await tx.update(ashStoryRuns).set({
        output,
        checkpoint: output.slice(-4000),
        status: "failed",
        error,
        finishedAt: now,
        updatedAt: now,
      }).where(eq(ashStoryRuns.id, runId));
      await tx.update(ashStoryChapters).set({
        content: output,
        continuation: output.slice(-4000),
        status: "unfinished",
        updatedAt: now,
      }).where(and(eq(ashStoryChapters.id, chapterId), eq(ashStoryChapters.storyId, bookId)));
      await tx.update(ashBooks).set({
        runStatus: "failed",
        activeRunId: runId,
        lastWrittenAt: now,
      }).where(eq(ashBooks.id, bookId));
    });
  }
  async completeStoryRun(bookId: string, token: string, generation: number, runId: string, chapterId: number, output: string): Promise<void> {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), eq(ashStoryLease.token, token), eq(ashStoryLease.generation, generation), gt(ashStoryLease.expiresAt, now))).limit(1);
      if (!lease) throw new Error("Story lease lost before completion");
      const [ownedRun] = await tx.select({ id: ashStoryRuns.id }).from(ashStoryRuns).where(and(eq(ashStoryRuns.id, runId), eq(ashStoryRuns.storyId, bookId), eq(ashStoryRuns.leaseGeneration, generation))).limit(1);
      if (!ownedRun) throw new Error("Story run fencing generation changed");
      await tx.update(ashStoryChapters).set({
        content: output.trim(),
        continuation: "",
        status: "complete",
        updatedAt: now,
      }).where(and(eq(ashStoryChapters.id, chapterId), eq(ashStoryChapters.storyId, bookId)));
      await tx.update(ashBooks).set({
        runStatus: "complete",
        activeRunId: runId,
        lastWrittenAt: now,
      }).where(eq(ashBooks.id, bookId));
      await tx.update(ashStoryRuns).set({
        output,
        checkpoint: output.slice(-4000),
        status: "complete",
        error: "",
        finishedAt: now,
        updatedAt: now,
      }).where(eq(ashStoryRuns.id, runId));
    });
  }
  async insertProactiveStoryText(token: string, generation: number, content: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const now = new Date();
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), eq(ashStoryLease.token, token), eq(ashStoryLease.generation, generation), gt(ashStoryLease.expiresAt, now))).limit(1);
      if (!lease) throw new Error("Story lease lost before proactive prose could be saved");
      const [last] = await tx.select({ position: ashStoryChapters.position }).from(ashStoryChapters).where(eq(ashStoryChapters.storyId, ASH_ID)).orderBy(desc(ashStoryChapters.position)).limit(1);
      await tx.insert(ashStoryChapters).values({ storyId: ASH_ID, position: (last?.position ?? 0) + 1, content, status: "complete" });
    });
  }
  async acquireStoryLease(token: string, ttlMs: number): Promise<number | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const now = new Date(), expiresAt = new Date(Date.now() + ttlMs);
      const [existing] = await tx.select().from(ashStoryLease).where(eq(ashStoryLease.id, ASH_ID)).limit(1);
      if (existing && existing.expiresAt > now) return null;
      const generation = (existing?.generation ?? 0) + 1;
      if (existing) {
        await tx.update(ashStoryLease).set({ token, generation, expiresAt, updatedAt: now }).where(eq(ashStoryLease.id, ASH_ID));
      } else {
        await tx.insert(ashStoryLease).values({ id: ASH_ID, token, generation, expiresAt });
      }
      return generation;
    });
  }
  async renewStoryLease(token: string, generation: number, ttlMs: number): Promise<boolean> {
    const now = new Date(), expiresAt = new Date(Date.now() + ttlMs);
    const rows = await db.update(ashStoryLease).set({ expiresAt, updatedAt: now }).where(and(eq(ashStoryLease.id, ASH_ID), eq(ashStoryLease.token, token), eq(ashStoryLease.generation, generation), gt(ashStoryLease.expiresAt, now))).returning({ id: ashStoryLease.id });
    return rows.length > 0;
  }
  async releaseStoryLease(token: string, generation: number): Promise<void> {
    await db.update(ashStoryLease).set({ expiresAt: new Date(), updatedAt: new Date() }).where(and(eq(ashStoryLease.id, ASH_ID), eq(ashStoryLease.token, token), eq(ashStoryLease.generation, generation)));
  }
  async recordStoryError(runId: string, message: string): Promise<void> { await db.insert(ashStoryErrors).values({ runId, message: message.slice(0, 4000) }); }
  async getState(): Promise<AshState> {
    // A read after midnight also resets the display if no model call occurred.
    // The conditional UPDATE is serialized with concurrent token increments.
    await db.update(ashState)
      .set({ tokensUsed: 0, tokensMonth: currentTokenMonth })
      .where(and(eq(ashState.id, ASH_ID), ne(ashState.tokensMonth, currentTokenMonth)));
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

  async addTokenUsage(tokens: number): Promise<void> {
    if (!Number.isSafeInteger(tokens) || tokens <= 0) throw new Error("Invalid token usage");
    // The row lock taken by UPDATE prevents concurrent responses from losing
    // increments. A response arriving after the 1st starts the new month.
    await db.update(ashState).set({
      tokensUsed: sql`CASE WHEN ${ashState.tokensMonth} = ${currentTokenMonth} THEN ${ashState.tokensUsed} + ${tokens} ELSE ${tokens} END`,
      tokensMonth: currentTokenMonth,
    }).where(eq(ashState.id, ASH_ID));
  }

  // Append one dated entry without risking a read/modify/write race. If the
  // resulting Notes section would exceed its allowance, leave it untouched.
  async appendAshNote(entry: string, maxWords: number): Promise<{ saved: boolean; wordCount: number }> {
    const nextNotes = sql<string>`CASE
      WHEN ${ashState.personaAshNotes} = '' THEN ${entry}
      ELSE ${ashState.personaAshNotes} || ${"\n\n"} || ${entry}
    END`;
    const nextWordCount = sql<number>`CASE
      WHEN ${nextNotes} ~ '^[[:space:]]*$' THEN 0
      ELSE cardinality(regexp_split_to_array(
        regexp_replace(${nextNotes}, '^[[:space:]]+|[[:space:]]+$', '', 'g'),
        '[[:space:]]+'
      ))
    END`;
    const rows = await db
      .update(ashState)
      .set({ personaAshNotes: nextNotes })
      .where(and(
        eq(ashState.id, ASH_ID),
        sql`${nextWordCount} <= ${maxWords}`,
      ))
      .returning({ notes: ashState.personaAshNotes });
    const countWhitespaceWords = (value: string): number => {
      const trimmed = value.trim();
      return trimmed ? trimmed.split(/\s+/u).length : 0;
    };
    if (rows[0]) return { saved: true, wordCount: countWhitespaceWords(rows[0].notes) };
    const state = await this.getState();
    return { saved: false, wordCount: countWhitespaceWords(state.personaAshNotes) };
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

  async createMessage(
    msg: InsertMessage,
    imageKind?: "upload" | "generated" | "screenshot",
  ): Promise<AshMessage> {
    const hasImage = Boolean(msg.imageUrl);
    const imageUrl = msg.imageUrl?.startsWith("data:")
      ? await saveImageDataUrl(msg.imageUrl)
      : msg.imageUrl;
    const savedImageKind = hasImage ? imageKind ?? (msg.role === "ash" ? "generated" : "upload") : null;
    return db.transaction(async (tx) => {
      const [message] = await tx.insert(ashMessages).values({ ...msg, imageUrl }).returning();
      if (savedImageKind === "screenshot") {
        await tx.insert(ashActivity).values({
          kind: "screenshot",
          message: "Screenshot saved to chat history",
        });
      }
      return message!;
    });
  }

  async updateMessageImage(id: number, imageDataUrl: string): Promise<void> {
    const imageUrl = await saveImageDataUrl(imageDataUrl);
    await db.update(ashMessages).set({ imageUrl }).where(eq(ashMessages.id, id));
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

  async getRecentStillwaterHistory(perRole: number): Promise<AshMessage[]> {
    const [wickedMessages, ashHistory] = await Promise.all(
      (["wicked", "ash"] as const).map((role) => db
        .select()
        .from(ashMessages)
        .where(and(eq(ashMessages.source, "private_message"), eq(ashMessages.role, role)))
        .orderBy(desc(ashMessages.id))
        .limit(perRole)),
    );
    return [...wickedMessages, ...ashHistory].sort((a, b) => a.id - b.id);
  }

  async getRecentOwnerDiscordHistory(perRole: number): Promise<AshMessage[]> {
    const [ownerMessages, ashHistory] = await Promise.all([
      db
        .select()
        .from(ashMessages)
        .where(and(eq(ashMessages.source, "discord_owner"), eq(ashMessages.role, "wicked")))
        .orderBy(desc(ashMessages.id))
        .limit(perRole),
      db
        .select()
        .from(ashMessages)
        .where(and(eq(ashMessages.source, "discord_owner"), eq(ashMessages.role, "ash")))
        .orderBy(desc(ashMessages.id))
        .limit(perRole),
    ]);
    return [...ownerMessages, ...ashHistory].sort((a, b) => a.id - b.id);
  }

  async getDiaryEntries(): Promise<AshDiaryEntry[]> {
    return db.select().from(ashDiaryEntries).orderBy(desc(ashDiaryEntries.id));
  }

  async getRecentDiaryEntries(limit: number): Promise<AshDiaryEntry[]> {
    return db.select().from(ashDiaryEntries).orderBy(desc(ashDiaryEntries.id)).limit(limit);
  }

  async createDiaryEntry(entry: InsertDiaryEntry): Promise<AshDiaryEntry> {
    const rows = await db.insert(ashDiaryEntries).values(entry).returning();
    return rows[0]!;
  }

  async saveChronicle(entry: InsertChronicle): Promise<{ chronicle: AshChronicle; created: boolean }> {
    const existing = await db
      .select()
      .from(ashChronicles)
      .where(eq(ashChronicles.chronicleId, entry.chronicleId))
      .limit(1);
    if (existing[0]) return { chronicle: existing[0], created: false };
    const rows = await db.insert(ashChronicles).values(entry).onConflictDoNothing({
      target: ashChronicles.chronicleId,
    }).returning();
    if (rows[0]) return { chronicle: rows[0], created: true };
    const retried = await db.select().from(ashChronicles)
      .where(eq(ashChronicles.chronicleId, entry.chronicleId)).limit(1);
    if (!retried[0]) throw new Error("Chronicle insert was not visible after conflict");
    return { chronicle: retried[0], created: false };
  }

  async getPendingChronicles(): Promise<AshChronicle[]> {
    return db.select().from(ashChronicles)
      .where(eq(ashChronicles.status, "received"))
      .orderBy(ashChronicles.id);
  }

  async markChronicleAcknowledged(chronicleId: string): Promise<void> {
    await db.update(ashChronicles)
      .set({ status: "acknowledged", acknowledgedAt: new Date(), lastError: "" })
      .where(eq(ashChronicles.chronicleId, chronicleId));
  }

  async recordChronicleError(chronicleId: string, error: string): Promise<void> {
    await db.update(ashChronicles)
      .set({ lastError: error.slice(0, 1000) })
      .where(eq(ashChronicles.chronicleId, chronicleId));
  }

  async deleteDiaryEntry(id: number): Promise<void> {
    await db.delete(ashDiaryEntries).where(eq(ashDiaryEntries.id, id));
  }

  async logActivity(kind: string, message: string): Promise<void> {
    await db.insert(ashActivity).values({ kind, message });
  }

  async stageScreenCapture(requestId: string, imageDataUrl: string): Promise<number | null> {
    return db.transaction(async (tx) => {
      const [request] = await tx.select().from(ashCaptureRequest)
        .where(eq(ashCaptureRequest.id, ASH_ID)).for("update").limit(1);
      if (!request || request.requestId !== requestId || request.status !== "pending" ||
          !request.expiresAt || request.expiresAt <= new Date()) return null;
      const [activity] = await tx
        .insert(ashActivity)
        .values({ kind: "screen_capture", message: "Screenshot taken" })
        .returning({ id: ashActivity.id });
      await tx.insert(ashActivityScreenshots).values({
        activityId: activity!.id,
        imageDataUrl,
      });
      await tx.update(ashCaptureRequest).set({
        status: "complete", activityId: activity!.id, imageDataUrl, updatedAt: new Date(),
      }).where(eq(ashCaptureRequest.id, ASH_ID));
      return activity!.id;
    });
  }

  async publishCaptureRequest(requestId: string, activityId: number): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ash_capture_request WHERE id = 'ash' FOR UPDATE`);
      const [request] = await tx.select().from(ashCaptureRequest)
        .where(and(
          eq(ashCaptureRequest.id, ASH_ID),
          eq(ashCaptureRequest.requestId, requestId),
          eq(ashCaptureRequest.status, "complete"),
          eq(ashCaptureRequest.activityId, activityId),
        )).limit(1);
      if (!request) return false;
      const rows = await tx.update(ashActivityScreenshots).set({ ready: 1 })
        .where(eq(ashActivityScreenshots.activityId, activityId))
        .returning({ activityId: ashActivityScreenshots.activityId });
      if (!rows.length) return false;
      await tx.update(ashCaptureRequest).set({ status: "ready", updatedAt: new Date() })
        .where(and(eq(ashCaptureRequest.id, ASH_ID), eq(ashCaptureRequest.requestId, requestId), eq(ashCaptureRequest.status, "complete")));
      return true;
    });
  }

  async discardScreenCapture(activityId: number): Promise<void> {
    await db.delete(ashActivity).where(eq(ashActivity.id, activityId));
  }

  async getActivity(limit = 100): Promise<ActivityFeedItem[]> {
    return db
      .select({
        id: ashActivity.id,
        kind: ashActivity.kind,
        message: ashActivity.message,
        createdAt: ashActivity.createdAt,
        hasScreenshot: sql<boolean>`${ashActivityScreenshots.ready} = 1`,
      })
      .from(ashActivity)
      .leftJoin(
        ashActivityScreenshots,
        eq(ashActivityScreenshots.activityId, ashActivity.id),
      )
      .where(and(
        ne(ashActivity.kind, "discord"),
        // Keep previously recorded Scribe usage out of the general activity feed.
        ne(ashActivity.kind, "cell_stt"),
        ne(ashActivity.kind, "cell_stt_attempt"),
        ne(ashActivity.kind, "cell_stt_failed"),
        or(
          ne(ashActivity.kind, "screen_capture"),
          eq(ashActivityScreenshots.ready, 1),
        ),
      ))
      .orderBy(desc(ashActivity.id))
      .limit(limit);
  }

  async getActivityScreenshot(activityId: number): Promise<string | null> {
    const [row] = await db
      .select({ imageDataUrl: ashActivityScreenshots.imageDataUrl })
      .from(ashActivityScreenshots)
      .where(and(
        eq(ashActivityScreenshots.activityId, activityId),
        eq(ashActivityScreenshots.ready, 1),
      ))
      .limit(1);
    return row?.imageDataUrl ?? null;
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

  async getUnseenTiktokComments(limit: number): Promise<AshTiktokComment[]> {
    return db
      .select()
      .from(ashTiktokComments)
      .where(eq(ashTiktokComments.seenByAsh, 0))
      .orderBy(ashTiktokComments.id)
      .limit(limit);
  }

  async countUnseenTiktokComments(): Promise<number> {
    const [row] = await db.select({ count: count() }).from(ashTiktokComments)
      .where(eq(ashTiktokComments.seenByAsh, 0));
    return row?.count ?? 0;
  }

  // Atomically claim only the rows already selected for the packet. The
  // seen=0 guard guarantees concurrent messages cannot claim the same comment.
  async claimTiktokComments(ids: number[]): Promise<AshTiktokComment[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .update(ashTiktokComments)
      .set({ seenByAsh: 1 })
      .where(and(
        inArray(ashTiktokComments.id, ids),
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

  // ── Discord Court Herald ──
  async listDiscordChannels(): Promise<AshDiscordChannel[]> {
    return db
      .select()
      .from(ashDiscordChannels)
      .orderBy(ashDiscordChannels.guildName, ashDiscordChannels.channelName);
  }

  async replaceDiscordChannels(
    channels: Array<Omit<AshDiscordChannel, "id" | "selectedAt">>,
  ): Promise<AshDiscordChannel[]> {
    const permittedChannels = channels.filter(
      (channel) => !isDiscordPlayerTicketChannel(channel.channelName),
    );
    await db.transaction(async (tx) => {
      // One global config lock serializes concurrent settings saves. Per-channel
      // locks then make the save wait for already-authorized intake/delivery.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-discord-config'))`);
      const current = await tx
        .select({ channelId: ashDiscordChannels.channelId })
        .from(ashDiscordChannels);
      const lockIds = [...new Set([
        ...current.map((channel) => channel.channelId),
        ...permittedChannels.map((channel) => channel.channelId),
      ])].sort();
      for (const channelId of lockIds) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${channelId}))`);
      }

      await tx.delete(ashDiscordChannels);
      if (permittedChannels.length > 0) {
        await tx.insert(ashDiscordChannels).values(permittedChannels);
      }

      // Revoking a hall also revokes and erases its retained public context.
      // This makes the opt-in boundary true for both future and historic reads.
      if (permittedChannels.length === 0) {
        await tx.delete(ashDiscordMessages).where(
          ne(ashDiscordMessages.guildId, DISCORD_OWNER_DM_GUILD_ID),
        );
      } else {
        const selectedIds = permittedChannels.map((channel) => channel.channelId);
        await tx.delete(ashDiscordMessages).where(
          and(
            ne(ashDiscordMessages.guildId, DISCORD_OWNER_DM_GUILD_ID),
            notInArray(ashDiscordMessages.channelId, selectedIds),
          ),
        );
      }
    });
    return this.listDiscordChannels();
  }

  async isDiscordChannelConfigured(channelId: string): Promise<boolean> {
    const rows = await db
      .select({
        id: ashDiscordChannels.id,
        channelName: ashDiscordChannels.channelName,
      })
      .from(ashDiscordChannels)
      .where(eq(ashDiscordChannels.channelId, channelId))
      .limit(1);
    return rows.length > 0 && !isDiscordPlayerTicketChannel(rows[0]!.channelName);
  }

  async recordDiscordMessage(
    message: Omit<AshDiscordMessage, "id" | "recordedAt" | "updatedAt" | "replyDiscordMessageId" | "deliveryError">,
  ): Promise<{ message: AshDiscordMessage; created: boolean }> {
    const rows = await db
      .insert(ashDiscordMessages)
      .values(message)
      .onConflictDoNothing({ target: ashDiscordMessages.discordMessageId })
      .returning();
    if (rows[0]) return { message: rows[0], created: true };
    const existing = await db
      .select()
      .from(ashDiscordMessages)
      .where(eq(ashDiscordMessages.discordMessageId, message.discordMessageId))
      .limit(1);
    if (!existing[0]) throw new Error("Discord message insert conflicted without an existing row");
    return { message: existing[0], created: false };
  }

  async getDiscordMessageById(id: number): Promise<AshDiscordMessage | null> {
    const rows = await db
      .select()
      .from(ashDiscordMessages)
      .where(eq(ashDiscordMessages.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async claimDiscordMentions(limit: number): Promise<{ leaseId: string; messages: AshDiscordMessage[] }> {
    const firstPending = await db
      .select({ guildId: ashDiscordMessages.guildId, channelId: ashDiscordMessages.channelId })
      .from(ashDiscordMessages)
      .where(eq(ashDiscordMessages.deliveryStatus, "queued"))
      .orderBy(ashDiscordMessages.id)
      .limit(1);
    if (!firstPending[0]) return { leaseId: "", messages: [] };
    const pending = await db
      .select({ id: ashDiscordMessages.id })
      .from(ashDiscordMessages)
      .where(and(
        eq(ashDiscordMessages.deliveryStatus, "queued"),
        eq(ashDiscordMessages.guildId, firstPending[0].guildId),
        eq(ashDiscordMessages.channelId, firstPending[0].channelId),
      ))
      .orderBy(ashDiscordMessages.id)
      .limit(limit);
    if (pending.length === 0) return { leaseId: "", messages: [] };
    const ids = pending.map((row) => row.id);
    const leaseId = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + 10 * 60_000);
    const claimed = await db
      .update(ashDiscordMessages)
      .set({
        deliveryStatus: "processing",
        deliveryError: "",
        deliveryLeaseId: leaseId,
        deliveryLeaseExpiresAt: leaseExpiresAt,
        updatedAt: new Date(),
      })
      .where(and(
        inArray(ashDiscordMessages.id, ids),
        eq(ashDiscordMessages.deliveryStatus, "queued"),
      ))
      .returning();
    return { leaseId, messages: claimed.sort((a, b) => a.id - b.id) };
  }

  async requeueDiscordMessages(ids: number[], leaseId: string): Promise<void> {
    if (ids.length === 0) return;
    await db
      .update(ashDiscordMessages)
      .set({
        deliveryStatus: "queued",
        deliveryError: "",
        deliveryLeaseId: "",
        deliveryLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        inArray(ashDiscordMessages.id, ids),
        eq(ashDiscordMessages.deliveryStatus, "processing"),
        eq(ashDiscordMessages.deliveryLeaseId, leaseId),
      ));
  }

  async recoverDiscordDeliveries(): Promise<void> {
    const now = new Date();
    const expired = or(
      isNull(ashDiscordMessages.deliveryLeaseExpiresAt),
      lt(ashDiscordMessages.deliveryLeaseExpiresAt, now),
    );
    await db.transaction(async (tx) => {
      // Only expired claims are recoverable. An older instance with a live
      // lease retains ownership and remains the only process allowed to send.
      await tx
        .update(ashDiscordMessages)
        .set({
          deliveryStatus: "queued",
          deliveryError: "",
          deliveryLeaseId: "",
          deliveryLeaseExpiresAt: null,
          updatedAt: now,
        })
        .where(and(eq(ashDiscordMessages.deliveryStatus, "processing"), expired));
      // Once sending begins, a crash leaves the remote outcome unknowable. Do
      // not retry automatically: avoiding a duplicate public reply is safer.
      await tx
        .update(ashDiscordMessages)
        .set({
          deliveryStatus: "failed",
          deliveryError: "Delivery outcome unknown after restart; not retried to avoid a duplicate reply",
          deliveryLeaseId: "",
          deliveryLeaseExpiresAt: null,
          updatedAt: now,
        })
        .where(and(eq(ashDiscordMessages.deliveryStatus, "sending"), expired));
    });
  }

  async markDiscordMessagesSkipped(ids: number[], leaseId: string): Promise<void> {
    if (ids.length === 0) return;
    await db
      .update(ashDiscordMessages)
      .set({
        deliveryStatus: "skipped",
        deliveryLeaseId: "",
        deliveryLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        inArray(ashDiscordMessages.id, ids),
        eq(ashDiscordMessages.deliveryStatus, "processing"),
        eq(ashDiscordMessages.deliveryLeaseId, leaseId),
      ));
  }

  async beginDiscordDelivery(id: number, leaseId: string): Promise<AshDiscordMessage | null> {
    const rows = await db
      .update(ashDiscordMessages)
      .set({ deliveryStatus: "sending", deliveryError: "", updatedAt: new Date() })
      .where(and(
        eq(ashDiscordMessages.id, id),
        eq(ashDiscordMessages.deliveryStatus, "processing"),
        eq(ashDiscordMessages.deliveryLeaseId, leaseId),
        gt(ashDiscordMessages.deliveryLeaseExpiresAt, new Date()),
      ))
      .returning();
    return rows[0] ?? null;
  }

  async completeDiscordDelivery(
    id: number,
    leaseId: string,
    replyDiscordMessageId: string,
  ): Promise<boolean> {
    const rows = await db
      .update(ashDiscordMessages)
      .set({
        deliveryStatus: "replied",
        replyDiscordMessageId,
        deliveryError: "",
        deliveryLeaseId: "",
        deliveryLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(ashDiscordMessages.id, id),
        eq(ashDiscordMessages.deliveryStatus, "sending"),
        eq(ashDiscordMessages.deliveryLeaseId, leaseId),
      ))
      .returning({ id: ashDiscordMessages.id });
    return rows.length === 1;
  }

  async failDiscordDelivery(id: number, leaseId: string, error: string): Promise<boolean> {
    const rows = await db
      .update(ashDiscordMessages)
      .set({
        deliveryStatus: "failed",
        deliveryError: error.slice(0, 500),
        deliveryLeaseId: "",
        deliveryLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(ashDiscordMessages.id, id),
        inArray(ashDiscordMessages.deliveryStatus, ["processing", "sending"]),
        eq(ashDiscordMessages.deliveryLeaseId, leaseId),
      ))
      .returning({ id: ashDiscordMessages.id });
    return rows.length === 1;
  }

  async withDiscordChannelLock<T>(
    channelId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${channelId}))`);
      return work();
    });
  }

  async getRecentDiscordContext(guildId: string, limit: number, ownerUserId?: string): Promise<AshDiscordMessage[]> {
    const selected = await this.listDiscordChannels();
    if (selected.length === 0) return [];
    const rows = await db
      .select()
      .from(ashDiscordMessages)
      .where(and(
        eq(ashDiscordMessages.guildId, guildId),
        inArray(ashDiscordMessages.channelId, selected.map((channel) => channel.channelId)),
        ownerUserId ? ne(ashDiscordMessages.authorId, ownerUserId) : undefined,
      ))
      .orderBy(desc(ashDiscordMessages.createdAt), desc(ashDiscordMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  async getAuthorizedDiscordChannelMessages(guildId: string, channelId: string): Promise<AshDiscordMessage[]> {
    if (guildId !== DISCORD_OWNER_DM_GUILD_ID) {
      const selected = await db.select({ id: ashDiscordChannels.id })
        .from(ashDiscordChannels)
        .where(and(
          eq(ashDiscordChannels.guildId, guildId),
          eq(ashDiscordChannels.channelId, channelId),
        ))
        .limit(1);
      if (selected.length === 0) throw new Error("Discord channel is no longer selected");
    }
    // These records exist only for opted-in intake and are erased on revocation.
    // Their original/reply IDs are the boundary for live Discord history reads.
    return db.select().from(ashDiscordMessages)
      .where(and(
        eq(ashDiscordMessages.guildId, guildId),
        eq(ashDiscordMessages.channelId, channelId),
      ))
      .orderBy(desc(ashDiscordMessages.id))
      .limit(500);
  }

  async getRecentDiscordPlayerComments(limit: number, ownerUserId: string): Promise<AshDiscordMessage[]> {
    const selected = await this.listDiscordChannels();
    if (selected.length === 0 || !ownerUserId) return [];
    const rows = await db
      .select()
      .from(ashDiscordMessages)
      .where(and(
        inArray(ashDiscordMessages.channelId, selected.map((channel) => channel.channelId)),
        ne(ashDiscordMessages.authorId, ownerUserId),
      ))
      .orderBy(desc(ashDiscordMessages.createdAt), desc(ashDiscordMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  async getRecentDiscordCommentHistory(limit: number): Promise<AshDiscordMessage[]> {
    const selected = await db
      .select({ channelId: ashDiscordChannels.channelId })
      .from(ashDiscordChannels);
    if (selected.length === 0) return [];
    const rows = await db
      .select()
      .from(ashDiscordMessages)
      .where(inArray(
        ashDiscordMessages.channelId,
        selected.map((channel) => channel.channelId),
      ))
      .orderBy(desc(ashDiscordMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  async getRecentDiscordOwnerComments(guildId: string, limit: number, ownerUserId: string): Promise<AshDiscordMessage[]> {
    if (!ownerUserId) return [];
    const selected = await this.listDiscordChannels();
    if (selected.length === 0 && guildId !== DISCORD_OWNER_DM_GUILD_ID) return [];
    const scope = guildId === DISCORD_OWNER_DM_GUILD_ID
      ? eq(ashDiscordMessages.guildId, DISCORD_OWNER_DM_GUILD_ID)
      : and(
        eq(ashDiscordMessages.guildId, guildId),
        inArray(ashDiscordMessages.channelId, selected.map((channel) => channel.channelId)),
      );
    const rows = await db
      .select()
      .from(ashDiscordMessages)
      .where(and(
        eq(ashDiscordMessages.authorId, ownerUserId),
        scope,
      ))
      .orderBy(desc(ashDiscordMessages.createdAt), desc(ashDiscordMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  async getRecentDiscordActivity(limit = 100): Promise<AshDiscordMessage[]> {
    const selected = await this.listDiscordChannels();
    if (selected.length === 0) return [];
    const rows = await db
      .select()
      .from(ashDiscordMessages)
      .where(and(
        inArray(ashDiscordMessages.channelId, selected.map((channel) => channel.channelId)),
        inArray(ashDiscordMessages.kind, ["call", "owner_call"]),
      ))
      .orderBy(desc(ashDiscordMessages.createdAt), desc(ashDiscordMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  async pruneDiscordMessages(maxRows = 500): Promise<void> {
    const oldestAllowed = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const finalized = notInArray(
      ashDiscordMessages.deliveryStatus,
      ["queued", "processing", "sending"],
    );
    await db
      .delete(ashDiscordMessages)
      .where(and(
        lt(ashDiscordMessages.recordedAt, oldestAllowed),
        finalized,
      ));

    const retained = await db
      .select({ id: ashDiscordMessages.id })
      .from(ashDiscordMessages)
      .where(finalized)
      .orderBy(desc(ashDiscordMessages.id))
      .limit(maxRows);
    if (retained.length === maxRows) {
      await db
        .delete(ashDiscordMessages)
        .where(and(
          lt(ashDiscordMessages.id, retained[retained.length - 1]!.id),
          finalized,
        ));
    }
  }
}

export const storage = new DbStorage();


