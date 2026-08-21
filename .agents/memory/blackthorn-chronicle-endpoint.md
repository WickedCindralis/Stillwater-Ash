---
name: Blackthorn chronicle endpoint
description: Stillwater's external chronicle contract and current reachability check.
---

Stillwater must use Blackthorn's Stillwater-only inbox and acknowledgement routes with the shared Stillwater chronicle bearer secret. The documented payload wraps approved entries in `chronicles` and uses numeric `id` values that Stillwater converts to string idempotency keys. A direct probe of the documented inbox returned HTTP 404 (`Cannot GET /api/chronicle-inbox/stillwater`) on August 21, 2026, so delivery cannot be considered live until Blackthorn exposes that route.

**Why:** The two projects are separate deployments; a healthy Stillwater bridge cannot compensate for a missing route on Blackthorn, and guessing a different route could acknowledge the wrong delivery flow.

**How to apply:** When revisiting this integration, first probe the exact documented GET route with the configured token, then verify a real approved chronicle and acknowledgement end-to-end without using any Summer Palace route.