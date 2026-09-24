---
name: Desktop companion responsiveness
description: Avoid Windows companion UI stalls and distinguish past capture errors from current transport failures.
---

The Windows companion should initially load only recent Hangout context,
then follow new messages incrementally. The complete canonical history remains
on the server; loading thousands of old messages into WinForms is not required
for a responsive pop-out. Run network polling and desktop image encoding away
from the UI message pump.

**Why:** Production polling showed repeated large history batches while the
Windows window displayed “Not Responding” and capture polls had long gaps.
The server had not issued a new capture request during the reported attempt;
the visible timeout was a persisted error from a prior capture.

**How to apply:** When changing companion sync or screenshot capture, check
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