import { query } from './db.js';
import { TUNING } from './tuning.js';

export type Level = 'ok' | 'amber' | 'red';

function level(value: number, warnAt: number): Level {
  if (value >= warnAt * 2) return 'red';
  if (value >= warnAt) return 'amber';
  return 'ok';
}

const DAY_MS = 86_400_000;

/** One row per being for the dashboard. */
export async function beingHealth() {
  const r = await query(
    `SELECT b.being_id, b.recall_enabled, b.decay_lambda,
       (SELECT count(*) FROM memories m WHERE m.being_id = b.being_id AND m.status <> 'hidden') AS total,
       (SELECT count(*) FROM memories m WHERE m.being_id = b.being_id AND m.status = 'pinned') AS pinned,
       (SELECT count(*) FROM memories m WHERE m.being_id = b.being_id AND m.being_scored = false AND m.status <> 'hidden') AS pending,
       (SELECT min(created_at) FROM memories m WHERE m.being_id = b.being_id AND m.being_scored = false AND m.status <> 'hidden') AS oldest_pending,
       (SELECT count(*) FROM memories m WHERE m.being_id = b.being_id AND m.user_scored = false AND m.status <> 'hidden') AS unrated,
       (SELECT count(*) FROM memories m WHERE m.being_id = b.being_id AND m.pin_requested AND m.status = 'active') AS pin_requests,
       (SELECT count(*) FROM memories m WHERE m.being_id = b.being_id AND m.proposed_content IS NOT NULL AND m.status <> 'hidden') AS wording_proposals,
       (SELECT count(*) FROM memory_conflicts c WHERE c.being_id = b.being_id AND NOT c.resolved) AS conflicts,
       (SELECT max(reviewed_at) FROM review_log l WHERE l.being_id = b.being_id) AS last_review,
       (SELECT count(*) FROM capture_buffer q WHERE q.being_id = b.being_id AND NOT q.captured) AS uncaptured_messages
     FROM being_settings b ORDER BY b.being_id`,
  );
  const now = Date.now();
  return r.rows.map((row) => {
    const pending = Number(row.pending);
    const oldestDays = row.oldest_pending ? (now - new Date(row.oldest_pending).getTime()) / DAY_MS : 0;
    const lastReviewDays = row.last_review ? (now - new Date(row.last_review).getTime()) / DAY_MS : Infinity;
    const levels = [
      level(pending, TUNING.warnPending),
      level(oldestDays, TUNING.warnOldestPendingDays),
      pending > 0 ? level(lastReviewDays, TUNING.warnLastReviewDays) : 'ok',
    ] as Level[];
    const overall: Level = levels.includes('red') ? 'red' : levels.includes('amber') ? 'amber' : 'ok';
    return {
      beingId: row.being_id as string,
      recallEnabled: row.recall_enabled as boolean,
      decayLambda: Number(row.decay_lambda),
      total: Number(row.total),
      pinned: Number(row.pinned),
      pending,
      oldestPendingDays: Math.round(oldestDays * 10) / 10,
      lastReview: row.last_review as string | null,
      unrated: Number(row.unrated),
      pinRequests: Number(row.pin_requests),
      wordingProposals: Number(row.wording_proposals),
      conflicts: Number(row.conflicts),
      uncapturedMessages: Number(row.uncaptured_messages),
      level: overall,
    };
  });
}

export async function reviewLog(beingId: string, limit = 30) {
  const r = await query('SELECT * FROM review_log WHERE being_id = $1 ORDER BY reviewed_at DESC LIMIT $2', [beingId, limit]);
  return r.rows;
}

export async function setLambda(beingId: string, lambda: number) {
  await query(
    `INSERT INTO being_settings (being_id, decay_lambda) VALUES ($1, $2)
     ON CONFLICT (being_id) DO UPDATE SET decay_lambda = EXCLUDED.decay_lambda`,
    [beingId, lambda],
  );
}
