import { TUNING } from './tuning.js';

export type MemoryStatus = 'active' | 'pinned' | 'hidden';

export interface ScoreInputs {
  beingScore: number;
  userScore: number;
  status: MemoryStatus;
  useCount: number;
  lastUsedAt: Date;
  createdAt: Date;
  lambda: number;
  now?: Date;
}

export interface ScoreBreakdown {
  importance: number;
  decay: number;
  floor: number;
  freshBonus: number;
  strength: number;
  isFresh: boolean;
  freshDaysLeft: number;
}

const DAY_MS = 86_400_000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function importanceOf(beingScore: number, userScore: number): number {
  return TUNING.beingWeight * beingScore + TUNING.userWeight * userScore;
}

export function scoreMemory(i: ScoreInputs): ScoreBreakdown {
  const now = i.now ?? new Date();
  const importance = importanceOf(i.beingScore, i.userScore);
  const daysSinceUsed = Math.max(0, (now.getTime() - i.lastUsedAt.getTime()) / DAY_MS);
  const daysSinceCreated = Math.max(0, (now.getTime() - i.createdAt.getTime()) / DAY_MS);

  const floor = TUNING.floorBase + TUNING.floorPerImportance * importance;
  const rawDecay = Math.exp((-i.lambda * daysSinceUsed) / (1 + Math.log(1 + Math.max(0, i.useCount))));
  const decay = Math.max(floor, rawDecay);

  const slideLength = TUNING.freshEndDays - TUNING.freshPlateauDays;
  const freshFactor = clamp(1 - (daysSinceCreated - TUNING.freshPlateauDays) / slideLength, 0, 1);
  const freshBonus = TUNING.freshBonusPerImportance * importance * freshFactor;

  const isFresh = daysSinceCreated < TUNING.freshEndDays;
  const freshDaysLeft = Math.max(0, Math.ceil(TUNING.freshEndDays - daysSinceCreated));

  const strength = i.status === 'pinned' ? 10 : Math.min(10, importance * decay + freshBonus);

  return { importance, decay, floor, freshBonus, strength, isFresh, freshDaysLeft };
}
