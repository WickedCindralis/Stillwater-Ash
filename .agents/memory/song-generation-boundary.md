---
name: Song generation cost boundary
description: Why paid song commands have a shared, durable budget and cannot accumulate before provider configuration
---

Keep paid music generation behind an explicit Ash-authored song command and a database-coordinated budget across all model sources, including public Discord. Do not queue requests while the provider is unconfigured.

**Why:** Public participants can influence Discord packets, and the music provider charges credits per create. Prompt instructions alone are not a spending safeguard. An unconfigured backlog could unexpectedly bill many creates when a key is added later.

**How to apply:** When extending song commands to a new model path or changing the provider, preserve the explicit command boundary, cross-instance budget, and no-backlog behavior. Any new retry path must not repeat an accepted paid create without a known provider task ID.