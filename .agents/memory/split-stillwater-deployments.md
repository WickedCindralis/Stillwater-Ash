---
name: Split Stillwater deployments
description: Distinguishes the Replit-published Stillwater app and database from its separate NorthFlank deployment.
---

As verified on 2026-10-03, `stillwater-ash.replit.app` is a Replit Reserved VM deployment using Replit-managed production PostgreSQL through runtime-managed database variables. The production Replit database contains the app's `ash_*` schema. A separate NorthFlank service uses NorthFlank-managed PostgreSQL through that service's `DATABASE_URL`; these are not interchangeable targets.

**Why:** the same Stillwater codebase is deployed on both platforms, and each uses `DATABASE_URL`, so assuming they share a database can lead to checking or changing the wrong environment.

**How to apply:** identify the requested deployment by its platform/URL before investigating live data. Re-check Replit deployment metadata when needed, and use the database tooling for the correct provider.