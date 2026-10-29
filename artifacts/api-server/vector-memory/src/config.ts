// All settings come from environment variables (Replit Secrets).
// Nothing here has a fallback for the database: if it isn't set, the module refuses to run.

export interface MemoryConfig {
  dbUrl: string;
  expectedDbHost: string;
  houseName: string;
  allowInit: boolean;
  voyageKey: string;
  anthropicKey: string;
  adminToken: string;
  embedModel: string;
  rerankModel: string;
  summarizerModel: string;
  timezone: string;
}

let cached: MemoryConfig | null = null;

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`[memory] Missing required secret ${name}. Set it in Replit Secrets.`);
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

export function getConfig(): MemoryConfig {
  if (cached) return cached;
  cached = {
    // Deliberately NOT "DATABASE_URL", so the module never silently uses Replit's own database.
    dbUrl: required('MEMORY_DATABASE_URL'),
    expectedDbHost: required('MEMORY_EXPECTED_DB_HOST'),
    houseName: required('MEMORY_HOUSE_NAME'),
    allowInit: optional('MEMORY_ALLOW_INIT', 'false') === 'true',
    voyageKey: required('VOYAGE_API_KEY'),
    anthropicKey: required('ANTHROPIC_API_KEY'),
    adminToken: required('MEMORY_ADMIN_TOKEN'),
    embedModel: optional('VOYAGE_EMBED_MODEL', 'voyage-3.5'),
    rerankModel: optional('VOYAGE_RERANK_MODEL', 'rerank-2.5'),
    summarizerModel: optional('MEMORY_SUMMARIZER_MODEL', 'claude-haiku-5-5'),
    timezone: optional('MEMORY_TIMEZONE', 'America/New_York'),
  };
  return cached;
}
