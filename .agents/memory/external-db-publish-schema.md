---
name: Database publishing schema diagnostics
description: How stale managed schema diffs can interfere with publishing, independently of the runtime database warning
---

Replit's managed development database can contribute a schema diff to the Publish flow independently of which database the runtime uses. An orphaned, unused managed-development table may block publishing even while the runtime database is healthy. The external-database banner caused by a `DATABASE_URL` secret is a separate diagnostic and is not, by itself, a reason to delete a working database URL.

**Why:** a prior database-backed scheduler experiment left an empty table in the managed development schema after its application code was no longer present. Publish continued detecting that table as a production schema change, while the database warning was incorrectly treated as the publish blocker.

**How to apply:** inspect the actual Publish schema diff and build/publish logs before changing database secrets. If a reported object is absent from current code, verify it has no data and is truly orphaned before removing it from the managed development schema. Never alter a working runtime database connection as part of that cleanup.