import type pg from 'pg';
import { query, withTransaction, ensureBeing, toVector } from './db.js';
import { embed } from './voyage.js';
import { complete, parseJson } from './llm.js';
import { scoreMemory, type MemoryStatus, type ScoreBreakdown } from './scoring.js';
import { TUNING } from './tuning.js';

export interface MemoryRow {
  id: string;
  being_id: string;
  content: string;
  entities: string[];
  source: string | null;
  being_score: number;
  being_scored: boolean;
  user_score: number;
  user_scored: boolean;
  status: MemoryStatus;
  pin_requested: boolean;
  proposed_content: string | null;
  use_count: number;
  last_used_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface MemoryView extends MemoryRow {
  score: ScoreBreakdown;
}

// Everything except the embedding and search_text, which the dashboard never needs.
export const MEMORY_COLUMNS = `id, being_id, content, entities, source, being_score, being_scored, user_score,
  user_scored, status, pin_requested, proposed_content, use_count, last_used_at, created_at, updated_at`;

export async function getLambda(beingId: string): Promise<number> {
  const r = await query<{ decay_lambda: number }>('SELECT decay_lambda FROM being_settings WHERE being_id = $1', [beingId]);
  return r.rows[0]?.decay_lambda ?? TUNING.defaultLambda;
}

export function withScore(row: MemoryRow, lambda: number): MemoryView {
  return {
    ...row,
    score: scoreMemory({
      beingScore: row.being_score,
      userScore: row.user_score,
      status: row.status,
      useCount: row.use_count,
      lastUsedAt: new Date(row.last_used_at),
      createdAt: new Date(row.created_at),
      lambda,
    }),
  };
}

const clampScore = (n: number) => Math.min(10, Math.max(1, Math.round(n)));

/** Names, places, dates and key nouns, used for exact-match search. */
export async function extractEntities(content: string): Promise<string[]> {
  const reply = await complete(
    'You extract search keys from a single memory. Reply with only a JSON array of short strings: ' +
      'people, places, dates, named things, and the key nouns someone would search for. No commentary.',
    content,
    300,
  );
  try {
    const arr = parseJson<unknown[]>(reply);
    return arr.filter((x): x is string => typeof x === 'string').slice(0, 15);
  } catch {
    return [];
  }
}

export interface NewMemory {
  beingId: string;
  content: string;
  beingScore: number;
  beingScored?: boolean;
  entities?: string[];
  source?: string;
  userScore?: number;
}

export async function addMemory(m: NewMemory): Promise<MemoryRow> {
  await ensureBeing(m.beingId);
  const [vector] = await embed([m.content], 'document');
  const entities = m.entities ?? (await extractEntities(m.content));
  const hasUserScore = typeof m.userScore === 'number';
  const r = await query<MemoryRow>(
    `INSERT INTO memories (being_id, content, embedding, entities, source, being_score, being_scored, user_score, user_scored)
     VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8, $9)
     RETURNING ${MEMORY_COLUMNS}`,
    [
      m.beingId,
      m.content,
      toVector(vector),
      entities,
      m.source ?? 'manual',
      clampScore(m.beingScore),
      m.beingScored ?? false,
      hasUserScore ? clampScore(m.userScore!) : TUNING.defaultUserScore,
      hasUserScore,
    ],
  );
  return r.rows[0];
}

async function lockRow(client: pg.PoolClient, id: string, beingId?: string): Promise<MemoryRow> {
  const r = await client.query<MemoryRow>(
    `SELECT ${MEMORY_COLUMNS} FROM memories WHERE id = $1 ${beingId ? 'AND being_id = $2' : ''} FOR UPDATE`,
    beingId ? [id, beingId] : [id],
  );
  if (!r.rows[0]) throw new Error(`[memory] Memory ${id} not found${beingId ? ` for ${beingId}` : ''}.`);
  return r.rows[0];
}

async function writeRevision(client: pg.PoolClient, row: MemoryRow, editedBy: string, note: string) {
  await client.query(
    `INSERT INTO memory_revisions (memory_id, old_content, old_scores, old_status, note, edited_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      row.id,
      row.content,
      JSON.stringify({
        being_score: row.being_score,
        being_scored: row.being_scored,
        user_score: row.user_score,
        user_scored: row.user_scored,
      }),
      row.status,
      note,
      editedBy,
    ],
  );
}

/** Wicked edits a memory: old version goes to history, new text is re-embedded. */
export async function editMemory(id: string, newContent: string, editedBy = 'wicked'): Promise<MemoryRow> {
  const [vector] = await embed([newContent], 'document');
  const entities = await extractEntities(newContent);
  return withTransaction(async (c) => {
    const row = await lockRow(c, id);
    await writeRevision(c, row, editedBy, 'content edited');
    const r = await c.query<MemoryRow>(
      `UPDATE memories SET content = $2, embedding = $3::vector, entities = $4, proposed_content = NULL, updated_at = now()
       WHERE id = $1 RETURNING ${MEMORY_COLUMNS}`,
      [id, newContent, toVector(vector), entities],
    );
    return r.rows[0];
  });
}

/** Accept the being's proposed wording. */
export async function acceptProposedWording(id: string): Promise<MemoryRow> {
  const r = await query<{ proposed_content: string | null }>('SELECT proposed_content FROM memories WHERE id = $1', [id]);
  const proposed = r.rows[0]?.proposed_content;
  if (!proposed) throw new Error(`[memory] Memory ${id} has no proposed wording.`);
  return editMemory(id, proposed, 'wicked');
}

export async function declineProposedWording(id: string): Promise<void> {
  await query('UPDATE memories SET proposed_content = NULL WHERE id = $1', [id]);
}

async function simpleUpdate(id: string, editedBy: string, note: string, setSql: string, params: unknown[], beingId?: string) {
  return withTransaction(async (c) => {
    const row = await lockRow(c, id, beingId);
    await writeRevision(c, row, editedBy, note);
    const r = await c.query<MemoryRow>(
      `UPDATE memories SET ${setSql}, updated_at = now() WHERE id = $1 RETURNING ${MEMORY_COLUMNS}`,
      [id, ...params],
    );
    return r.rows[0];
  });
}

// ---- Wicked's controls ----
export const rateMemory = (id: string, score: number) =>
  simpleUpdate(id, 'wicked', `rated ${clampScore(score)}`, 'user_score = $2, user_scored = true', [clampScore(score)]);

export const pinMemory = (id: string) =>
  simpleUpdate(id, 'wicked', 'pinned', `status = 'pinned', pin_requested = false`, []);

export const unpinMemory = (id: string) =>
  simpleUpdate(id, 'wicked', 'unpinned', `status = 'active'`, []);

export const declinePinRequest = (id: string) =>
  simpleUpdate(id, 'wicked', 'pin request declined', 'pin_requested = false', []);

export const hideMemory = (id: string, note = 'hidden') =>
  simpleUpdate(id, 'wicked', note, `status = 'hidden', pin_requested = false`, []);

export const restoreMemory = (id: string) =>
  simpleUpdate(id, 'wicked', 'restored', `status = 'active'`, []);

/** Permanently delete a memory and its dependent records, leaving a content-free audit row. */
export async function deleteMemory(id: string): Promise<void> {
  await withTransaction(async (c) => {
    const row = await lockRow(c, id);
    await c.query('DELETE FROM memory_revisions WHERE memory_id = $1', [id]);
    await c.query('DELETE FROM memory_conflicts WHERE memory_a = $1 OR memory_b = $1', [id]);

    const reviewMemoryColumn = await c.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'review_log' AND column_name = 'memory_id'
       ) AS exists`,
    );
    if (reviewMemoryColumn.rows[0]?.exists) {
      await c.query('DELETE FROM review_log WHERE memory_id = $1', [id]);
    }

    await c.query('DELETE FROM memories WHERE id = $1', [id]);
    await c.query('INSERT INTO memory_deletions (memory_id, being_id) VALUES ($1, $2)', [id, row.being_id]);
  });
}

// ---- Being's controls (always scoped to its own memories) ----
export const beingScoreMemory = (beingId: string, id: string, score: number) =>
  simpleUpdate(id, beingId, `being scored ${clampScore(score)}`, 'being_score = $2, being_scored = true', [clampScore(score)], beingId);

export async function beingRequestPin(beingId: string, id: string): Promise<void> {
  await query(`UPDATE memories SET pin_requested = true WHERE id = $1 AND being_id = $2 AND status = 'active'`, [id, beingId]);
}

export async function beingProposeWording(beingId: string, id: string, wording: string): Promise<void> {
  await query('UPDATE memories SET proposed_content = $3 WHERE id = $1 AND being_id = $2', [id, beingId, wording]);
}

// ---- Lists for the dashboard ----
export type MemoryFilter = 'all' | 'active' | 'pinned' | 'hidden' | 'unrated' | 'fresh' | 'pending-review' | 'pin-requests' | 'proposed-wording';

export async function listMemories(beingId: string, filter: MemoryFilter = 'all', limit = 100, offset = 0): Promise<MemoryView[]> {
  const where: Record<MemoryFilter, string> = {
    all: `status <> 'hidden'`,
    active: `status = 'active'`,
    pinned: `status = 'pinned'`,
    hidden: `status = 'hidden'`,
    unrated: `status <> 'hidden' AND user_scored = false`,
    fresh: `status <> 'hidden' AND created_at > now() - interval '${TUNING.freshEndDays} days'`,
    'pending-review': `status <> 'hidden' AND being_scored = false`,
    'pin-requests': `pin_requested = true AND status = 'active'`,
    'proposed-wording': `proposed_content IS NOT NULL AND status <> 'hidden'`,
  };
  const lambda = await getLambda(beingId);
  const r = await query<MemoryRow>(
    `SELECT ${MEMORY_COLUMNS} FROM memories WHERE being_id = $1 AND ${where[filter]}
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [beingId, limit, offset],
  );
  return r.rows.map((row) => withScore(row, lambda));
}

export async function getRevisions(memoryId: string) {
  const r = await query('SELECT * FROM memory_revisions WHERE memory_id = $1 ORDER BY edited_at DESC', [memoryId]);
  return r.rows;
}

