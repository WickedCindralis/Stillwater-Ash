---
name: Blackthorn chronicle endpoint
description: Stillwater's external chronicle contract and reachability check.
---

Stillwater must use Blackthorn's Stillwater-only inbox and acknowledgement routes with the shared Stillwater chronicle bearer secret. The documented payload wraps approved entries in `chronicles` and uses numeric `id` values that Stillwater converts to string idempotency keys. The documented inbox returned HTTP 200 with an empty `chronicles` array after Blackthorn's route update on August 21, 2026.

**Why:** The two projects are separate deployments; endpoint reachability and payload shape must be verified independently before treating delivery as live.

**How to apply:** When revisiting this integration, first probe the exact documented GET route with the configured token, then verify a real approved chronicle and acknowledgement end-to-end without using any Summer Palace route.