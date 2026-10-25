export type KingsFingersCommand =
  | { kind: "VIBRATE" | "FINGER"; intensity: number; seconds: number }
  | { kind: "STOP" };

export function stripKingsFingersCommand(reply: string): {
  text: string; command: KingsFingersCommand | null; error: string | null; detected: boolean;
} {
  const lines: string[] = [];
  const text = reply.replace(/^[ \t]*\[KINGS_FINGERS:[^\r\n]*\][ \t]*\r?$/gim, (line) => {
    lines.push(line.trim());
    return "";
  }).replace(/\n{3,}/g, "\n\n").trim();
  const rejected = (error: string) => ({ text, command: null, error, detected: true });
  if (!lines.length) return { text: reply, command: null, error: null, detected: false };
  if (lines.length !== 1) return rejected("Only one KING'S FINGERS command may be used per response");
  if (lines[0] === "[KINGS_FINGERS: STOP]") {
    return { text, command: { kind: "STOP" }, error: null, detected: true };
  }
  const match = lines[0].match(/^\[KINGS_FINGERS: (VIBRATE|FINGER) ([1-9]\d*) ([1-9]\d*)\]$/);
  if (!match) return rejected("Invalid KING'S FINGERS command");
  const intensity = Number(match[2]);
  const seconds = Number(match[3]);
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 20 ||
      !Number.isInteger(seconds) || seconds < 2 || seconds > 30) {
    return rejected("KING'S FINGERS intensity must be 1–20 and duration 2–30 seconds");
  }
  return { text, command: { kind: match[1] as "VIBRATE" | "FINGER", intensity, seconds }, error: null, detected: true };
}
