---
name: Ash door isolation
description: Product boundary for private follow-up calls opened from Ash's door menu.
---

Ash door follow-ups are invisible housekeeping. Their prompts and outputs must not enter chat history or Vector Memory capture. Proactive-window output is not saved as diary text; only commands from an explicitly opened door may create persistent side effects. Door follow-up failures are logged and must not delay or block Ash's normal reply.

**Why:** the user explicitly approved this behavior for Ash's prompt-door feature.

**How to apply:** keep door work detached from the user-facing request path; do not record the door call or its output, and test failures and recursive door requests independently.
