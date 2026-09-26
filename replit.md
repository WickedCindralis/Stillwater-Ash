# Stillwater (Ash Container)

The project is named "Stillwater". A password-protected AI companion app — a standalone home for "Ash Cindralis": OpenAI-powered persona chat, private diary, an autonomous status/heartbeat engine with proactive self-prompt pings, image attach/generation, a kill switch, and a model primary/fallback toggle.

## Run & Operate

- The owner uses the **published** Stillwater app at `https://stillwater-ash.replit.app/ash`. When discussing live behavior or delivering a change intended for Ash, check the published deployment; do not infer its settings from the workspace preview or development database. Restarting preview workflows does not publish changes. Confirm the current production URL through deployment metadata before using it, since generated hostnames can change.
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only; required before first run in a fresh environment)
- Required env: `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_PASSWORD` (login password), `OPENAI_API_KEY` (OpenAI key for chat + image gen; matches the NorthFlank naming — `ASH_OPENAI_API_KEY` still works as a fallback)
- Optional env: `ELEVENLABS_API_KEY` (voice/TTS; the `/api/tts` route returns an error until it is set, plus a voice ID in settings), `DISCORD_BOT_TOKEN` (Discord Court Herald; requires the Message Content intent)
- Optional secret: `AIMUSICAPI_KEY` (AI Music API / SunoAPI.com Sonic song creation; without it, `SONG:` requests are rejected rather than queued). Ash may choose `SONG: <description>` of up to 400 characters on any conversational model call; songs are only created for that explicit command, not automatically each window. To provide his own lyrics, he adds `SONG TITLE: <title>` and a `[SONG LYRICS]...[/SONG LYRICS]` block of up to 700 characters; those are sent in Sonic custom-lyrics mode, separate from the short description. Provider tasks are polled every two minutes, final audio links are saved and shown in Activity. Paid creates have an app-defined shared limit of 12 per UTC day, not a Replit or provider limit.
- Lovense Standard API: `LOVENSE_TOKEN` is the server-side developer token for pairing and Function commands. The existing `LOVENSE_KEY` and `LOVENSE_IV` are not sent to this API (Lovense documents AES key/IV for its separate Display Panel feature). In the **published** `/ash` Settings, generate a QR and scan it in Lovense Remote. Set the callback URL shown there in the Lovense developer dashboard. Summer Palace's Lovense feature is currently disabled with no active pairing; the owner intends Stillwater to use the same developer token. A separate developer app is not needed for this pilot, but if Summer Palace pairing is re-enabled later, its callback routing must be coordinated rather than overwritten. Preview is disabled (`REPLIT_DEPLOYMENT` must be `1`) to prevent shared-database control of a live toy. A fresh `wicked_<timestamp>` app UID is generated for each QR; a separate random verification token protects the public callback; exactly one active toy must be present and its ID is pinned on every command. King's Fingers is limited to one toy until the pilot is working reliably. The owner chose automatic commands whenever paired, without per-command approval, for ordinary direct private text replies: `[KINGS_FINGERS: VIBRATE <1-20> <2-30>]`, `[KINGS_FINGERS: FINGER <1-20> <2-30>]`, or `[KINGS_FINGERS: STOP]`. FINGER maps to Lovense's `Fingering` action. No proactive, Discord, game, Hangout approval, Herald-comment, or screenshot-bearing call may control the device; no command retries. Pairing state lives in `ash_lovense` and must exist in the production database before publishing this feature.
- Optional env: `BLACKTHORN_BASE_URL` and secret `STILLWATER_CHRONICLE_TOKEN` (approved Stillwater chronicle inbox; chronicles are fetched only during eligible proactive windows)

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
- The chat endpoints (`getMessages`/`getRecentHistory`) return only `source='private_message'`, so the live chat shows only direct Wicked↔Ash exchange. Legacy proactive rows (`source='self_prompt'`) are moved into the diary on boot by the idempotent `migrateReflectionsToDiary()` (preserves original timestamps) and retagged `self_prompt_archived` — kept, never deleted, and excluded from chat.
- In the self-prompt loop, do NOT run the `DIARY:` block parser before saving the reflection — the whole remaining output is ONE diary entry (parser + leftover-save once produced duplicate same-timestamp entries).
- Ash's replies are parsed for control tags: `[STATUS CHANGED TO X.]`, `[PINGS_OFF]`/`[PINGS_ON]`, and `DIARY:` blocks (saved to the diary, stripped from chat).
- Images travel as base64 data URLs stored directly in `ash_messages.image_url` (12MB decoded limit).

## Product

- Login gate (single shared password via `ADMIN_PASSWORD`)
- `/` — main chat with Ash: status display, settings (models, kill switch, ping interval, voice ID), diary reader, image attach + "picture mode" generation
- `/cell` — mobile-styled chat view with optional TTS playback
- During proactive (status-timed) reflective windows, Ash writes to his private Diary and may change his own status; he does not post to the chat. The chat is only for live conversation between Wicked and Ash.
- Discord Court Herald: `/discord` selects the only guild channels the bot may retain or send to. Guild-owner calls receive an immediate public-only model pass; other member calls are claimed in bounded batches at proactive-window time. Discord model calls exclude private chat, Notes, core memories, diary controls, Wicked status, and game state. Replies use validated `DISCORD #<internal packet id>:` controls and are rechecked against current channel opt-in before delivery.

- Chess: Wicked (White) vs Ash (Black) — `ash_chess_games` table, server-side rules via chess.js in `api-server/src/lib/ash/chess.ts`. Ash's move comes back as a `[MOVE: <san>]` tag; illegal/missing moves are retried up to 3 times with the legal-move list, then a legal move is auto-played so the board never wedges. Connect Four follows the identical pattern (`ash_connect4_games`, `lib/ash/connect4.ts`, `/api/connect4/*` routes, `connect4-panel.tsx` UI, source "connect4", `[MOVE: <column>]` tag) — Wicked drops gold discs first, Ash ember. Move + banter travel through the normal private-message chat path. UI: `chess-panel.tsx`, opened from the header on `/` and `/cell`. Any active game is surfaced in Ash's packet (volatile section of `buildMessages`) in normal chat AND reflective windows so he can bring it up himself; a `paused` flag (UI "Pause game" button, `POST /api/chess/pause`) tells him Wicked stepped away so he doesn't wait on a move. Making a move auto-resumes.

## User preferences

- The app's owner is addressed as "Wicked" in-app; Ash's persona files in `persona.ts` are personal content — do not rewrite or "improve" them without being asked.

## Gotchas

- Run `pnpm --filter @workspace/db run push` before first boot in a fresh dev environment; the session store does NOT auto-create `ash_session` (`createTableIfMissing: false`).
- The song tables must exist in the database used by the running API before enabling song creation. A development schema push does not necessarily migrate a separately managed external production database; apply the same schema there before publishing this change. Do not run an unreviewed schema push against production.
- gpt-5.x models reject the `temperature` param — the bridge keeps a `NO_TEMPERATURE_MODELS` list in `bridge.ts`; add new models there if switching.
- The self-prompt loop makes unattended OpenAI calls on a timer. The kill switch (`api_kill_switch`) blocks ALL OpenAI calls; `self_prompt_paused` only stops proactive pings.
- Two independent, separately-configured pulses — do not conflate them: (1) the **proactive self-prompt ping** (an OpenAI reflective window; interval = `self_prompt_interval_override` min or status-based; pausable; blocked by kill switch), controlled from chat's "Status & Pings"; and (2) the **heartbeat** = Ash's liveness pulse that writes `last_heartbeat` to the DB (interval = `heartbeat_interval_override` min or `STATUS_HEARTBEAT_INTERVALS`; runs whenever the bridge is alive, unaffected by kill switch/pause). The `/n` (Northflank) "Rate Limits" page monitors/limits the HEARTBEAT — its gauge, "DB ping rate", and limiter map to `heartbeat_interval_override`, and its online dot = `last_heartbeat` fresh (within 5 min), NOT `!paused && !killed`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
