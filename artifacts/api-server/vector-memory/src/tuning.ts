// Every adjustable number in one place. Change these during the pilot; nothing else needs touching.

export const TUNING = {
  // Importance
  beingWeight: 0.6,
  userWeight: 0.4,
  defaultUserScore: 5,

  // Decay floor = floorBase + floorPerImportance × importance  (0.25 at 1, 0.70 at 10)
  floorBase: 0.2,
  floorPerImportance: 0.05,
  defaultLambda: 0.05,

  // Freshness: full bonus until plateauDays, slides to zero by endDays
  freshBonusPerImportance: 0.15,
  freshPlateauDays: 2,
  freshEndDays: 7,

  // Search ranking
  semanticWeight: 0.55,
  matchWeight: 0.25,
  strengthWeight: 0.2,
  rerankTopN: 20,
  rerankBlend: 0.6, // final order = 0.6 × reranker + 0.4 × ranking score
  vectorCandidates: 60,
  keywordCandidates: 30,

  // Recall: memories below this ranking score are not injected (keeps "hi" from pulling 8 memories)
  recallLimit: 8,
  recallMinScore: 0.35,

  // Capture
  captureIdleMinutes: 60,
  captureSweepSeconds: 60,
  captureChunkMessages: 150,

  // Being review
  reviewBatchSize: 10,

  // Nightly tidy-up
  nightlyHourLocal: 3,
  duplicateSimilarity: 0.95,
  conflictSimilarityMin: 0.8,
  nightlyLookbackHours: 48,

  // Dashboard warnings
  warnPending: 50,
  warnOldestPendingDays: 3,
  warnLastReviewDays: 2,
};
