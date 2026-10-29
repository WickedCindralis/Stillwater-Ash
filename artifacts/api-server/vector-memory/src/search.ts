import { query, toVector } from './db.js';
import { embed, rerank } from './voyage.js';
import { MEMORY_COLUMNS, getLambda, withScore, type MemoryRow, type MemoryView } from './memories.js';
import { TUNING } from './tuning.js';

export interface SearchResult extends MemoryView {
  semantic: number;
  match: number;
  rankScore: number; // 0.55 semantic + 0.25 match + 0.20 strength/10
  finalScore: number; // after rerank blend
}

const STOPWORDS = new Set(
  `a an the and or but if of to in on at by for with about from as is are was were be been being do does did
   what when where who whom which why how i me my mine you your yours we our us he him his she her hers it its they them
   their this that these those there here can could would should will shall may might must have has had not no yes
   tell remember know any some all just so than then too very`.split(/\s+/),
);

export function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Share of the query's meaningful words that appear in this memory's entities. */
export function entityMatch(queryTokens: string[], entities: string[]): number {
  if (!queryTokens.length || !entities?.length) return 0;
  const entTokens = new Set(entities.flatMap((e) => contentTokens(e)));
  const hits = queryTokens.filter((t) => entTokens.has(t)).length;
  return hits / queryTokens.length;
}

type CandidateRow = MemoryRow & { semantic: number; kw: number };

export interface SearchOptions {
  limit?: number;
  useReranker?: boolean;
}

/** Hybrid search inside ONE being's memories. Hidden memories are never returned. */
export async function searchMemories(beingId: string, text: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
  const limit = opts.limit ?? 10;
  const [qVec] = await embed([text], 'query');
  const vec = toVector(qVec);

  const scoredSelect = `SELECT ${MEMORY_COLUMNS},
      1 - (embedding <=> $2::vector) AS semantic,
      ts_rank_cd(search_text, plainto_tsquery('english', $3), 32) AS kw
    FROM memories
    WHERE being_id = $1 AND status <> 'hidden' AND embedding IS NOT NULL`;

  const [byVector, byKeyword] = await Promise.all([
    query<CandidateRow>(`${scoredSelect} ORDER BY embedding <=> $2::vector LIMIT ${TUNING.vectorCandidates}`, [beingId, vec, text]),
    query<CandidateRow>(
      `${scoredSelect} AND search_text @@ plainto_tsquery('english', $3) ORDER BY kw DESC LIMIT ${TUNING.keywordCandidates}`,
      [beingId, vec, text],
    ),
  ]);

  const byId = new Map<string, CandidateRow>();
  for (const row of [...byVector.rows, ...byKeyword.rows]) byId.set(String(row.id), row);
  if (!byId.size) return [];

  const lambda = await getLambda(beingId);
  const qTokens = contentTokens(text);

  const ranked: SearchResult[] = [...byId.values()].map((row) => {
    const view = withScore(row, lambda);
    const semantic = Number(row.semantic);
    const match = Math.max(entityMatch(qTokens, row.entities), Number(row.kw));
    const rankScore =
      TUNING.semanticWeight * semantic + TUNING.matchWeight * match + TUNING.strengthWeight * (view.score.strength / 10);
    const { semantic: _s, kw: _k, ...rest } = row as any;
    return { ...(rest as MemoryRow), score: view.score, semantic, match, rankScore, finalScore: rankScore };
  });

  ranked.sort((a, b) => b.rankScore - a.rankScore);
  const top = ranked.slice(0, TUNING.rerankTopN);

  if (opts.useReranker !== false && top.length > 1) {
    try {
      const rr = await rerank(text, top.map((m) => m.content));
      for (const { index, score } of rr) {
        top[index].finalScore = TUNING.rerankBlend * score + (1 - TUNING.rerankBlend) * top[index].rankScore;
      }
      top.sort((a, b) => b.finalScore - a.finalScore);
    } catch (err) {
      console.warn('[memory] Reranker unavailable, using ranking score only.', (err as Error).message);
    }
  }

  return top.slice(0, limit);
}
