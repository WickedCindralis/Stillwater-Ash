type ProviderComment = Record<string, unknown>;

function record(value: unknown): ProviderComment | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ProviderComment
    : null;
}

function stringAt(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function mentionText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    const part = record(item);
    if (!part) return "";
    const user = stringAt(part["user_name"] ?? part["at_user_name"] ?? part["unique_id"]);
    if (user) return `@${user.replace(/^@/, "")}`;
    const hashtag = stringAt(part["hashtag_name"]);
    if (hashtag) return `#${hashtag.replace(/^#/, "")}`;
    return stringAt(part["text"]);
  }).filter(Boolean).join(" ");
}

function shareCommentText(value: unknown): string {
  const info = record(value);
  const description = stringAt(info?.["desc"]);
  const match = description.match(/(?:'|’)s comment:\s*([\s\S]*)$/i);
  return match?.[1]?.trim() ?? "";
}

export function extractHeraldCommentText(raw: ProviderComment): { text: string; source: string } | null {
  const comment = record(raw["comment"]);
  const reply = record(raw["reply"]);
  const candidates: Array<[string, string]> = [
    ["text", stringAt(raw["text"])],
    ["comment_text", stringAt(raw["comment_text"])],
    ["commentText", stringAt(raw["commentText"])],
    ["content", stringAt(raw["content"])],
    ["desc", stringAt(raw["desc"])],
    ["comment.text", stringAt(comment?.["text"])],
    ["reply.text", stringAt(reply?.["text"])],
    ["share_info.desc", shareCommentText(raw["share_info"])],
    ["text_extra", mentionText(raw["text_extra"])],
    ["comment.text_extra", mentionText(comment?.["text_extra"])],
    ["reply.text_extra", mentionText(reply?.["text_extra"])],
  ];
  const selected = candidates.find(([, value]) => value.trim().length > 0);
  return selected ? { text: selected[1].trim(), source: selected[0] } : null;
}

const TEXT_FIELD_PATHS = [
  "text", "comment_text", "commentText", "content", "desc",
  "comment.text", "reply.text", "share_info.desc", "text_extra",
  "comment.text_extra", "reply.text_extra",
  "reply_comment", "reply_comment.text", "reply_comment.text_extra",
] as const;

export function summarizeHeraldTextFields(raw: ProviderComment, maxValueLength = 120): string {
  const comment = record(raw["comment"]);
  const reply = record(raw["reply"]);
  const replyComment = record(raw["reply_comment"]);
  const shareInfo = record(raw["share_info"]);
  const values: Record<string, unknown> = {
    text: raw["text"],
    comment_text: raw["comment_text"],
    commentText: raw["commentText"],
    content: raw["content"],
    desc: raw["desc"],
    "comment.text": comment?.["text"],
    "reply.text": reply?.["text"],
    "share_info.desc": shareInfo?.["desc"],
    text_extra: raw["text_extra"],
    "comment.text_extra": comment?.["text_extra"],
    "reply.text_extra": reply?.["text_extra"],
    reply_comment: raw["reply_comment"],
    "reply_comment.text": replyComment?.["text"],
    "reply_comment.text_extra": replyComment?.["text_extra"],
  };
  const present = TEXT_FIELD_PATHS.flatMap((path) => {
    const value = values[path];
    if (value === undefined || value === null) return [];
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    const short = (serialized || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxValueLength);
    return [`${path}=${JSON.stringify(short)}${serialized && serialized.length > maxValueLength ? "…" : ""}`];
  });
  return present.join("; ") || "(none)";
}

export function formatHeraldTimestamp(value: unknown): string {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : value.trim().slice(0, 80);
  }
  return "unknown";
}

export function sanitizeHeraldLogValue(value: unknown, maxLength = 120): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength) || "(blank)";
}
