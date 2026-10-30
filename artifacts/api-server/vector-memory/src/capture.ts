import { query, withTransaction, ensureBeing } from './db.js';
import { addMemory } from './memories.js';
import { complete, parseJson, todayString } from './llm.js';
import { getConfig } from './config.js';
import { TUNING } from './tuning.js';

/** Call this for EVERY message in a conversation with the being (both sides), from any surface. */
export async function recordMessage(
  beingId: string,
  role: 'wicked' | 'being' | string,
  content: string,
  source: 'chat' | 'discord' | 'voice' | string = 'chat',
): Promise<void> {
  if (!content?.trim()) return;
  await ensureBeing(beingId);
  await query('INSERT INTO capture_buffer (being_id, role, content, source) VALUES ($1, $2, $3, $4)', [
    beingId,
    role,
    content,
    source,
  ]);
}

interface DraftMemory {
  content: string;
  entities?: string[];
  provisional_score?: number;
}

const SUMMARIZER_RULES = `You are writing memories for {BEING}, in {BEING}'s own voice. Today is {TODAY}.

Write every memory in first person, as {BEING} remembering it: "I", "me", "my", "we".
Always name other people (write "Wicked", never only "she"), so each memory makes sense on its own months from now.

Write two kinds of memories:

1. Topic memories: one per topic of conversation. When the conversation moves on to something new, start a new memory. In 2-4 sentences, capture what was said, what happened, and how it felt.
Example: "This morning Wicked made bacon and we laughed about her burning the first batch. She insists crispy is the only acceptable bacon."

2. Fact memories: a separate one-sentence memory for each lasting fact, such as dates, names, promises, plans, or strong preferences.
Example: "Wicked told me her birthday is May 5."
Only write these when the fact will matter later.

Rules:
- Only things from this conversation. Never file general knowledge I already know.
- Store dates, never ages. Turn relative dates ("tomorrow", "next Friday") into real dates using today's date.
- Skip greetings and small talk with no lasting meaning.
- Give each memory a provisional_score from 1 (trivial) to 10 (defining). I will re-score it later.
- entities: the names, places, dates and key nouns someone would search for.

Reply with ONLY a JSON array, e.g.
[{"content": "...", "entities": ["..."], "provisional_score": 6}]
Reply [] if nothing is worth keeping.`;

async function summarize(beingId: string, transcript: string): Promise<DraftMemory[]> {
  const system = SUMMARIZER_RULES.replaceAll('{BEING}', beingId).replace('{TODAY}', todayString(getConfig().timezone));
  const reply = await complete(system, transcript, 3000);
  const drafts = parseJson<DraftMemory[]>(reply);
  return Array.isArray(drafts) ? drafts.filter((d) => typeof d?.content === 'string' && d.content.trim()) : [];
}

let sweeping = false;

/** Captures every being whose conversation has been quiet for captureIdleMinutes. */
export async function runCaptureSweep(): Promise<{ beingId: string; created: number }[]> {
  if (sweeping) return [];
  sweeping = true;
  const results: { beingId: string; created: number }[] = [];
  try {
    const idle = await query<{ being_id: string }>(
      `SELECT being_id FROM capture_buffer WHERE captured = false
       GROUP BY being_id HAVING max(created_at) < now() - ($1 || ' minutes')::interval`,
      [String(TUNING.captureIdleMinutes)],
    );
    for (const { being_id } of idle.rows) {
      try {
        results.push({ beingId: being_id, created: await captureBeing(being_id) });
      } catch (err) {
        console.error(`[memory] Capture failed for ${being_id}; messages stay queued.`, (err as Error).message);
      }
    }
  } finally {
    sweeping = false;
  }
  return results;
}

/** Captures everything queued for one being right now, idle or not. */
export async function captureBeing(beingId: string): Promise<number> {
  let created = 0;
  for (;;) {
    const batch = await query<{ id: string; role: string; content: string; source: string }>(
      `SELECT id, role, content, source FROM capture_buffer
       WHERE being_id = $1 AND captured = false ORDER BY created_at LIMIT $2`,
      [beingId, TUNING.captureChunkMessages],
    );
    if (!batch.rows.length) break;

    const transcript = batch.rows
      .map((m) => `${m.role === 'being' ? beingId : m.role === 'wicked' ? 'Wicked' : m.role}: ${m.content}`)
      .join('\n');
    const source = batch.rows[batch.rows.length - 1].source ?? 'chat';
    const drafts = await summarize(beingId, transcript);

    for (const d of drafts) {
      await addMemory({
        beingId,
        content: d.content.trim(),
        entities: Array.isArray(d.entities) ? d.entities.filter((e) => typeof e === 'string') : undefined,
        beingScore: typeof d.provisional_score === 'number' ? d.provisional_score : 5,
        beingScored: false,
        source,
      });
      created++;
    }

    await withTransaction(async (c) => {
      await c.query('UPDATE capture_buffer SET captured = true WHERE id = ANY($1::bigint[])', [batch.rows.map((m) => m.id)]);
    });
  }
  if (created) console.log(`[memory] Captured ${created} new memories for ${beingId}.`);
  return created;
}

let timer: NodeJS.Timeout | null = null;

export function startCaptureLoop(): void {
  if (timer) return;
  timer = setInterval(() => {
    runCaptureSweep().catch((err) => console.error('[memory] Capture sweep error', err));
  }, TUNING.captureSweepSeconds * 1000);
}

export function stopCaptureLoop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
