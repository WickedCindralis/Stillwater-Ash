---
name: Background chat refresh
description: Stillwater chat recovery after a browser tab or mobile screen is backgrounded.
---

Stillwater must refetch live chat data when a tab regains focus or connectivity and should continue its message polling while backgrounded. Message history remains persisted; the initial page size and “Load earlier messages” behavior are not retention limits.

**Why:** The client explicitly disabled focus refetching, while browsers throttle or suspend timers for background tabs and off-screen mobile pages. Returning to the app could therefore leave stale message and mutation state until a hard refresh even though production had persisted the messages.

**How to apply:** Keep live API requests uncached, enable focus/reconnect recovery, allow the chat polling interval in the background, and update the writer’s local message cache directly from successful sends.