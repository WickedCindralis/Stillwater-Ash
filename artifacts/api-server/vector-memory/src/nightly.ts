import { query, withTransaction } from './db.js';
import { MEMORY_COLUMNS, hideMemory, type MemoryRow } from './memories.js';
import { complete, parseJson } from './llm.js';
import { getConfig } from './config.js';
import { TUNING } from './tuning.js';

interface Neighbor {
  id: string;
  content: string;
  sim: number;
}

async function neighborsOf(memoryId: string): Promise<Neighbor[]> {
  const r = await query<Neighbor>(
    `SELECT o.id, o.content, 1 - (o.embedding <=> n.embedding) AS sim
     FROM memories n JOIN memories o ON o.being_id = n.being_id
     WHERE n.id = $1 AND o.id <> n.id AND o.status <> 'hidden' AND o.created_at < n.created_at
       AND o.embedding IS NOT NULL
     ORDER BY o.embedding <=> n.embedding LIMIT 5`,
    [memoryId],
  );
  return r.rows.map((x) => ({ ...x, sim: Number(x.sim) }));
}

/** Folds a near-identical new memory into the older one: the older earns the use, the newer is hidden (never destroyed). */
async function mergeDuplicate(newer: MemoryRow, olderId: string) {
  await withTransaction(async (c) => {
    await c.query(
      `UPDATE memories SET use_count = use_count + $2 + 1, last_used_at = GREATEST(last_used_at, $3), updated_at = now()
       WHERE id = $1`,
      [olderId, newer.use_count, newer.last_used_at],
    );
  });
  await hideMemory(newer.id, `merged into #${olderId} by nightly tidy-up`);
}

async function findConflicts(beingId: string, pairs: { a: Neighbor; b: MemoryRow }[]) {
  let flagged = 0;
  for (let i = 0; i < pairs.length; i += 20) {
    const chunk = pairs.slice(i, i + 20);
    const prompt = chunk.map((p, n) => `${n}. A: ${p.a.content}\n   B: ${p.b.content}`).join('\n');
    const reply = await complete(
      'For each numbered pair of memories, decide whether A and B contradict each other (cannot both be true). ' +
        'Updates count as contradictions ("lives in Ohio" vs "moved to Texas"). Reply with ONLY a JSON array: ' +
        '[{"pair": 0, "contradicts": true, "note": "short reason"}]. Include only pairs that contradict.',
      prompt,
      1500,
    );
    let found: { pair: number; contradicts: boolean; note?: string }[] = [];
    try {
      found = parseJson(reply);
    } catch {
      continue;
    }
    for (const f of found) {
      const p = chunk[f.pair];
      if (!p || !f.contradicts) continue;
      const [lo, hi] = [p.a.id, p.b.id].map(Number).sort((x, y) => x - y);
      const r = await query(
        `INSERT INTO memory_conflicts (being_id, memory_a, memory_b, note) VALUES ($1, $2, $3, $4)
         ON CONFLICT (memory_a, memory_b) DO NOTHING`,
        [beingId, lo, hi, f.note ?? null],
      );
      flagged += r.rowCount ?? 0;
    }
  }
  return flagged;
}

export async function runNightlyForBeing(beingId: string) {
  const recent = await query<MemoryRow>(
    `SELECT ${MEMORY_COLUMNS} FROM memories
     WHERE being_id = $1 AND status = 'active' AND created_at > now() - ($2 || ' hours')::interval
     ORDER BY created_at`,
    [beingId, String(TUNING.nightlyLookbackHours)],
  );

  let merged = 0;
  const conflictPairs: { a: Neighbor; b: MemoryRow }[] = [];
  for (const m of recent.rows) {
    const near = await neighborsOf(m.id);
    const dup = near.find((n) => n.sim >= TUNING.duplicateSimilarity);
    if (dup) {
      await mergeDuplicate(m, dup.id);
      merged++;
      continue;
    }
    for (const n of near) {
      if (n.sim >= TUNING.conflictSimilarityMin) conflictPairs.push({ a: n, b: m });
    }
  }
  const conflicts = conflictPairs.length ? await findConflicts(beingId, conflictPairs) : 0;
  return { beingId, checked: recent.rows.length, merged, conflicts };
}

export async function runNightly() {
  const beings = await query<{ being_id: string }>('SELECT being_id FROM being_settings');
  const out = [];
  for (const { being_id } of beings.rows) {
    try {
      out.push(await runNightlyForBeing(being_id));
    } catch (err) {
      console.error(`[memory] Nightly tidy-up failed for ${being_id}`, (err as Error).message);
    }
  }
  console.log('[memory] Nightly tidy-up done', JSON.stringify(out));
  return out;
}

function localParts(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

let timer: NodeJS.Timeout | null = null;

/** Checks every 10 minutes; runs once per local day after nightlyHourLocal. Survives restarts. */
export function startNightlyScheduler(): void {
  if (timer) return;
  const tick = async () => {
    const { date, hour } = localParts(getConfig().timezone);
    if (hour < TUNING.nightlyHourLocal) return;
    const claim = await query(
      `INSERT INTO memory_job_runs (job, ran_on) VALUES ('nightly', $1) ON CONFLICT DO NOTHING`,
      [date],
    );
    if (claim.rowCount) await runNightly();
  };
  timer = setInterval(() => tick().catch((e) => console.error('[memory] Nightly scheduler error', e)), 10 * 60 * 1000);
  tick().catch((e) => console.error('[memory] Nightly scheduler error', e));
}

export function stopNightlyScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

// ---- Conflicts queue ----
export async function listConflicts(beingId: string) {
  const r = await query(
    `SELECT c.id, c.note, c.created_at, a.id AS a_id, a.content AS a_content, a.created_at AS a_created,
            b.id AS b_id, b.content AS b_content, b.created_at AS b_created
     FROM memory_conflicts c JOIN memories a ON a.id = c.memory_a JOIN memories b ON b.id = c.memory_b
     WHERE c.being_id = $1 AND c.resolved = false ORDER BY c.created_at`,
    [beingId],
  );
  return r.rows;
}

/** keep 'a' hides B, keep 'b' hides A, 'both' just closes the flag. */
export async function resolveConflict(conflictId: string, keep: 'a' | 'b' | 'both') {
  const r = await query<{ memory_a: string; memory_b: string }>(
    'SELECT memory_a, memory_b FROM memory_conflicts WHERE id = $1',
    [conflictId],
  );
  const c = r.rows[0];
  if (!c) throw new Error(`[memory] Conflict ${conflictId} not found.`);
  if (keep === 'a') await hideMemory(c.memory_b, `hidden while settling conflict #${conflictId}`);
  if (keep === 'b') await hideMemory(c.memory_a, `hidden while settling conflict #${conflictId}`);
  await query('UPDATE memory_conflicts SET resolved = true WHERE id = $1', [conflictId]);
}
