import type { IRouter } from "express";

export function getConfig(): { adminToken: string };
export function initMemory(opts?: {
  startBackgroundJobs?: boolean;
  onCaptureEvent?: (kind: string, message: string) => Promise<void>;
}): Promise<void>;
export function isRecallEnabled(beingId: string): Promise<boolean>;
export function memoryRouter(): IRouter;
export function pendingCount(beingId: string): Promise<number>;
export function recallForPrompt(beingId: string, context: string): Promise<{ recallEnabled: boolean; block: string }>;
export function recordMessage(beingId: string, role: string, content: string, source: string): Promise<void>;
export function reviewLog(beingId: string, limit?: number): Promise<Array<{ reviewed_at: string | Date }>>;
export function runBeingReview(beingId: string, askBeing: (prompt: string) => Promise<string>, batchSize?: number): Promise<unknown>;
