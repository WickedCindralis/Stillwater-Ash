import type { AshMessage } from "@workspace/db";

const EASTERN_TIME_ZONE = "America/New_York";

type PrivateHistoryMessage = Pick<AshMessage, "role" | "content" | "createdAt">;

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: EASTERN_TIME_ZONE,
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: EASTERN_TIME_ZONE,
  });
}

export function formatPrivateHistory(
  history: readonly PrivateHistoryMessage[],
  ashName: string,
): string {
  const relevant = history.filter((message) => message.content && message.content.trim().length > 0);
  if (relevant.length === 0) return "";

  const recentWickedIndices = new Set<number>();
  relevant
    .map((message, index) => (message.role === "wicked" ? index : -1))
    .filter((index) => index >= 0)
    .slice(-4)
    .forEach((index) => recentWickedIndices.add(index));

  let previousDate = "";
  return relevant.map((message, index) => {
    const date = new Date(message.createdAt);
    const dateLabel = formatDate(date);
    const dateHeader = dateLabel !== previousDate ? `Date: ${dateLabel}\n` : "";
    previousDate = dateLabel;

    const speaker = message.role === "wicked" ? "[Wicked]" : `[${ashName}]`;
    const timeStamp = recentWickedIndices.has(index)
      ? ` (sent ${formatTime(date)} Eastern)`
      : "";
    return `${dateHeader}${speaker} ${message.content}${timeStamp}`;
  }).join("\n");
}