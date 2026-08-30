---
name: Capped chat visibility
description: Why persisted Stillwater messages can appear dropped after the live chat reaches its fixed-size window.
---

When a live chat query returns a fixed-size rolling window, visibility and scroll behavior must be keyed to the newest message identifier rather than array length. The writer should also place the successful mutation response into its local cache immediately instead of depending only on a follow-up poll.

**Why:** Once Stillwater's rolling window reached 300 entries, every new exchange replaced older rows without changing `messages.length`, so the existing length-based scroll effect stopped moving to new messages. Production records proved the sends and replies were persisted; they were below the viewport, not dropped by the VM.

**How to apply:** For capped feeds, update the writer's cache from the mutation response, retain only the intended window, and trigger newest-item visibility using the last item's stable ID. Keep live JSON fetches out of browser caching.