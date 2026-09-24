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