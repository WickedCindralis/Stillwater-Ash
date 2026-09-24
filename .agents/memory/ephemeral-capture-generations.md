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