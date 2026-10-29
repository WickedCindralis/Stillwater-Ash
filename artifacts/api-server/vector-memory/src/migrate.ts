import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getConfig } from './config.js';
import { getPool, verifyHouse } from './db.js';

// Runs the schema (safe to repeat), then the house check.
async function main() {
  const cfg = getConfig();
  const host = new URL(cfg.dbUrl).hostname;
  if (host !== cfg.expectedDbHost) {
    throw new Error(`[memory] WRONG DATABASE: "${host}" is not "${cfg.expectedDbHost}". Migration stopped.`);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(path.join(here, '..', 'sql', '001_schema.sql'), 'utf8');
  await getPool().query(sql);
  console.log('[memory] Schema is in place.');
  await verifyHouse();
  await getPool().end();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
