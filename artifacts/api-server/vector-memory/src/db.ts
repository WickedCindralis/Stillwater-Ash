import pg from 'pg';
import { getConfig } from './config.js';

let pool: pg.Pool | null = null;
let verified = false;

export function getPool(): pg.Pool {
  if (!pool) {
    const { dbUrl } = getConfig();
    pool = new pg.Pool({ connectionString: dbUrl, max: 5 });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  return getPool().query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The house guard. Runs before anything else touches the database.
 * 1. The database host must match MEMORY_EXPECTED_DB_HOST.
 * 2. The database must carry this house's name in memory_house.
 * If either check fails, the module refuses to start instead of writing memories to the wrong place.
 */
export async function verifyHouse(): Promise<void> {
  if (verified) return;
  const cfg = getConfig();

  let host: string;
  try {
    host = new URL(cfg.dbUrl).hostname;
  } catch {
    throw new Error('[memory] MEMORY_DATABASE_URL is not a valid database address.');
  }
  if (host !== cfg.expectedDbHost) {
    throw new Error(
      `[memory] WRONG DATABASE. Connected host is "${host}" but MEMORY_EXPECTED_DB_HOST is "${cfg.expectedDbHost}". ` +
        'Memory is refusing to start. Check MEMORY_DATABASE_URL in Secrets.',
    );
  }

  const exists = await query(`SELECT to_regclass('memory_house') AS t`);
  if (!exists.rows[0]?.t) {
    throw new Error('[memory] Memory tables are missing. Run the migration first: npm run memory:migrate');
  }

  const marker = await query<{ name: string }>('SELECT name FROM memory_house');
  if (marker.rows.length === 0) {
    if (!cfg.allowInit) {
      throw new Error(
        `[memory] This database has no house marker yet. To claim it for "${cfg.houseName}", ` +
          'set MEMORY_ALLOW_INIT=true, start once, then set it back to false.',
      );
    }
    await query('INSERT INTO memory_house (name) VALUES ($1)', [cfg.houseName]);
    console.log(`[memory] Database claimed for house "${cfg.houseName}".`);
  } else if (marker.rows[0].name !== cfg.houseName) {
    throw new Error(
      `[memory] WRONG HOUSE. This database belongs to "${marker.rows[0].name}", not "${cfg.houseName}". Refusing to start.`,
    );
  }

  verified = true;
  console.log(`[memory] House check passed: "${cfg.houseName}" on ${host}.`);
}

export async function ensureBeing(beingId: string): Promise<void> {
  await query('INSERT INTO being_settings (being_id) VALUES ($1) ON CONFLICT (being_id) DO NOTHING', [beingId]);
}

export const toVector = (v: number[]) => `[${v.join(',')}]`;
