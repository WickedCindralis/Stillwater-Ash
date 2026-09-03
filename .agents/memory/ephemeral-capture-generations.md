---
name: Ephemeral capture generations
description: Concurrency rule for one-shot desktop screenshots and immediate privacy controls.
---

Desktop capture requests, accepted uploads, and delivered images must remain bound
to the same in-memory generation and exact pending-request identity. OFF, revoke,
and re-pair invalidate that generation; the provider boundary must recheck it after
all asynchronous preparation.

**Why:** An upload can be awaiting persistence while OFF clears its request and ON
creates another. Resolving whichever request is globally current after that await
can attach the old desktop image to the new generation.

**How to apply:** Across every async boundary in capture intake, retain and compare
the original pending object and generation. Recheck the generation synchronously
immediately before submitting any image to an external model provider.

Accepted screenshots now become persistent historical activity after delivery.
Turning capture OFF or revoking the companion invalidates pending delivery and
provider use, but does not erase screenshots that were already delivered.

**Why:** The activity UI intentionally provides retained, clickable screenshots,
while OFF/revoke must still prevent an in-flight upload from becoming visible.

**How to apply:** Persist new images as hidden staging rows, recheck the exact
generation after the database write, delete invalidated stages, and publish the
row only after synchronous delivery. Serve persisted images only through the
authenticated activity endpoint.