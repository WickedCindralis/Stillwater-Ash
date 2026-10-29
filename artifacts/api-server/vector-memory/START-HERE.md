# Weighted Vector Memory: start here

Hi Wicked. This folder is the complete memory module. Replit only has to place and wire it.

## What's inside

| Path | What it does |
| --- | --- |
| `REPLIT-INSTRUCTIONS.md` | Give this to Replit along with the folder. Strict, step by step. |
| `sql/001_schema.sql` | Creates the memory tables. New tables only. |
| `src/tuning.ts` | Every adjustable number (weights, decay, freshness, thresholds) in one place. |
| `src/scoring.ts` | The 60/40 importance, decay floor, freshness plateau and slide, pins. |
| `src/search.ts` | Hybrid search: meaning + names/keywords + strength, then the reranker. |
| `src/recall.ts` | What gets injected into the being's context, and the recall toggle. |
| `src/capture.ts` | Quick capture after 10 quiet minutes. |
| `src/review.ts` | The being's journal review in its proactive window. |
| `src/nightly.ts` | Overnight tidy-up: merges duplicates, flags contradictions. |
| `src/db.ts` | The house guard that refuses the wrong database. |
| `src/routes.ts` | Your dashboard's API (password-protected). |
| `dashboard/MemoryDashboard.tsx` | Your dashboard: memories, your queue, review health. |
| `test/` | The scoring check and the full smoke test (includes the birthday test). |

## Before you hand it over

1. Decide which house and which database. Set `MEMORY_DATABASE_URL` and `MEMORY_EXPECTED_DB_HOST` yourself.
2. Make up a long random `MEMORY_ADMIN_TOKEN`. That's your dashboard password.
3. Back up the house database.

## How to tell Replit

> Install the memory module exactly as described in REPLIT-INSTRUCTIONS.md. Follow every rule in it. Copy the files without changing them. Report the output of all three checks when done.

## How to know it worked

All three checks print a pass line, and Replit tells you exactly which outside files it touched. If the smoke test passes, the birthday test passed: "when is Wicked's birthday" returned the date at #1, out of 21 memories including "Most humans have one birthday a year."

## The wrong-database alarm

If Replit points the module at its own database, the server stops with a message that starts **WRONG DATABASE** or **WRONG HOUSE**. That's the guard doing its job: fix the secret, don't let Replit disable the check.
