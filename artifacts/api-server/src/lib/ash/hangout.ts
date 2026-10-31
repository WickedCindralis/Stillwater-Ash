import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { ashBridge } from "./bridge";
import { storage } from "./storage";
import { recordAshMemoryMessage } from "./vector-memory";
import { waitForFreshScreenCapture, cancelPendingScreenCapture, isFreshScreenCaptureCurrent } from "./screen-capture";
import type { AshMessage } from "@workspace/db";
import { logger } from "../logger";
import { isCompanionConnected, parseHangoutApproval, privateMessageHangoutMode, shouldEndDisconnectedHangout } from "./hangout-policy";

function invitationForInterval(minutes: number): string {
  return `Wicked wants to know if you want to hang out with her while she works/plays. This will send you a screenshot with each message and every ${minutes} minute${minutes === 1 ? "" : "s"} while the chat is idle. Your messages will go straight to her, and she will respond.`;
}
let idleScheduler: ReturnType<typeof setInterval> | null = null;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function tokenMatches(token: string, hash: string): boolean {
  if (!token || !hash) return false;
  const supplied = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(hash, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function safeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const safeMessages = new Set([
    "A fresh screenshot could not be captured; Ash was not shown an image.",
    "Hangout was invalidated before the screenshot could be delivered",
    "Hangout was stopped before the approval response could be saved",
    "Hangout was invalidated before message persistence",
    "Hangout was invalidated before screenshot persistence",
    "Ash did not return a reply for the screenshot-backed exchange",
    "Hangout is not active",
    "A Hangout exchange is already in progress",
    "Hangout companion is offline",
  ]);
  if (safeMessages.has(message)) return message;
  return "Hangout could not complete the exchange. Check session status and try again.";
}

function logBoundary(event: string, sessionId: string, correlationId: string, startedAt: number, fields = ""): void {
  logger.info(`[hangout] ${event} sessionId=${sessionId} correlationId=${correlationId} durationMs=${Date.now() - startedAt}${fields ? ` ${fields}` : ""}`);
}

async function endDisconnectedHangout(session: Awaited<ReturnType<typeof storage.getHangoutSession>>): Promise<boolean> {
  if (!shouldEndDisconnectedHangout(session.status, session.companionLastSeen) || !session.sessionId) return false;
  const stopped = await storage.stopHangoutSession(session.sessionId, session.generation);
  if (stopped) logger.info("[hangout] Disconnected companion ended stale Hangout before capture");
  return stopped;
}

async function captureAndReply(sessionId: string, generation: number, lease: string, prompt: string): Promise<AshMessage> {
  const current = await storage.getHangoutSession();
  if (current.sessionId !== sessionId || current.generation !== generation) {
    throw new Error("Hangout was invalidated before the screenshot could be delivered");
  }
  if (shouldEndDisconnectedHangout(current.status, current.companionLastSeen)) {
    await endDisconnectedHangout(current);
    throw new Error("Hangout companion is offline");
  }
  const correlationId = randomUUID();
  let startedAt = Date.now();
  logger.info(`[hangout] capture start sessionId=${sessionId} correlationId=${correlationId}`);
  let capture;
  try {
    capture = await waitForFreshScreenCapture({ sessionId, correlationId });
  } catch (error) {
    logBoundary("capture failure", sessionId, correlationId, startedAt);
    throw error;
  }
  if (!capture) {
    logBoundary("capture failure", sessionId, correlationId, startedAt);
    const error = "A fresh screenshot could not be captured; Ash was not shown an image.";
    await storage.failHangout(sessionId, generation, error);
    throw new Error(error);
  }
  logBoundary("capture success", sessionId, correlationId, startedAt, `activityId=${capture.activityId} imageBytes=${Math.floor(capture.imageDataUrl.length * 3 / 4)} mime=${capture.imageDataUrl.slice(5, capture.imageDataUrl.indexOf(";"))}`);
  startedAt = Date.now();
  logger.info(`[hangout] provider start sessionId=${sessionId} correlationId=${correlationId} activityId=${capture.activityId} imageBytes=${Math.floor(capture.imageDataUrl.length * 3 / 4)}`);
  let answer: string;
  try {
    answer = await ashBridge.replyToHangout(prompt, capture, correlationId, async () =>
      isFreshScreenCaptureCurrent(capture) && storage.fenceHangout(sessionId, generation, lease),
    );
  } catch (error) {
    logBoundary("provider failure", sessionId, correlationId, startedAt, `activityId=${capture.activityId}`);
    throw error;
  }
  logBoundary("provider success", sessionId, correlationId, startedAt, `activityId=${capture.activityId}`);
  if (!isFreshScreenCaptureCurrent(capture) || !(await storage.fenceHangout(sessionId, generation, lease))) {
    throw new Error("Hangout was invalidated before the screenshot could be delivered");
  }
  const processed = await ashBridge.processHangoutReply(answer);
  if (!isFreshScreenCaptureCurrent(capture) || !(await storage.fenceHangout(sessionId, generation, lease))) {
    throw new Error("Hangout was invalidated before the screenshot could be delivered");
  }
  if (!processed.trim()) throw new Error("Ash did not return a reply for the screenshot-backed exchange");
  const { message: ashMessage } = await storage.createFencedHangoutReply(
    sessionId, generation, lease, capture.activityId, correlationId, processed.trim(), capture.imageDataUrl,
  );
  await recordAshMemoryMessage("being", processed.trim(), "chat");
  await storage.touchHangoutActivity(sessionId, generation, new Date());
  return ashMessage;
}

async function completeInvite(sessionId: string, generation: number, lease: string, invitation: string): Promise<void> {
  const correlationId = randomUUID();
  const startedAt = Date.now();
  logger.info(`[hangout] provider start sessionId=${sessionId} correlationId=${correlationId} purpose=approval`);
  const result = await ashBridge.requestHangoutApproval(invitation, correlationId, () =>
    storage.fenceHangout(sessionId, generation, lease),
  );
  logBoundary("provider result", sessionId, correlationId, startedAt, "purpose=approval");
  if (!(await storage.fenceHangout(sessionId, generation, lease))) {
    throw new Error("Hangout was stopped before the approval response could be saved");
  }
  const approval = parseHangoutApproval(result);
  if (!approval) {
    const friendlyFailure = "I couldn't get a clear yes or no, so the hangout won't start. You can ask again when you're ready.";
    await storage.createFencedHangoutMessage(sessionId, generation, lease, "ash", friendlyFailure);
    await storage.setHangoutStatus(sessionId, generation, "idle", "Ash's invitation response did not contain a valid approval decision.");
    return;
  }
  const approvalReply = await ashBridge.processHangoutReply(approval.reply);
  if (!(await storage.fenceHangout(sessionId, generation, lease))) {
    throw new Error("Hangout was stopped before the approval response could be saved");
  }
  await storage.createFencedHangoutMessage(
    sessionId, generation, lease, "ash",
    approvalReply.trim() || "I couldn't provide a message with that approval.",
  );
  await recordAshMemoryMessage("being", approvalReply.trim(), "chat");
  if (approval.decision === "decline") {
    await storage.setHangoutStatus(sessionId, generation, "idle");
    return;
  }
  if (!(await storage.setHangoutStatus(sessionId, generation, "active"))) throw new Error("Hangout was stopped before approval completed");
  await captureAndReply(sessionId, generation, lease,
    `[HANGOUT OPENING]\nAsh has explicitly approved Wicked's invitation. Give her a warm, direct response while looking at the attached fresh screenshot.`);
  await storage.touchHangoutActivity(sessionId, generation);
}

export async function pairHangoutCompanion(): Promise<{ token: string }> {
  const token = randomBytes(32).toString("base64url");
  await storage.setHangoutPairing(hashToken(token));
  await cancelPendingScreenCapture();
  return { token };
}

export async function revokeHangoutCompanion(): Promise<void> {
  const current = await storage.getHangoutSession();
  await storage.setHangoutPairing("");
  if (current.sessionId) await storage.setHangoutStatus(current.sessionId, current.generation, "idle");
  await storage.invalidateUndeliveredHangoutScreenshots();
  await cancelPendingScreenCapture();
}

export async function stopHangout(): Promise<void> {
  const current = await storage.getHangoutSession();
  if (current.sessionId) await storage.stopHangoutSession(current.sessionId, current.generation);
}

export async function startHangout(): Promise<{ status: string; sessionId: string; lastError: string }> {
  const state = await storage.getState();
  const current = await storage.getHangoutSession();
  if (!current.companionTokenHash) throw new Error("Pair the Windows Hangout companion first");
  if (!isCompanionConnected(current.companionLastSeen)) {
    throw new Error("The Hangout companion must be connected before starting");
  }
  if (state.screenCaptureEnabled !== 1 || !state.screenCaptureTokenHash) throw new Error("Turn screenshot capture ON before starting a Hangout");
  if (state.apiKillSwitch === 1) throw new Error("Hangout is disabled by the API kill switch");
  const sessionId = randomUUID();
  const session = await storage.beginHangoutSession(sessionId, new Date(Date.now() - 60_000));
  if (!session) {
    const refreshed = await storage.getHangoutSession();
    if (!isCompanionConnected(refreshed.companionLastSeen)) throw new Error("The Hangout companion must be connected before starting");
    throw new Error("A Hangout session is already in progress");
  }
  const invitation = invitationForInterval(session.idleIntervalMinutes);
  await storage.createMessage({ role: "wicked", content: invitation, imageUrl: "", source: "private_message" });
  const lease = await storage.acquireHangoutLease(sessionId);
  if (!lease) {
    await storage.setHangoutStatus(sessionId, session.generation, "idle", "Could not reserve the Hangout invitation exchange");
    throw new Error("Could not reserve the Hangout invitation exchange");
  }
  try {
    await completeInvite(sessionId, session.generation, lease.token, invitation);
    return { status: (await storage.getHangoutSession()).status, sessionId, lastError: (await storage.getHangoutSession()).lastError };
  } catch (error) {
    const message = safeFailureMessage(error);
    await storage.setHangoutStatus(sessionId, session.generation, "idle", message);
    throw new Error(message);
  } finally {
    await storage.releaseHangoutLease(lease.token, session.generation);
  }
}

export async function sendHangoutMessage(content: string): Promise<{ wickedMessage: AshMessage; ashMessage: AshMessage; screenshotActivityId: number }> {
  const session = await storage.getHangoutSession();
  if (session.status !== "active") throw new Error("Hangout is not active");
  if (shouldEndDisconnectedHangout(session.status, session.companionLastSeen)) {
    await endDisconnectedHangout(session);
    throw new Error("Hangout companion is offline");
  }
  const lease = await storage.acquireHangoutLease(session.sessionId);
  if (!lease) throw new Error("A Hangout exchange is already in progress");
  try {
    await recordAshMemoryMessage("wicked", content, "chat");
    const wickedMessage = await storage.createMessage({ role: "wicked", content: content.trim(), imageUrl: "", source: "private_message" });
    await storage.touchHangoutActivity(session.sessionId, session.generation);
    const ashMessage = await captureAndReply(session.sessionId, session.generation, lease.token, content.trim());
    const screenshotActivityId = await storage.getHangoutScreenshotActivityForMessage(ashMessage.id, session.sessionId);
    if (screenshotActivityId == null) throw new Error("Hangout screenshot mapping could not be persisted");
    return { wickedMessage, ashMessage, screenshotActivityId };
  } catch (error) {
    const message = safeFailureMessage(error);
    await storage.failHangout(session.sessionId, session.generation, message);
    throw new Error(message);
  } finally {
    await storage.releaseHangoutLease(lease.token, lease.generation);
  }
}

export async function sendPrivateMessage(content: string, imageDataUrl?: string, requestImage = false): Promise<{ wickedMessage: AshMessage; ashMessage: AshMessage | null }> {
  let session = await storage.getHangoutSession();
  if (shouldEndDisconnectedHangout(session.status, session.companionLastSeen)) {
    await endDisconnectedHangout(session);
    session = await storage.getHangoutSession();
  }
  const mode = privateMessageHangoutMode(session.status);
  if (mode === "inviting") throw new Error("Hangout invitation is still awaiting a clear approval decision.");
  if (mode === "active") {
    if (imageDataUrl || requestImage) throw new Error("Hangout messages use the paired desktop screenshot automatically; image attachments and image requests are unavailable.");
    return sendHangoutMessage(content);
  }
  const wickedMessage = await storage.createMessage({ role: "wicked", content: content.trim(), imageUrl: imageDataUrl || "", source: "private_message" });
  const { text, imageUrl } = await ashBridge.handleWickedMessage(content.trim() || "(Wicked sent you a picture — look at it and respond.)", imageDataUrl, requestImage);
  const ashMessage = text.trim() || imageUrl
    ? await storage.createMessage({ role: "ash", content: text.trim(), imageUrl, source: "private_message" })
    : null;
  if (ashMessage?.content.trim()) await recordAshMemoryMessage("being", ashMessage.content, "chat");
  return { wickedMessage, ashMessage };
}

export async function syncHangoutCompanion(token: string, after: number, windowStart = false): Promise<{
  status: "idle" | "inviting" | "active";
  sessionId: string;
  messages: Array<{ id: number; role: string; content: string; createdAt: string; screenshotActivityId: number | null }>;
  lastError: string;
  idleIntervalMinutes: number;
  windowCursor?: number;
}> {
  const session = await storage.getHangoutSession();
  if (!tokenMatches(token, session.companionTokenHash)) throw new Error("Invalid Hangout companion token");
  const digest = hashToken(token);
  if (!(await storage.heartbeatHangout(digest))) throw new Error("Invalid Hangout companion token");
  // A new desktop chat window begins after the current transcript. Keep the
  // canonical messages on the server without replaying them in that window.
  const windowCursor = windowStart ? await storage.getHangoutLatestMessageId() : undefined;
  const data = windowStart ? [] : await storage.getHangoutMessages(after, digest);
  const latest = await storage.getHangoutSession();
  return {
    status: latest.status as "idle" | "inviting" | "active",
    sessionId: latest.sessionId,
    messages: data.map((message) => ({
      id: message.id, role: message.role, content: message.content,
      createdAt: message.createdAt.toISOString(),
      screenshotActivityId: message.screenshotActivityId,
    })),
    lastError: latest.lastError,
    idleIntervalMinutes: latest.idleIntervalMinutes,
    ...(windowStart ? { windowCursor } : {}),
  };
}

export async function setHangoutIdleInterval(token: string, minutes: number): Promise<number> {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error("Minutes must be a whole number from 1 to 1440");
  }
  const updated = await storage.setHangoutIdleInterval(hashToken(token), minutes);
  if (updated === null) throw new Error("Invalid Hangout companion token");
  logger.info(`[hangout] idle interval updated minutes=${updated}`);
  return updated;
}

async function maybeIdleCheckin(session: Awaited<ReturnType<typeof storage.getHangoutSession>>): Promise<void> {
  const minutes = session.idleIntervalMinutes;
  const intervalMs = minutes * 60_000;
  if (session.status !== "active" || !session.lastActivityAt || Date.now() - session.lastActivityAt.getTime() < intervalMs) return;
  if (session.lastIdleCheckinAt && Date.now() - session.lastIdleCheckinAt.getTime() < intervalMs) return;
  const lease = await storage.acquireHangoutLease(session.sessionId, true);
  if (!lease) return;
  try {
    await captureAndReply(session.sessionId, session.generation, lease.token,
      `It has been at least ${minutes} minute${minutes === 1 ? "" : "s"} since Wicked's last message. Send a gentle screenshot-backed check-in, concise and natural.`);
  } catch (error) {
    await storage.failHangout(session.sessionId, session.generation, safeFailureMessage(error));
  } finally {
    await storage.releaseHangoutLease(lease.token, lease.generation);
  }
}

export function startHangoutIdleScheduler(): void {
  if (idleScheduler) return;
  const tick = async () => {
    try {
      // Also clean up completed-but-unconsumed captures when a process dies
      // between staging and publication and no companion is currently polling.
      await storage.getCaptureRequest();
      await maybeIdleCheckin(await storage.getHangoutSession());
    } catch {
      // Status remains visible through the session error field when an
      // exchange was claimed; scheduler/database failures are intentionally
      // transcript-free.
    }
  };
  void tick();
  idleScheduler = setInterval(() => { void tick(); }, 60_000);
  idleScheduler.unref?.();
}

export async function authorizeHangoutCompanion(token: string): Promise<boolean> {
  const session = await storage.getHangoutSession();
  return tokenMatches(token, session.companionTokenHash);
}

export async function hangoutStatus(): Promise<{ status: string; sessionId: string; connected: boolean; companionPaired: boolean; lastError: string; lastCaptureAt: string | null }> {
  const [session, state] = await Promise.all([storage.getHangoutSession(), storage.getState()]);
  const paired = !!session.companionTokenHash;
  return {
    status: session.status, sessionId: session.sessionId,
    connected: isCompanionConnected(session.companionLastSeen, Date.now()),
    companionPaired: paired && !!state.screenCaptureTokenHash,
    lastError: session.lastError || (session.status !== "idle" ? state.screenCaptureLastError : ""),
    lastCaptureAt: session.lastCaptureAt?.toISOString() ?? null,
  };
}

export async function getHangoutScreenshot(activityId: number, token: string): Promise<{ imageDataUrl: string; sessionId: string; correlationId: string } | null> {
  const session = await storage.getHangoutSession();
  if (!tokenMatches(token, session.companionTokenHash)) return null;
  return storage.getHangoutScreenshot(activityId, hashToken(token));
}

export async function invalidateHangoutForControl(): Promise<void> {
  const session = await storage.getHangoutSession();
  if (session.status !== "idle" && session.sessionId) await storage.setHangoutStatus(session.sessionId, session.generation, "idle");
  await storage.invalidateUndeliveredHangoutScreenshots();
  await cancelPendingScreenCapture();
}