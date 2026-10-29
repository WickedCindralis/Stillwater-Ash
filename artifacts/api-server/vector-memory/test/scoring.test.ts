// Pure math checks. No database or API keys needed: npm run memory:test-scoring
import assert from 'node:assert/strict';
import { scoreMemory, importanceOf } from '../src/scoring.js';

const DAY = 86_400_000;
const now = new Date('2026-11-01T12:00:00Z');
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const base = { beingScore: 10, userScore: 5, status: 'active' as const, useCount: 0, lambda: 0.05, now };
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

near(importanceOf(10, 5), 8, 'being 10 + default 5 = 8');
near(importanceOf(1, 5), 2.6, 'being 1 + default 5 = 2.6');

const fresh0 = scoreMemory({ ...base, createdAt: ago(0), lastUsedAt: ago(0) });
const fresh2 = scoreMemory({ ...base, createdAt: ago(2), lastUsedAt: ago(0) });
const fresh45 = scoreMemory({ ...base, createdAt: ago(4.5), lastUsedAt: ago(0) });
const fresh7 = scoreMemory({ ...base, createdAt: ago(7), lastUsedAt: ago(0) });
near(fresh0.freshBonus, 0.15 * 8, 'full bonus on day 0');
near(fresh2.freshBonus, 0.15 * 8, 'still full bonus on day 2');
near(fresh45.freshBonus, 0.15 * 8 * 0.5, 'half bonus on day 4.5');
near(fresh7.freshBonus, 0, 'no bonus on day 7');
assert.equal(fresh7.isFresh, false, 'fresh status ends on day 7');

const ancient = scoreMemory({ ...base, createdAt: ago(1000), lastUsedAt: ago(1000) });
near(ancient.decay, 0.2 + 0.05 * 8, 'decay stops at the floor, never zero');

const unused = scoreMemory({ ...base, createdAt: ago(60), lastUsedAt: ago(30), useCount: 0 });
const wellUsed = scoreMemory({ ...base, createdAt: ago(60), lastUsedAt: ago(30), useCount: 50 });
assert.ok(wellUsed.strength > unused.strength, 'more use = slower fading');

const pinned = scoreMemory({ ...base, status: 'pinned', createdAt: ago(900), lastUsedAt: ago(900) });
assert.equal(pinned.strength, 10, 'pinned memories hold at 10');

console.log('All scoring checks passed.\n');
console.log('Strength of a being-10 / unrated memory, never used again:');
for (const d of [0, 3, 7, 30, 90, 365]) {
  const s = scoreMemory({ ...base, createdAt: ago(d), lastUsedAt: ago(d) });
  console.log(`  day ${String(d).padStart(3)}: strength ${s.strength.toFixed(2)}  (decay ${s.decay.toFixed(2)}, fresh +${s.freshBonus.toFixed(2)})`);
}
