import {
  isRecallEnabled,
  pendingCount,
  recallForPrompt,
  recordMessage,
  reviewLog,
  runBeingReview,
} from "./vector-memory-runtime.mjs";
import { logger } from "../logger";

let ready = false;
let reviewRunning = false;
let lastReviewAttempt = 0;
const REVIEW_INTERVAL_MS = 12 * 60 * 60 * 1000;

export function setVectorMemoryReady(value: boolean): void {
  ready = value;
}

export async function recordAshMemoryMessage(
  role: "wicked" | "being" | string,
  text: string,
  source: "chat" | "discord" | string,
): Promise<void> {
  if (!ready || !text.trim()) return;
  try {
    await recordMessage("ash", role, text, source);
  } catch (error) {
    logger.warn({ err: error, source }, "Vector Memory message recording failed");
  }
}

export async function getAshMemoryRecall(context: string): Promise<string> {
  if (!ready || !context.trim()) return "";
  try {
    return (await recallForPrompt("ash", context)).block;
  } catch (error) {
    logger.warn({ err: error }, "Vector Memory recall failed");
    return "";
  }
}

export async function getAshRecallEnabled(): Promise<boolean | null> {
  if (!ready) return null;
  try {
    return await isRecallEnabled("ash");
  } catch (error) {
    logger.warn({ err: error }, "Vector Memory recall status check failed");
    return null;
  }
}

export async function reviewAshMemories(
  askBeing: (prompt: string) => Promise<string>,
): Promise<void> {
  if (!ready || reviewRunning) return;
  reviewRunning = true;
  try {
    const pending = await pendingCount("ash");
    if (pending <= 0) return;
    const [latest] = await reviewLog("ash", 1);
    const lastReviewed = latest?.reviewed_at
      ? new Date(latest.reviewed_at).getTime()
      : 0;
    const lastAttempt = Math.max(lastReviewed, lastReviewAttempt);
    if (Date.now() - lastAttempt < REVIEW_INTERVAL_MS) return;
    lastReviewAttempt = Date.now();
    await runBeingReview("ash", askBeing);
  } catch (error) {
    logger.warn({ err: error }, "Vector Memory review failed");
  } finally {
    reviewRunning = false;
  }
}
