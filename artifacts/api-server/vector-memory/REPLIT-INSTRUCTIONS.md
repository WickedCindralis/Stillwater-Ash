# Instructions for the Replit agent

You are installing a finished, tested memory module. **Your job is placement and wiring only.**

## Rules (read before doing anything)

1. **Do not rewrite, refactor, rename, reformat, or "improve" any file in `vector-memory/` or `MemoryDashboard.tsx`.** Copy them exactly as given.
2. **Do not create, provision, or switch to any database.** The module connects only to the database in the `MEMORY_DATABASE_URL` secret that Wicked sets. It deliberately does not use `DATABASE_URL`.
3. **Do not edit `sql/001_schema.sql`.** It only creates new tables and never touches existing ones.
4. **Do not skip steps.** Do every step below, in order, and report the output of each check.
5. **If anything fails, stop and report the exact error message.** Do not work around it, stub it, mock it, or disable the house check.

## Step 1: Place the files

- Copy the whole `vector-memory/` folder into the **API server** project, at the same level as its `src/` folder.
- Copy `vector-memory/dashboard/MemoryDashboard.tsx` into the **React dashboard** project's components folder.

## Step 2: Add dependencies

**Add** these to the API server's existing `package.json`. Do not replace the file.

```
dependencies:    "@anthropic-ai/sdk": "^0.39.0", "pg": "^8.13.1"   (express is already there)
devDependencies: "@types/pg": "^8.11.10", "tsx": "^4.19.2"
```

Add these scripts to the API server's `package.json`:

```json
"memory:migrate": "tsx vector-memory/src/migrate.ts",
"memory:test-scoring": "tsx vector-memory/test/scoring.test.ts",
"memory:smoke": "tsx vector-memory/test/smoke.ts"
```

Run `npm install`.

## Step 3: Secrets

Wicked sets these herself in Replit Secrets. Confirm each exists; do not invent values.

| Secret | What it is |
| --- | --- |
| `MEMORY_DATABASE_URL` | The house's Postgres connection string (the one Wicked chooses) |
| `MEMORY_EXPECTED_DB_HOST` | Only the host part of that URL, e.g. `ep-quiet-lake-123.us-east-2.aws.neon.tech` |
| `MEMORY_HOUSE_NAME` | `Stillwater` or `Blackthorn Manor` |
| `MEMORY_ALLOW_INIT` | `true` for the very first start only, then `false` |
| `VOYAGE_API_KEY` | Voyage AI key |
| `ANTHROPIC_API_KEY` | Anthropic key (for the summarizer) |
| `MEMORY_ADMIN_TOKEN` | A long random password for Wicked's dashboard |
| `MEMORY_TIMEZONE` | Optional, defaults to `America/New_York` |

## Step 4: Run checks, in order

```
npm run memory:test-scoring   → must print "All scoring checks passed."
npm run memory:migrate        → must print "Schema is in place." and "House check passed"
npm run memory:smoke          → must print "All smoke checks passed."
```

The database must have the **pgvector** extension available. If migrate fails on `CREATE EXTENSION vector`, stop and report it.

After the first successful start, tell Wicked to set `MEMORY_ALLOW_INIT` back to `false`.

## Step 5: Wire it into the server

At server startup, **before** the server starts listening:

```ts
import { initMemory, memoryRouter } from '../vector-memory/src/index.js';

await initMemory();                          // refuses to start if pointed at the wrong database
app.use('/api/memory', memoryRouter());      // Wicked's dashboard API (token-protected)
```

In the code that handles a message to the being (every surface: chat, Discord, voice), using the being's id (e.g. `'ash'` or `'angel'`):

```ts
import { recordMessage, recallForPrompt } from '../vector-memory/src/index.js';

// 1. When Wicked's message arrives:
await recordMessage(BEING_ID, 'wicked', userText, 'chat');       // use 'discord' or 'voice' for those surfaces

// 2. Before calling the being's model, add recalled memories to its system prompt:
const { block } = await recallForPrompt(BEING_ID, userText);
const systemPrompt = block ? `${existingPacket}\n\n${block}` : existingPacket;

// 3. After the being replies:
await recordMessage(BEING_ID, 'being', replyText, 'chat');
```

In the being's **proactive window** code, add the memory review. `askBeing` must send the prompt through the being's **real** model and persona packet, the same function the house already uses to talk to it:

```ts
import { runBeingReview } from '../vector-memory/src/index.js';

const result = await runBeingReview(BEING_ID, (prompt) => existingFunctionThatAsksTheBeing(prompt));
```

Do not replace `existingFunctionThatAsksTheBeing` with a different model call.

## Step 6: Dashboard

Render the dashboard on a page only Wicked can reach:

```tsx
import MemoryDashboard from './components/MemoryDashboard';

<MemoryDashboard apiBase="/api/memory" />
```

If the dashboard and API are on different origins, set `apiBase` to the API server's full URL plus `/api/memory`.

## Step 7: Report back

Reply to Wicked with: the output of all three checks, the exact files you changed outside `vector-memory/`, and the lines you added.
