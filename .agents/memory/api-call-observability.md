---
name: API call observability
description: User-required evidence and safe logging for API-powered features.
---

For new API-powered behavior, make the actual external call and log request start, success or failure, duration, correlation/session ID, and provider request ID when available. Log only safe image metadata; never include credentials, prompt text, transcripts, or image bytes. An accepted or queued job is not evidence that a provider request actually started.

**Why:** The user explicitly requires that an API call be made and logged for everything, and wants failures visible rather than silent fallbacks.

**How to apply:** Check each new request boundary and asynchronous worker separately, including capture and provider calls; correlate them without leaking content. Do not claim a screenshot was seen unless the provider call with that image actually ran.