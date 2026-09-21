---
name: Story workspace continuity
description: Durable isolation and interruption rules for Ash's long-form manuscript writing
---

Story generation must use only the Story packet, bounded rolling summary, and the latest chapter or unfinished ending. Ordinary chat, Diary, and Discord must never receive manuscript context, and ordinary Packet inspection must not imply otherwise.

**Why:** The manuscript is a separate private writing surface. Mixing it into other channels would change Ash's normal context and could leak long-form prose into unrelated interactions.

**How to apply:** Keep a dedicated Story packet inspection path. Preserve partial streamed prose as unfinished, resume by appending to the same chapter, and mark a chapter complete only after a normal provider stop.

Only one Story writer may run across preview and production. Its database lease must renew during long streams, and a stale running state must become resumable after the lease expires.

**Why:** A provider-length response can run much longer than an ordinary chat request, and preview plus production may share the same database.

**How to apply:** Treat the renewable database lease—not process-local state—as the authority for mutual exclusion, and never overwrite saved partial output when resuming.