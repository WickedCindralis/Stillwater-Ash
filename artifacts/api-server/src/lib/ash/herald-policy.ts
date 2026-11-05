export type HeraldCommentSkipReason = "missing-id" | "missing-text" | "duplicate";

export const HERALD_INITIAL_DELAY_MS = 5 * 60_000;
export const HERALD_INTERVAL_MS = 3 * 60 * 60_000;

export function isHeraldScheduleEnabled(
  flag: string | undefined,
  nodeEnv: string | undefined,
  deployment: string | undefined,
): boolean {
  return flag === "true" && (nodeEnv === "production" || deployment === "1");
}

export function getHeraldCommentSkipReason(
  commentId: string,
  text: string,
  seenIds: ReadonlySet<string>,
): HeraldCommentSkipReason | null {
  if (!commentId) return "missing-id";
  if (!text.trim()) return "missing-text";
  if (seenIds.has(commentId)) return "duplicate";
  return null;
}

export function getCommentPageStopReason(input: {
  hasStoredComment: boolean;
  hasMore: boolean;
  cursor: string | number | null | undefined;
  pageNumber: number;
  maxPages: number;
}): "stored-comment" | "no-more-pages" | "page-cap" | null {
  if (!input.hasMore || input.cursor == null || String(input.cursor) === "") return "no-more-pages";
  if (input.pageNumber >= input.maxPages) return "page-cap";
  return null;
}

export type HeraldSweepHistoryItem = { message: string; createdAt: Date | string };

export function deriveHeraldAlertMessages(
  history: readonly HeraldSweepHistoryItem[],
  now: Date,
): string[] {
  const outcomes = history
    .filter((item) => item.message.startsWith("Herald sweep complete") || item.message.startsWith("Herald sweep failed"))
    .map((item) => ({ ...item, time: new Date(item.createdAt).getTime() }))
    .filter((item) => Number.isFinite(item.time))
    .sort((a, b) => b.time - a.time);
  const alerts: string[] = [];
  if (outcomes.slice(0, 3).length === 3 && outcomes.slice(0, 3).every((item) => item.message.startsWith("Herald sweep failed"))) {
    alerts.push("Herald failing — the last 3 recorded sweeps failed.");
  }
  const cutoff = now.getTime() - 24 * 60 * 60_000;
  const hasRecentSuccess = history.some((item) =>
    item.message.startsWith("Herald sweep complete") &&
    new Date(item.createdAt).getTime() >= cutoff &&
    new Date(item.createdAt).getTime() <= now.getTime(),
  );
  if (!hasRecentSuccess) {
    alerts.push("Herald quiet — no successful sweep in the last 24 hours.");
  }
  return alerts;
}
