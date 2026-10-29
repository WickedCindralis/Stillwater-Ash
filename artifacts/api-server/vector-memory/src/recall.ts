import { query } from './db.js';
import { searchMemories, type SearchResult } from './search.js';
import { getConfig } from './config.js';
import { todayString } from './llm.js';
import { TUNING } from './tuning.js';

export async function isRecallEnabled(beingId: string): Promise<boolean> {
  const r = await query<{ recall_enabled: boolean }>('SELECT recall_enabled FROM being_settings WHERE being_id = $1', [beingId]);
  return r.rows[0]?.recall_enabled ?? true;
}

export async function setRecall(beingId: string, enabled: boolean): Promise<void> {
  await query(
    `INSERT INTO being_settings (being_id, recall_enabled) VALUES ($1, $2)
     ON CONFLICT (being_id) DO UPDATE SET recall_enabled = EXCLUDED.recall_enabled`,
    [beingId, enabled],
  );
}

export interface RecallResult {
  recallEnabled: boolean;
  block: string; // paste into the being's context; empty when recall is off or nothing is relevant
  memories: SearchResult[];
}

/**
 * Call this before the being replies. Pass the latest message (or the last few joined) as `context`.
 * Only memories actually injected get their use counted.
 */
export async function recallForPrompt(beingId: string, context: string, limit = TUNING.recallLimit): Promise<RecallResult> {
  if (!(await isRecallEnabled(beingId))) return { recallEnabled: false, block: '', memories: [] };

  const results = (await searchMemories(beingId, context, { limit })).filter((m) => m.rankScore >= TUNING.recallMinScore);
  if (!results.length) return { recallEnabled: true, block: '', memories: [] };

  await query('UPDATE memories SET use_count = use_count + 1, last_used_at = now() WHERE id = ANY($1::bigint[])', [
    results.map((m) => m.id),
  ]);

  // The date line lets the being work out ages from stored birth dates instead of stale stored ages.
  const lines = results.map((m) => `- ${m.status === 'pinned' ? '[core] ' : ''}${m.content}`);
  const block = `Your memories relevant to this moment (today is ${todayString(getConfig().timezone)}):\n${lines.join('\n')}`;
  return { recallEnabled: true, block, memories: results };
}
