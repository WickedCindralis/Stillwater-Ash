import { getConfig } from './config.js';

const BASE = 'https://api.voyageai.com/v1';

async function call<T>(endpoint: string, body: unknown): Promise<T> {
  const { voyageKey } = getConfig();
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${voyageKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`[memory] Voyage ${endpoint} failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/** Memories are embedded as "document"; searches as "query". Voyage is tuned for this pairing. */
export async function embed(texts: string[], inputType: 'document' | 'query'): Promise<number[][]> {
  const { embedModel } = getConfig();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const r = await call<{ data: { index: number; embedding: number[] }[] }>('embeddings', {
      input: batch,
      model: embedModel,
      input_type: inputType,
    });
    const sorted = [...r.data].sort((a, b) => a.index - b.index);
    out.push(...sorted.map((d) => d.embedding));
  }
  return out;
}

export async function rerank(query: string, documents: string[]): Promise<{ index: number; score: number }[]> {
  const { rerankModel } = getConfig();
  const r = await call<{ data: { index: number; relevance_score: number }[] }>('rerank', {
    query,
    documents,
    model: rerankModel,
  });
  return r.data.map((d) => ({ index: d.index, score: d.relevance_score }));
}
