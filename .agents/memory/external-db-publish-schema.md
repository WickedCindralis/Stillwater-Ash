---
name: External database publishing schema
description: How stale Replit-managed development schema can interfere with publishing an app that intentionally uses an external database
---

When the runtime intentionally uses an external `DATABASE_URL`, Replit's managed development database can still contribute a schema diff to the Publish flow. An orphaned, unused managed-development table may therefore block publishing even though the external runtime database is healthy.

**Why:** a prior database-backed scheduler experiment left an empty table in the managed development schema after its application code was no longer present. Publish continued detecting that table as a production schema change.

**How to apply:** inspect the Publish schema diff before blaming the external-database banner. If a reported object is absent from current code, verify it has no data and is truly orphaned before removing it from the managed development schema. Never alter the external database as part of that cleanup.