---
name: Published Ash state
description: How to verify and repair mutable Ash settings in the live published runtime
---

Treat development database state and published Ash state as separate until the published API confirms otherwise. For live configuration repairs, use the authenticated production state endpoint and verify the value through that same endpoint.

**Why:** a direct database update succeeded in development, but the newly published app still had an empty voice setting and returned the same configuration error. Updating the authenticated production state fixed it immediately, and the user confirmed live TTS worked afterward.

**How to apply:** when a published Ash feature reports missing persisted configuration, inspect deployment logs, update through the live authenticated settings API when appropriate, and verify the production response before asking the user to retry.