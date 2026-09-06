---
name: Replit deployment health probes
description: Why the API must answer 200 at its bare service base path, not just the configured healthz path
---

Replit Deployments probe the API at its **bare service base path** (the `paths`
entry in `artifact.toml`, e.g. `/api`) in addition to the configured
`[services.production.health.startup] path` (e.g. `/api/healthz`). If the app
only answers `/api/healthz` and returns 404/500 on bare `/api`, the deployment
logs fill with `healthcheck failed error=healthcheck /api returned status 500`.

**Why:** those probe failures are also emitted transiently during every cold
start / autoscale restart (the port isn't listening yet → `connection refused`
→ reported as a 500), so they look alarming but are mostly startup-window noise
and do NOT stop the app from serving.

**How to apply:** give the health router a `GET /` (→ `/api`) that returns 200
alongside `GET /healthz`. Distinguish this cosmetic health noise from a real
publish blocker (e.g. a stuck DB-changes approval). Production schema on Replit
is publish-flow only — the agent cannot migrate prod; prod SQL is read-only.

The workspace API workflow and the published Replit Live VM are separate
processes. A workflow restart loads code and secrets for development/preview,
but the published URL continues serving the previous build until the project
is published again.

**Why:** Discord bot behavior depends on whichever long-running process owns the
bot token, so checking the preview logs can falsely suggest a production bot
has received a code fix.

**How to apply:** after verifying a bot or API change in the workflow, check
deployment logs separately and publish before testing the public URL. Treat
Northflank as a separate deployment target with its own image and environment.
