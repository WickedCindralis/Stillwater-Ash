---
name: Desktop companion responsiveness
description: Avoid Windows companion UI stalls and distinguish past capture errors from current transport failures.
---

Each Windows Hangout window starts with an empty transcript. It shows sent
and received messages from that window's period only, then follows new
messages incrementally. Closing the window ends its local period; reopening
starts a fresh one. The complete canonical history remains on the server.
Run network polling and desktop image encoding away from the UI message pump.

**Why:** The user explicitly wants the Windows app to keep messages only
during the active chat window, not preload older chat. Earlier production
polling also showed large history batches while the Windows window displayed
“Not Responding” and capture polls had long gaps. The server had not issued
a new capture request during that reported attempt; the visible timeout was
a persisted error from a prior capture.

**How to apply:** Establish a server-side message high-water mark when a
window becomes visible; hidden connection/heartbeat polls must not fill its
transcript. When changing companion sync or screenshot capture, check
both UI-thread work and the amount of history returned on initial sync.
Use capture request and upload logs to distinguish a new timeout from an
old status message. Allow for multi-monitor encoding and upload in the
bounded request lifetime without treating a stale error as new evidence.

Keep the Hangout sync cursor separate from a send response's observed message
IDs, and acknowledge sync results only after their cards have been rendered.
Size text cards explicitly and scroll to the reply's heading rather than a
possibly taller-than-viewport card with an attached screenshot.

**Why:** Production confirmed an Ash reply was persisted and returned to the
Windows app, and later polls skipped past its ID, while the user could not see
it. A cursor advanced before successful UI rendering has no recovery path;
automatic sizing and scrolling to a tall screenshot card can also obscure
the reply text.

**How to apply:** A failed render must leave the sync cursor behind for retry,
without telling the user to resend an already accepted message. Keep scroll
targets small enough that the beginning of a reply remains visible.

An active Hangout cannot be inferred from persisted session status alone.
Treat the live companion heartbeat as a prerequisite for automatic capture;
ordinary Stillwater chat should continue if an offline companion leaves a
stale active session behind.

**Why:** After a publish, a persisted Hangout session remained active while
the Windows companion was offline. An ordinary chat message waited for an
automatic screenshot, timed out, and was saved without an Ash reply.

**How to apply:** Fence capture at the provider/request boundary and end
stale sessions before routing web chat. Do not silently claim a failed
screenshot-backed message received an Ash response.