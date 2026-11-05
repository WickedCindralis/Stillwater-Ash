---
name: Song generation cost boundary
description: Why paid song commands have a shared, durable budget and cannot accumulate before provider configuration
---

Keep paid music generation behind an explicit Ash-authored song command and a database-coordinated budget across all model sources, including public Discord. Do not queue requests while the provider is unconfigured.

**Why:** Public participants can influence Discord packets, and the music provider charges credits per create. Prompt instructions alone are not a spending safeguard. An unconfigured backlog could unexpectedly bill many creates when a key is added later.

**How to apply:** When extending song commands to a new model path or changing the provider, preserve the explicit command boundary, cross-instance budget, and no-backlog behavior. Any new retry path must not repeat an accepted paid create without a known provider task ID.

For this product, one song request normally produces two generated clips. Group both clips and listen links into one request-level Activity entry, but count clips as generated only after the job succeeds.

**Why:** The user clarified that a single song request corresponds to two Suno generations and expects request-level logging without counting queued work as completed.

**How to apply:** Keep request/job counts distinct from completed clip counts in Activity and proactive summaries.