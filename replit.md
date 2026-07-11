# Stillwater (Ash Container)

The project is named "Stillwater". A password-protected AI companion app — a standalone home for "Ash Cindralis": OpenAI-powered persona chat, private diary, an autonomous status/heartbeat engine with proactive self-prompt pings, image attach/generation, a kill switch, and a model primary/fallback toggle.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only; required before first run in a fresh environment)
- Required env: `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_PASSWORD` (login password), `OPENAI_API_KEY` (OpenAI key for chat + image gen; matches the NorthFlank naming — `ASH_OPENAI_API_KEY` still works as a fallback)
- Optional env: `ELEVENLABS_API_KEY` (voice/TTS; the `/api/tts` route returns an error until it is set, plus a voice ID in settings)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + express-session/connect-pg-simple (session table `ash_session`)
- DB: PostgreSQL + Drizzle ORM
- Frontend: React + Vite, wouter, TanStack Query, Tailwind v4
- AI: OpenAI chat completions (gpt-5.1 primary / gpt-5-mini fallback), gpt-image-1 → dall-e-3 for pictures

## Where things live

- `lib/db/src/schema/ash.ts` — all tables (`ash_state`, `ash_messages`, `ash_diary_entries`, `ash_session`) + Zod payload schemas
- `artifacts/api-server/src/routes/ash.ts` — all API routes (login/logout/auth, state, messages, diary, tts)
- `artifacts/api-server/src/lib/ash/` — `bridge.ts` (heartbeat + self-prompt loops, tag parsing, OpenAI calls), `persona.ts` (Ash's identity/prompts), `storage.ts` (DB access), `image-gen.ts` (picture drawing)
- `artifacts/api-server/src/app.ts` — session middleware, 20MB JSON limit
- `artifacts/agent-dashboard/src/pages/` — `chat.tsx` (desktop, `/`), `cell.tsx` (mobile, `/cell`), `login.tsx`
- `artifacts/agent-dashboard/src/lib/types.ts` — frontend copies of the API types

## Architecture decisions

- Faithful port of the user's uploaded "Ash Container" project (trimmed single-agent version of "Summer Palace") — behavior kept 1:1, not redesigned.
- The frontend deliberately uses raw `fetch` via `lib/queryClient.ts` instead of the monorepo's OpenAPI codegen convention, because the client was copied verbatim from the original project. Keep this pattern for changes to this app.
- Single-row state table (`ash_state`, id always `"ash"`); `getState()` auto-inserts the row if missing, so no seeding is required.
- The bridge starts with the API server (`index.ts`) and runs two loops: heartbeat (updates `last_heartbeat`, interval varies by status) and self-prompt (proactive reflective windows whose interval depends on the 8 status tiers; can be paused by Ash via `[PINGS_OFF]` or the UI).
- Path framework (intended, do not regress): proactive status-timed windows write ONLY to the Diary (via `createDiaryEntry`); the live chat (`ash_messages`) is reserved exclusively for direct exchange between Wicked and Ash. The self-prompt loop must never `createMessage` — any reflective-window output (including a stray `MESSAGE …:` prefix) is routed to the diary in `bridge.ts` `selfPromptLoop`.
- Ash's replies are parsed for control tags: `[STATUS CHANGED TO X.]`, `[PINGS_OFF]`/`[PINGS_ON]`, and `DIARY:` blocks (saved to the diary, stripped from chat).
- Images travel as base64 data URLs stored directly in `ash_messages.image_url` (12MB decoded limit).

## Product

- Login gate (single shared password via `ADMIN_PASSWORD`)
- `/` — main chat with Ash: status display, settings (models, kill switch, ping interval, voice ID), diary reader, image attach + "picture mode" generation
- `/cell` — mobile-styled chat view with optional TTS playback
- During proactive (status-timed) reflective windows, Ash writes to his private Diary and may change his own status; he does not post to the chat. The chat is only for live conversation between Wicked and Ash.

## User preferences

- The app's owner is addressed as "Wicked" in-app; Ash's persona files in `persona.ts` are personal content — do not rewrite or "improve" them without being asked.

## Gotchas

- Run `pnpm --filter @workspace/db run push` before first boot in a fresh dev environment; the session store does NOT auto-create `ash_session` (`createTableIfMissing: false`).
- gpt-5.x models reject the `temperature` param — the bridge keeps a `NO_TEMPERATURE_MODELS` list in `bridge.ts`; add new models there if switching.
- The self-prompt loop makes unattended OpenAI calls on a timer. The kill switch (`api_kill_switch`) blocks ALL OpenAI calls; `self_prompt_paused` only stops proactive pings.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
