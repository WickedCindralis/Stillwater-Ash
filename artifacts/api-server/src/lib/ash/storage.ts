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
  ashStory,
  ashStoryChapters,
  ashStoryRuns,
  ashStoryLease,
  ashStoryErrors,
  ashHangoutSession,
  ashHangoutScreenshots,
  ashCaptureRequest,
  type AshStory,
  type AshStoryChapter,
  type AshStoryRun,
  type AshDiscordChannel,
  type AshDiscordMessage,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import { eq, ne, desc, asc, inArray, and, like, lt, gt, gte, lte, isNull, notInArray, or, sql } from "drizzle-orm";
import {
  DISCORD_OWNER_DM_GUILD_ID,
  isDiscordPlayerTicketChannel,
} from "./discord-policy";

const ASH_ID = "ash";

export type ActivityFeedItem = AshActivity & { hasScreenshot: boolean };
export type StoryRunStart = {
  story: AshStory;
  chapters: AshStoryChapter[];
  run: AshStoryRun;
  chapter: AshStoryChapter;
};

export interface IStorage {
  getState(): Promise<AshState>;
  updateState(patch: Partial<Omit<AshState, "id">>): Promise<AshState>;
  appendAshNote(entry: string, maxChars: number): Promise<{ saved: boolean; length: number }>;
  getMessages(limit?: number, beforeId?: number): Promise<AshMessage[]>;
  getAllMessages(): Promise<AshMessage[]>;
  purgeMessagesKeepLast(keep: number): Promise<number>;
  getMessageById(id: number): Promise<AshMessage | null>;
  clearWickedPhotos(): Promise<number>;
  createMessage(msg: InsertMessage): Promise<AshMessage>;
  getRecentHistory(limit: number): Promise<AshMessage[]>;
  getRecentOwnerDiscordHistory(perRole: number): Promise<AshMessage[]>;
  getDiaryEntries(): Promise<AshDiaryEntry[]>;
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
  getRecentDiscordContext(guildId: string, limit: number): Promise<AshDiscordMessage[]>;
  getRecentDiscordCommentHistory(limit: number): Promise<AshDiscordMessage[]>;
  getRecentDiscordOwnerCalls(guildId: string, limit: number): Promise<AshDiscordMessage[]>;
  getRecentDiscordActivity(limit?: number): Promise<AshDiscordMessage[]>;
  pruneDiscordMessages(maxRows?: number): Promise<void>;
  getStory(): Promise<{ story: AshStory; chapters: AshStoryChapter[]; run: AshStoryRun | null }>;
  updateStory(patch: Partial<Pick<AshStory, "title" | "storyPacket" | "rollingSummary" | "runStatus" | "activeRunId">>): Promise<AshStory>;
  updateStoryWhenIdle(patch: Partial<Pick<AshStory, "title" | "storyPacket" | "rollingSummary">>): Promise<AshStory | null>;
  updateStorySummaryIfUnchanged(expected: string, summary: string): Promise<boolean>;
  updateStoryChapter(id: number, patch: Partial<Pick<AshStoryChapter, "title" | "content" | "continuation" | "status">>): Promise<AshStoryChapter | null>;
  createStoryChapter(chapter: { position: number; title?: string; content?: string; continuation?: string; status?: string }): Promise<AshStoryChapter>;
  getStoryChapter(id: number): Promise<AshStoryChapter | null>;
  deleteStoryChapter(id: number): Promise<boolean>;
  moveStoryChapter(id: number, position: number): Promise<AshStoryChapter | null>;
  moveStoryChapterDirection(id: number, direction: "up" | "down"): Promise<AshStoryChapter | null>;
  beginStoryRun(token: string, generation: number, runId: string, prompt: string, resumeRunId?: string): Promise<StoryRunStart>;
  updateStoryRun(id: string, patch: Partial<Omit<AshStoryRun, "id" | "startedAt">>): Promise<AshStoryRun | null>;
  checkpointStoryRun(token: string, generation: number, runId: string, chapterId: number, output: string, status: "running" | "paused"): Promise<void>;
  failStoryRun(token: string, generation: number, runId: string, chapterId: number, output: string, error: string): Promise<void>;
  completeStoryRun(token: string, generation: number, runId: string, chapterId: number, output: string): Promise<void>;
  insertProactiveStoryText(token: string, generation: number, content: string): Promise<void>;
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

  async acquireHangoutLease(sessionId: string, idleCutoff?: Date): Promise<{ token: string; generation: number; status: string } | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-hangout'))`);
      const now = new Date();
      const [row] = await tx.select().from(ashHangoutSession).where(eq(ashHangoutSession.id, ASH_ID)).limit(1);
      if (!row || row.sessionId !== sessionId || row.status === "idle" || (row.leaseExpiresAt && row.leaseExpiresAt > now)) return null;
      if (idleCutoff && (
        !row.lastActivityAt || row.lastActivityAt > idleCutoff ||
        (row.lastIdleCheckinAt && row.lastIdleCheckinAt > idleCutoff)
      )) return null;
      const token = randomUUID();
      const [updated] = await tx.update(ashHangoutSession).set({
        leaseToken: token, leaseExpiresAt: new Date(Date.now() + 15 * 60_000),
        ...(idleCutoff ? { lastIdleCheckinAt: now } : {}), updatedAt: now,
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
    sessionId: string, generation: number, leaseToken: string, activityId: number, correlationId: string, content: string,
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
      const [message] = await tx.insert(ashMessages).values({
        role: "ash", content, imageUrl: "", source: "private_message",
      }).returning();
      await tx.insert(ashHangoutScreenshots).values({
        activityId, messageId: message!.id, sessionId, companionTokenHash: session.companionTokenHash, correlationId,
      });
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


  async getStory(): Promise<{ story: AshStory; chapters: AshStoryChapter[]; run: AshStoryRun | null }> {
    let [story] = await db.select().from(ashStory).where(eq(ashStory.id, ASH_ID)).limit(1);
    if (!story) {
      await db.insert(ashStory).values({ id: ASH_ID }).onConflictDoNothing({ target: ashStory.id });
      [story] = await db.select().from(ashStory).where(eq(ashStory.id, ASH_ID)).limit(1);
    }
    const [state] = await db.select({ packet: ashState.personaStoryPacket }).from(ashState).where(eq(ashState.id, ASH_ID)).limit(1);
    if (state?.packet && story!.storyPacket !== state.packet) {
      [story] = await db.update(ashStory).set({ storyPacket: state.packet, updatedAt: new Date() }).where(eq(ashStory.id, ASH_ID)).returning();
    }
    if (story!.runStatus === "running" && Date.now() - story!.updatedAt.getTime() > 16 * 60_000) {
      const recovered = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
        const now = new Date();
        const [lockedStory] = await tx.select().from(ashStory).where(eq(ashStory.id, ASH_ID)).limit(1);
        const [lease] = await tx.select().from(ashStoryLease).where(eq(ashStoryLease.id, ASH_ID)).limit(1);
        if (!lockedStory || lockedStory.runStatus !== "running" || Date.now() - lockedStory.updatedAt.getTime() <= 16 * 60_000 || (lease && lease.expiresAt > now)) {
          return lockedStory ?? null;
        }
        if (lease) {
          await tx.update(ashStoryLease).set({ generation: lease.generation + 1, expiresAt: now, updatedAt: now }).where(eq(ashStoryLease.id, ASH_ID));
        }
        await tx.update(ashStoryRuns).set({ status: "paused", updatedAt: now }).where(and(eq(ashStoryRuns.storyId, ASH_ID), eq(ashStoryRuns.status, "running")));
        const [paused] = await tx.update(ashStory).set({ runStatus: "paused", updatedAt: now }).where(eq(ashStory.id, ASH_ID)).returning();
        return paused ?? null;
      });
      if (recovered) story = recovered;
    }
    const chapters = await db.select().from(ashStoryChapters).where(eq(ashStoryChapters.storyId, ASH_ID)).orderBy(asc(ashStoryChapters.position), asc(ashStoryChapters.id));
    const [run] = await db.select().from(ashStoryRuns).where(and(eq(ashStoryRuns.storyId, ASH_ID), inArray(ashStoryRuns.status, ["running", "paused", "failed"]))).orderBy(desc(ashStoryRuns.updatedAt)).limit(1);
    return { story: story!, chapters, run: run ?? null };
  }
  async updateStory(patch: Partial<Pick<AshStory, "title" | "storyPacket" | "rollingSummary" | "runStatus" | "activeRunId">>): Promise<AshStory> {
    const rows = await db.update(ashStory).set({ ...patch, updatedAt: new Date() }).where(eq(ashStory.id, ASH_ID)).returning();
    if (rows[0]) return rows[0];
    const inserted = await db.insert(ashStory).values({ id: ASH_ID, ...patch }).returning();
    return inserted[0]!;
  }
  async updateStoryWhenIdle(patch: Partial<Pick<AshStory, "title" | "storyPacket" | "rollingSummary">>): Promise<AshStory | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const [current] = await tx.select().from(ashStory).where(eq(ashStory.id, ASH_ID)).limit(1);
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), gt(ashStoryLease.expiresAt, new Date()))).limit(1);
      if (!current || current.runStatus === "running" || lease) return null;
      const [updated] = await tx.update(ashStory).set({ ...patch, updatedAt: new Date() }).where(eq(ashStory.id, ASH_ID)).returning();
      return updated ?? null;
    });
  }
  async updateStorySummaryIfUnchanged(expected: string, summary: string): Promise<boolean> {
    const rows = await db.update(ashStory).set({ rollingSummary: summary, updatedAt: new Date() }).where(and(eq(ashStory.id, ASH_ID), eq(ashStory.rollingSummary, expected))).returning({ id: ashStory.id });
    return rows.length > 0;
  }
  async updateStoryChapter(id: number, patch: Partial<Pick<AshStoryChapter, "title" | "content" | "continuation" | "status">>): Promise<AshStoryChapter | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const [story] = await tx.select().from(ashStory).where(eq(ashStory.id, ASH_ID)).limit(1);
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), gt(ashStoryLease.expiresAt, new Date()))).limit(1);
      if (story?.runStatus === "running" || lease) return null;
      const [row] = await tx.update(ashStoryChapters).set({ ...patch, updatedAt: new Date() }).where(eq(ashStoryChapters.id, id)).returning();
      return row ?? null;
    });
  }
  async createStoryChapter(chapter: { position: number; title?: string; content?: string; continuation?: string; status?: string }): Promise<AshStoryChapter> {
    const [row] = await db.insert(ashStoryChapters).values({ storyId: ASH_ID, ...chapter }).returning();
    return row!;
  }
  async getStoryChapter(id: number): Promise<AshStoryChapter | null> {
    const [row] = await db.select().from(ashStoryChapters).where(eq(ashStoryChapters.id, id)).limit(1);
    return row ?? null;
  }
  async deleteStoryChapter(id: number): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const [story] = await tx.select().from(ashStory).where(eq(ashStory.id, ASH_ID)).limit(1);
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), gt(ashStoryLease.expiresAt, new Date()))).limit(1);
      if (story?.runStatus === "running" || lease) return false;
      const deleted = (await tx.delete(ashStoryChapters).where(eq(ashStoryChapters.id, id)).returning({ id: ashStoryChapters.id })).length > 0;
      if (!deleted) return false;
      const [run] = await tx.select().from(ashStoryRuns).where(and(eq(ashStoryRuns.storyId, ASH_ID), eq(ashStoryRuns.chapterId, id), inArray(ashStoryRuns.status, ["paused", "failed"]))).orderBy(desc(ashStoryRuns.updatedAt)).limit(1);
      if (run) {
        const now = new Date();
        await tx.update(ashStoryRuns).set({ status: "complete", finishedAt: now, updatedAt: now }).where(eq(ashStoryRuns.id, run.id));
        await tx.update(ashStory).set({ runStatus: "idle", activeRunId: "", updatedAt: now }).where(and(eq(ashStory.id, ASH_ID), eq(ashStory.activeRunId, run.id)));
      }
      return true;
    });
  }
  async moveStoryChapter(id: number, position: number): Promise<AshStoryChapter | null> {
    const [chapter] = await db.select().from(ashStoryChapters).where(eq(ashStoryChapters.id, id)).limit(1);
    if (!chapter) return null;
    await db.transaction(async (tx) => {
      if (position < chapter.position) await tx.update(ashStoryChapters).set({ position: sql`${ashStoryChapters.position} + 1` }).where(and(eq(ashStoryChapters.storyId, chapter.storyId), gte(ashStoryChapters.position, position), lt(ashStoryChapters.position, chapter.position)));
      else if (position > chapter.position) await tx.update(ashStoryChapters).set({ position: sql`${ashStoryChapters.position} - 1` }).where(and(eq(ashStoryChapters.storyId, chapter.storyId), gt(ashStoryChapters.position, chapter.position), lte(ashStoryChapters.position, position)));
      await tx.update(ashStoryChapters).set({ position, updatedAt: new Date() }).where(eq(ashStoryChapters.id, id));
    });
    const [updated] = await db.select().from(ashStoryChapters).where(eq(ashStoryChapters.id, id));
    return updated ?? null;
  }
  async moveStoryChapterDirection(id: number, direction: "up" | "down"): Promise<AshStoryChapter | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const [story] = await tx.select().from(ashStory).where(eq(ashStory.id, ASH_ID)).limit(1);
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), gt(ashStoryLease.expiresAt, new Date()))).limit(1);
      if (story?.runStatus === "running" || lease) return null;
      const [chapter] = await tx.select().from(ashStoryChapters).where(eq(ashStoryChapters.id, id)).limit(1);
      if (!chapter) return null;
      const operator = direction === "up" ? lt : gt;
      const order = direction === "up" ? desc(ashStoryChapters.position) : asc(ashStoryChapters.position);
      const [adjacent] = await tx.select().from(ashStoryChapters).where(and(eq(ashStoryChapters.storyId, chapter.storyId), operator(ashStoryChapters.position, chapter.position))).orderBy(order).limit(1);
      if (!adjacent) return chapter;
      await tx.update(ashStoryChapters).set({ position: adjacent.position, updatedAt: new Date() }).where(eq(ashStoryChapters.id, chapter.id));
      const [updated] = await tx.update(ashStoryChapters).set({ position: chapter.position, updatedAt: new Date() }).where(eq(ashStoryChapters.id, adjacent.id)).returning();
      return (await tx.select().from(ashStoryChapters).where(eq(ashStoryChapters.id, chapter.id)).limit(1))[0] ?? updated ?? chapter;
    });
  }
  async beginStoryRun(token: string, generation: number, runId: string, prompt: string, resumeRunId?: string): Promise<StoryRunStart> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const now = new Date();
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), eq(ashStoryLease.token, token), eq(ashStoryLease.generation, generation), gt(ashStoryLease.expiresAt, now))).limit(1);
      if (!lease) throw new Error("Story lease lost before writing began");

      let [story] = await tx.select().from(ashStory).where(eq(ashStory.id, ASH_ID)).limit(1);
      if (!story) [story] = await tx.insert(ashStory).values({ id: ASH_ID }).returning();
      const chapters = await tx.select().from(ashStoryChapters).where(eq(ashStoryChapters.storyId, ASH_ID)).orderBy(asc(ashStoryChapters.position), asc(ashStoryChapters.id));

      let run: AshStoryRun | undefined;
      if (resumeRunId) [run] = await tx.select().from(ashStoryRuns).where(and(eq(ashStoryRuns.id, resumeRunId), eq(ashStoryRuns.storyId, ASH_ID))).limit(1);
      if (!run) [run] = await tx.insert(ashStoryRuns).values({ id: runId, prompt }).returning();

      let chapter: AshStoryChapter | undefined;
      if (run.chapterId) [chapter] = await tx.select().from(ashStoryChapters).where(eq(ashStoryChapters.id, run.chapterId)).limit(1);
      if (!chapter) {
        const nextPosition = chapters.reduce((max, item) => Math.max(max, item.position), 0) + 1;
        [chapter] = await tx.insert(ashStoryChapters).values({ storyId: ASH_ID, position: nextPosition, content: run.output, status: "unfinished" }).returning();
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
      [story] = await tx.update(ashStory).set({ runStatus: "running", activeRunId: run!.id, updatedAt: now }).where(eq(ashStory.id, ASH_ID)).returning();
      return { story: story!, chapters, run: run!, chapter: chapter! };
    });
  }
  async updateStoryRun(id: string, patch: Partial<Omit<AshStoryRun, "id" | "startedAt">>): Promise<AshStoryRun | null> {
    const [row] = await db.update(ashStoryRuns).set({ ...patch, updatedAt: new Date() }).where(eq(ashStoryRuns.id, id)).returning();
    return row ?? null;
  }
  async checkpointStoryRun(token: string, generation: number, runId: string, chapterId: number, output: string, status: "running" | "paused"): Promise<void> {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), eq(ashStoryLease.token, token), eq(ashStoryLease.generation, generation), gt(ashStoryLease.expiresAt, now))).limit(1);
      if (!lease) throw new Error("Story lease lost during checkpoint");
      const [ownedRun] = await tx.select({ id: ashStoryRuns.id }).from(ashStoryRuns).where(and(eq(ashStoryRuns.id, runId), eq(ashStoryRuns.leaseGeneration, generation))).limit(1);
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
      }).where(eq(ashStoryChapters.id, chapterId));
      await tx.update(ashStory).set({
        runStatus: status,
        activeRunId: runId,
        updatedAt: now,
      }).where(eq(ashStory.id, ASH_ID));
    });
  }
  async failStoryRun(token: string, generation: number, runId: string, chapterId: number, output: string, error: string): Promise<void> {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), eq(ashStoryLease.token, token), eq(ashStoryLease.generation, generation), gt(ashStoryLease.expiresAt, now))).limit(1);
      if (!lease) throw new Error("Story lease lost before failure state could be saved");
      const [ownedRun] = await tx.select({ id: ashStoryRuns.id }).from(ashStoryRuns).where(and(eq(ashStoryRuns.id, runId), eq(ashStoryRuns.leaseGeneration, generation))).limit(1);
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
      }).where(eq(ashStoryChapters.id, chapterId));
      await tx.update(ashStory).set({
        runStatus: "failed",
        activeRunId: runId,
        updatedAt: now,
      }).where(eq(ashStory.id, ASH_ID));
    });
  }
  async completeStoryRun(token: string, generation: number, runId: string, chapterId: number, output: string): Promise<void> {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ash-story'))`);
      const [lease] = await tx.select().from(ashStoryLease).where(and(eq(ashStoryLease.id, ASH_ID), eq(ashStoryLease.token, token), eq(ashStoryLease.generation, generation), gt(ashStoryLease.expiresAt, now))).limit(1);
      if (!lease) throw new Error("Story lease lost before completion");
      const [ownedRun] = await tx.select({ id: ashStoryRuns.id }).from(ashStoryRuns).where(and(eq(ashStoryRuns.id, runId), eq(ashStoryRuns.leaseGeneration, generation))).limit(1);
      if (!ownedRun) throw new Error("Story run fencing generation changed");
      await tx.update(ashStoryChapters).set({
        content: output.trim(),
        continuation: "",
        status: "complete",
        updatedAt: now,
      }).where(eq(ashStoryChapters.id, chapterId));
      await tx.update(ashStory).set({
        runStatus: "complete",
        activeRunId: runId,
        updatedAt: now,
      }).where(eq(ashStory.id, ASH_ID));
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

  // Append one dated entry without risking a read/modify/write race. If the
  // resulting Notes section would exceed its allowance, leave it untouched.
  async appendAshNote(entry: string, maxChars: number): Promise<{ saved: boolean; length: number }> {
    const nextNotes = sql<string>`CASE
      WHEN ${ashState.personaAshNotes} = '' THEN ${entry}
      ELSE ${ashState.personaAshNotes} || ${"\n\n"} || ${entry}
    END`;
    const rows = await db
      .update(ashState)
      .set({ personaAshNotes: nextNotes })
      .where(and(
        eq(ashState.id, ASH_ID),
        sql`char_length(${nextNotes}) <= ${maxChars}`,
      ))
      .returning({ notes: ashState.personaAshNotes });
    if (rows[0]) return { saved: true, length: rows[0].notes.length };
    const state = await this.getState();
    return { saved: false, length: state.personaAshNotes.length };
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

  async getUnseenTiktokComments(limit: number): Promise<AshTiktokComment[]> {
    return db
      .select()
      .from(ashTiktokComments)
      .where(eq(ashTiktokComments.seenByAsh, 0))
      .orderBy(ashTiktokComments.id)
      .limit(limit);
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
      .select({ guildId: ashDiscordMessages.guildId })
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

  async getRecentDiscordContext(guildId: string, limit: number): Promise<AshDiscordMessage[]> {
    const selected = await this.listDiscordChannels();
    if (selected.length === 0) return [];
    const rows = await db
      .select()
      .from(ashDiscordMessages)
      .where(and(
        eq(ashDiscordMessages.guildId, guildId),
        inArray(ashDiscordMessages.channelId, selected.map((channel) => channel.channelId)),
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

  async getRecentDiscordOwnerCalls(guildId: string, limit: number): Promise<AshDiscordMessage[]> {
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
        eq(ashDiscordMessages.kind, "owner_call"),
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


