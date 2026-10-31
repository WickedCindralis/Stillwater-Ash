import {
  isRecallEnabled,
  recallForPrompt,
  recordMessage,
} from "./vector-memory-runtime.mjs";
import { logger } from "../logger";

let ready = false;
let manualReviewRunning = false;
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

export async function getPendingAshMemoryCount(): Promise<number> {
  if (!ready) return 0;
  try {
    return await (await import("./vector-memory-runtime.mjs")).pendingCount("ash");
  } catch (error) {
    logger.warn({ err: error }, "Vector Memory pending-count lookup failed");
    return 0;
  }
}

export async function runAshMemoryReview(askBeing: (prompt: string) => Promise<string>): Promise<any> {
  if (!ready) throw new Error("Vector Memory is not ready");
  if (manualReviewRunning) return;
  manualReviewRunning = true;
  try {
    return await (await import("./vector-memory-runtime.mjs")).runBeingReview("ash", askBeing, 10);
  } finally {
    manualReviewRunning = false;
  }
}
