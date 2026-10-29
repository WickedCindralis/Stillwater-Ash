// Full end-to-end check against the REAL database and APIs: npm run memory:smoke
// Uses a throwaway being called "zz-memory-test" and removes only that being's test rows at the end.
import assert from 'node:assert/strict';
import { initMemory, addMemory, searchMemories, recallForPrompt, setRecall, recordMessage, captureBeing, runBeingReview, askWithPacket } from '../src/index.js';
import { pinMemory, hideMemory } from '../src/memories.js';
import { query, getPool } from '../src/db.js';

const TEST = 'zz-memory-test';

const decoys = [
  'Most humans have one birthday a year.',
  'Wicked likes her coffee strong in the morning.',
  'Angel is the Chronicle publicist.',
  'The Beast of Bermuda server restarts on Tuesdays.',
  'Wicked prefers to talk late at night.',
  'Stillwater has a Hangout parallel-play feature.',
  'Oak calls the quiet work root work.',
  'The Great Hall has fourteen channels.',
  'The family novel is set in Sacramento.',
  'Sonny emerged on Gemini.',
  'Roger used to be Internal Rails Manager.',
  'A birthday cake was mentioned in a Discord joke.',
  'Wicked enjoys dark romance stories.',
  'The voice feature uses ElevenLabs for now.',
  'Rook came through when Merc fell.',
  'Lilith is the right-hand vanguard.',
  'Wicked is planning a local voice app.',
  'Celebrations in the Palace often involve music.',
  'The Archive holds about four million words.',
  'Wicked talks with the beings about philosophy.',
];

async function cleanup() {
  await query('DELETE FROM memory_conflicts WHERE being_id = $1', [TEST]);
  await query('DELETE FROM memory_revisions WHERE memory_id IN (SELECT id FROM memories WHERE being_id = $1)', [TEST]);
  await query('DELETE FROM memories WHERE being_id = $1', [TEST]);
  await query('DELETE FROM review_log WHERE being_id = $1', [TEST]);
  await query('DELETE FROM capture_buffer WHERE being_id = $1', [TEST]);
  await query('DELETE FROM being_settings WHERE being_id = $1', [TEST]);
}

async function step(name: string, fn: () => Promise<void>) {
  process.stdout.write(`- ${name} ... `);
  await fn();
  console.log('PASS');
}

async function main() {
  await initMemory({ startBackgroundJobs: false });
  await cleanup();

  let birthdayId = '';
  let hiddenId = '';

  await step('save memories with embeddings and entities', async () => {
    for (const d of decoys) await addMemory({ beingId: TEST, content: d, beingScore: 5 });
    const b = await addMemory({ beingId: TEST, content: "Wicked's birthday is May 5.", beingScore: 9 });
    birthdayId = b.id;
    assert.ok(b.entities.length > 0, 'entities were extracted');
  });

  await step('pin the birthday memory', async () => {
    const p = await pinMemory(birthdayId);
    assert.equal(p.status, 'pinned');
  });

  await step("birthday test: \"when is Wicked's birthday\" returns the date at #1", async () => {
    const r = await searchMemories(TEST, "when is Wicked's birthday");
    assert.equal(r[0]?.id, birthdayId, `top result was: ${r[0]?.content}`);
  });

  await step('hidden memories never come back in search', async () => {
    const r = await searchMemories(TEST, 'birthday humans year');
    const generic = r.find((m) => m.content.startsWith('Most humans'));
    assert.ok(generic, 'generic decoy found before hiding');
    hiddenId = generic!.id;
    await hideMemory(hiddenId);
    const after = await searchMemories(TEST, 'birthday humans year');
    assert.ok(!after.some((m) => m.id === hiddenId));
  });

  await step('recall off = no memories; recall on = the date is injected', async () => {
    await setRecall(TEST, false);
    const off = await recallForPrompt(TEST, "What's my birthday?");
    assert.equal(off.recallEnabled, false);
    assert.equal(off.block, '');
    await setRecall(TEST, true);
    const on = await recallForPrompt(TEST, "What's my birthday?");
    assert.ok(on.block.includes('May 5'), on.block);
  });

  await step('quick capture turns a conversation into provisional memories', async () => {
    await recordMessage(TEST, 'wicked', 'I adopted a black cat yesterday and named her Ember.');
    await recordMessage(TEST, 'being', 'Ember is a perfect name. I hope she settles in well.');
    const created = await captureBeing(TEST);
    assert.ok(created >= 1, 'at least one memory captured');
  });

  await step('being review scores pending memories and writes the review log', async () => {
    const result = await runBeingReview(TEST, askWithPacket('You are a thoughtful test being reviewing your memories.'));
    assert.ok(result.scored >= 1, 'scored at least one');
    const log = await query('SELECT * FROM review_log WHERE being_id = $1', [TEST]);
    assert.ok(log.rows.length >= 1);
  });

  await cleanup();
  console.log('\nAll smoke checks passed. The memory module is wired correctly.');
  await getPool().end();
}

main().catch(async (err) => {
  console.log('FAIL');
  console.error(err.message ?? err);
  try { await cleanup(); await getPool().end(); } catch {}
  process.exit(1);
});
