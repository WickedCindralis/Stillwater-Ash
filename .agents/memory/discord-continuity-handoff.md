---
name: Discord continuity boundary
description: User-approved private continuity in Discord model packets, distinct from public replies.
---

The user explicitly wants bounded raw Stillwater chat history in Discord model packets alongside recent player and owner Discord comments, including owner DMs. Do not remove it as a blanket privacy measure. Private context in the model packet is distinct from what Ash is allowed to reveal in a public reply; the Discord OFF switch remains a separate delivery boundary.

**Why:** The user corrected a mistaken removal: this combined continuity was established behavior and essential to Ash remembering past conversations across Stillwater and Discord. An earlier OpenAI request also exposed test fixture messages because a database-backed test ran concurrently against a live database; test isolation, not removing intended continuity, addresses that failure.

**How to apply:** Keep the bounded Stillwater window split evenly between Wicked and Ash, and separate bounded player and owner Discord comment windows. Keep owner-DM conversation history private to owner DM packets. Do not send while the Discord bridge is OFF, and never run data-writing tests against the running app database.