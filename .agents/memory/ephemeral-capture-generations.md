---
name: Ephemeral capture generations
description: Concurrency rule for one-shot desktop screenshots and immediate privacy controls.
---

Desktop capture requests, accepted uploads, and delivered images must remain bound
to the same generation and exact pending-request identity. OFF, Stop, revoke,
and re-pair invalidate that generation; the provider boundary must recheck it after
all asynchronous preparation. Across API instances, the database request row is
the shared delivery fence.

**Why:** An upload can be awaiting persistence while OFF clears its request and ON
creates another. Resolving whichever request is globally current after that await
can attach the old desktop image to the new generation.

**How to apply:** Across every async boundary in capture intake, retain and compare
the original request and generation. Recheck immediately before submitting any
image to an external model provider. A local epoch alone cannot fence another instance.

Accepted screenshots now become persistent historical activity after delivery.
Turning capture OFF or revoking the companion invalidates pending delivery and
provider use, but does not erase screenshots that were already delivered.

**Why:** The activity UI intentionally provides retained, clickable screenshots,
while OFF/revoke must still prevent an in-flight upload from becoming visible.

**How to apply:** Persist new images as hidden staging rows, then coordinate
completion, publication, consumption, and cancellation on the same database row.
Cancellation must await the database operation and atomically delete any image
that has completed but was not yet consumed; otherwise a late upload can remain
stored after OFF or Stop even if its local waiter rejects it. Preserve historical
images only after consumption. Serve them through the authenticated activity endpoint.

For session-specific Stop, check the session generation and invalidate only that
session's undelivered mappings and capture in one transaction. Never use an
unscoped global capture cancellation after reading a Hangout session: another
instance may already have started a new one. Associate staged image bytes with
their capture request atomically, make the waiter observe only published images,
and sweep expired unconsumed captures even when the companion is not polling.
Recheck the companion token inside the locked screenshot read, not only at the
HTTP boundary.

**Why:** Independent API instances can reorder Stop, re-pairing, image upload,
publication, and screenshot fetch; a route-level bearer check or local epoch
does not protect the final database read.

**How to apply:** Treat Stop and credential revocation as transactional fences.
Test both orders of publish/consume, a stale Stop against a new session, and a
fetch authorized before token revocation.