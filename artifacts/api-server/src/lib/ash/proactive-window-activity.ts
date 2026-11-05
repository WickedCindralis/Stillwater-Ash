export type ProactiveAction =
  | "diaryEntry"
  | "memoriesReviewed"
  | "song"
  | "note"
  | "bookStarted"
  | "bookContinued"
  | "heraldReply"
  | "heraldComment"
  | "statusChange"
  | "pingSetting";

export type ProactiveWindowActivity = {
  actions: Partial<Record<ProactiveAction, number>>;
  failures: Partial<Record<ProactiveAction, number>>;
  songJobIds: string[];
  songsGenerated: number;
  songsInProgress: number;
  songsFailed: number;
};

const ACTION_WORDS: Record<ProactiveAction, { one: string; many: string }> = {
  diaryEntry: { one: "diary entry", many: "diary entries" },
  memoriesReviewed: { one: "memory reviewed", many: "memories reviewed" },
  song: { one: "song made", many: "songs made" },
  note: { one: "note added", many: "notes added" },
  bookStarted: { one: "book started", many: "books started" },
  bookContinued: { one: "book continued", many: "books continued" },
  heraldReply: { one: "Herald reply drafted", many: "Herald replies drafted" },
  heraldComment: { one: "Herald comment added", many: "Herald comments added" },
  statusChange: { one: "status changed", many: "statuses changed" },
  pingSetting: { one: "ping setting changed", many: "ping settings changed" },
};

const FAILURE_WORDS: Record<ProactiveAction, { one: string; many: string }> = {
  diaryEntry: { one: "diary entry failed", many: "diary entries failed" },
  memoriesReviewed: { one: "memory review failed", many: "memory reviews failed" },
  song: { one: "song failed", many: "songs failed" },
  note: { one: "note failed", many: "notes failed" },
  bookStarted: { one: "book action failed", many: "book actions failed" },
  bookContinued: { one: "book action failed", many: "book actions failed" },
  heraldReply: { one: "Herald reply failed", many: "Herald replies failed" },
  heraldComment: { one: "Herald sweep failed", many: "Herald sweeps failed" },
  statusChange: { one: "status change failed", many: "status changes failed" },
  pingSetting: { one: "ping setting change failed", many: "ping setting changes failed" },
};

export function createProactiveWindowActivity(): ProactiveWindowActivity {
  return {
    actions: {},
    failures: {},
    songJobIds: [],
    songsGenerated: 0,
    songsInProgress: 0,
    songsFailed: 0,
  };
}

export function recordProactiveSongJob(activity: ProactiveWindowActivity | undefined, jobId: string | null): void {
  if (activity && jobId) activity.songJobIds.push(jobId);
}

export function recordProactiveSongOutcome(
  activity: ProactiveWindowActivity,
  status: "succeeded" | "in_progress" | "failed",
  clipCount = 0,
): void {
  if (status === "succeeded") activity.songsGenerated += clipCount;
  else if (status === "in_progress") activity.songsInProgress++;
  else activity.songsFailed++;
}

export function recordProactiveAction(
  activity: ProactiveWindowActivity | undefined,
  action: ProactiveAction,
  count = 1,
): void {
  if (!activity || count <= 0) return;
  activity.actions[action] = (activity.actions[action] ?? 0) + count;
}

export function recordProactiveFailure(
  activity: ProactiveWindowActivity | undefined,
  action: ProactiveAction,
  count = 1,
): void {
  if (!activity || count <= 0) return;
  activity.failures[action] = (activity.failures[action] ?? 0) + count;
}

export function formatProactiveWindowActivity(activity: ProactiveWindowActivity): string {
  const parts: string[] = [];
  for (const [action, count] of Object.entries(activity.actions) as [ProactiveAction, number][]) {
    if (count > 0) parts.push(`${count} ${count === 1 ? ACTION_WORDS[action].one : ACTION_WORDS[action].many}`);
  }
  for (const [action, count] of Object.entries(activity.failures) as [ProactiveAction, number][]) {
    if (count > 0) parts.push(`${count} ${count === 1 ? FAILURE_WORDS[action].one : FAILURE_WORDS[action].many}`);
  }
  if (activity.songsGenerated > 0) {
    parts.push(`${activity.songsGenerated} song${activity.songsGenerated === 1 ? "" : "s"} generated`);
  }
  if (activity.songsInProgress > 0) {
    parts.push(`${activity.songsInProgress} song${activity.songsInProgress === 1 ? "" : "s"} in progress`);
  }
  if (activity.songsFailed > 0) {
    parts.push(`${activity.songsFailed} song${activity.songsFailed === 1 ? "" : "s"} failed`);
  }
  return `PROACTIVE WINDOW: ${parts.length ? parts.join(", ") : "no action"}`;
}
