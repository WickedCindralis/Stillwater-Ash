---
name: Integration-test isolation
description: Why database-backed integration tests must never use a live Stillwater database.
---

Run database-backed integration tests only against a separate disposable database, never the database read by a running Stillwater service.

**Why:** A test that temporarily inserted synthetic private messages and toggled live controls made those messages visible to a concurrent Discord model packet before cleanup. Restoring state afterward does not undo concurrent provider calls or deliveries.

**How to apply:** Require an explicit dedicated test database before running integration suites that touch shared state, chat, capture, or Discord. Unit tests without database writes can run normally.