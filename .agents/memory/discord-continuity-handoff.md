---
name: Discord continuity boundary
description: User-approved private continuity in Discord model packets, distinct from public replies.
---

The user explicitly wants bounded raw Stillwater chat history in Discord model packets alongside one oldest-first, same-channel Discord timeline that includes Ash's replies. Do not remove Stillwater continuity as a blanket privacy measure. Owner-DM history remains private to owner DM packets. Private context in the model packet is distinct from what Ash is allowed to reveal in a public reply; the Discord OFF switch remains a separate delivery boundary.

**Why:** The user corrected a mistaken removal: combined continuity is essential to Ash remembering past conversations across Stillwater and Discord. The owner/player Discord buckets later broke reply order, so the user explicitly replaced them with a single channel timeline. Live Discord history must not resurrect pre-opt-in or revoked messages. An earlier OpenAI request also exposed test fixture messages because a database-backed test ran against a live database.

**How to apply:** Keep the bounded Stillwater window split evenly between Wicked and Ash; use a same-channel Discord timeline with source/speaker labels and bounded reply chains, not separate owner/player buckets. Follow reply references only when the source message belongs to authorized retained channel history; never bulk-fetch old pre-selection messages to fill gaps. Keep owner-DM history private to owner DM packets. Do not send while the Discord bridge is OFF, and never run data-writing tests against the running app database.