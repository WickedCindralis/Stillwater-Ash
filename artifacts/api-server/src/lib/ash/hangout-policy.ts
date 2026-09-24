export type HangoutApproval = { decision: "approve" | "decline"; reply: string };

export function isCompanionConnected(lastSeen: Date | null, now = Date.now()): boolean {
  return !!lastSeen && now - lastSeen.getTime() < 60_000;
}

export function privateMessageHangoutMode(status: string): "active" | "inviting" | "idle" {
  return status === "active" ? "active" : status === "inviting" ? "inviting" : "idle";
}

export function parseHangoutApproval(value: string): HangoutApproval | null {
  try {
    const parsed = JSON.parse(value) as { decision?: unknown; reply?: unknown };
    if (
      (parsed.decision === "approve" || parsed.decision === "decline") &&
      typeof parsed.reply === "string" &&
      parsed.reply.trim()
    ) return { decision: parsed.decision, reply: parsed.reply.trim() };
  } catch {
    // Free-form text is never evidence of approval.
  }
  return null;
}