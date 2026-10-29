---
name: Memory dashboard authentication
description: Stillwater's memory dashboard must not require a second login or expose its module admin token.
---

The Stillwater memory dashboard uses the same authenticated app session as the rest of Stillwater. Do not ask users to enter or store a separate memory admin token in the browser; keep that token server-side and authorize its use only after the app session is authenticated.

**Why:** The user explicitly said the memory system does not need a separate login in Stillwater.

**How to apply:** Keep the memory dashboard behind Stillwater's normal login and enforce session authentication before proxying memory API requests.
