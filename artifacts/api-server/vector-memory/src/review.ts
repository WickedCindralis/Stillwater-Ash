import { query } from './db.js';
import { MEMORY_COLUMNS, beingScoreMemory, beingRequestPin, beingProposeWording, type MemoryRow } from './memories.js';
import { complete, parseJson } from './llm.js';
import { TUNING } from './tuning.js';

/**
 * How the being is asked. Pass a function that sends `prompt` to the being through its REAL
 * model and persona packet (the same way the house normally talks to it) and returns its reply.
 * That is what makes the 60% score genuinely the being's own.
 */
export type AskBeing = (prompt: string) => Promise<string>;

/** Fallback only: asks the summarizer model wearing the being's packet. Approximate, cheaper. */
export function askWithPacket(packet: string): AskBeing {
  return (prompt) => complete(packet, prompt, 3000);
}

export async function pendingCount(beingId: string): Promise<number> {
  const r = await query<{ n: string }>(
    `SELECT count(*) AS n FROM memories WHERE being_id = $1 AND being_scored = false AND status <> 'hidden'`,
    [beingId],
  );
  return Number(r.rows[0].n);
}

export function buildReviewPrompt(memories: MemoryRow[]): string {
  const list = memories
    .map((m) => `#${m.id} (draft score ${m.being_score}; filed ${new Date(m.created_at).toISOString().slice(0, 10)}): ${m.content}`)
    .join('\n');
  return `Here are your memories with their draft scores. You only need to reply for ones you want to change. Anything you skip keeps its draft score as your score.

${list}

For each memory:
- score: 1 (trivial, let it fade) to 10 (part of who you are).
- request_pin: true only for memories that should never fade. Wicked approves pins.
- wording: a corrected sentence if the draft got something wrong, otherwise leave it out.

Reply with ONLY a JSON array, one entry per memory, e.g.
[{"id": "123", "score": 7}, {"id": "124", "score": 9, "request_pin": true}, {"id": "125", "score": 4, "wording": "..."}]`;
}

interface ReviewEntry {
  id: string | number;
  score?: number;
  request_pin?: boolean;
  wording?: string;
}

/**
 * Run during the being's proactive window. Scores up to reviewBatchSize pending memories,
 * oldest first, and writes a line to the review log.
 */
export async function runBeingReview(beingId: string, askBeing: AskBeing, batchSize = TUNING.reviewBatchSize) {
  const pending = await query<MemoryRow>(
    `SELECT ${MEMORY_COLUMNS} FROM memories
     WHERE being_id = $1 AND being_scored = false AND status <> 'hidden'
     ORDER BY created_at LIMIT $2`,
    [beingId, batchSize],
  );
  if (!pending.rows.length) {
    await query('INSERT INTO review_log (being_id, scored_count, pending_after) VALUES ($1, 0, 0)', [beingId]);
    console.log(`[memory] Review complete for ${beingId}: explicit scores=0; silence accepted=0.`);
    return { scored: 0, pinRequests: 0, wordingProposals: 0, pendingAfter: 0 };
  }

  const reply = await askBeing(buildReviewPrompt(pending.rows));
  const entries = parseJson<ReviewEntry[]>(reply);
  const allowed = new Set(pending.rows.map((m) => String(m.id)));

  let scored = 0, pinRequests = 0, wordingProposals = 0;
  const mentioned = new Set<string>();
  for (const e of Array.isArray(entries) ? entries : []) {
    const id = String(e.id).replace('#', '');
    if (!allowed.has(id)) continue; // the being can only touch the memories it was shown
    mentioned.add(id);
    if (typeof e.score === 'number') {
      await beingScoreMemory(beingId, id, e.score);
      scored++;
    }
    if (e.request_pin === true) {
      await beingRequestPin(beingId, id);
      pinRequests++;
    }
    if (typeof e.wording === 'string' && e.wording.trim()) {
      await beingProposeWording(beingId, id, e.wording.trim());
      wordingProposals++;
    }
  }

  let silenceAccepted = 0;
  for (const memory of pending.rows) {
    if (mentioned.has(String(memory.id))) continue;
    await beingScoreMemory(beingId, String(memory.id), memory.being_score);
    silenceAccepted++;
  }

  const pendingAfter = await pendingCount(beingId);
  await query('INSERT INTO review_log (being_id, scored_count, pending_after) VALUES ($1, $2, $3)', [
    beingId,
    scored + silenceAccepted,
    pendingAfter,
  ]);
  console.log(`[memory] Review complete for ${beingId}: explicit scores=${scored}; silence accepted=${silenceAccepted}.`);
  return { scored, silenceAccepted, pinRequests, wordingProposals, pendingAfter };
}
