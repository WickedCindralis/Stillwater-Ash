---
name: VM native-binary parity
description: Development shell binaries do not establish availability in a published Replit Reserved VM.
---

Do not assume a native executable found on the development agent's PATH will exist in the published Reserved VM. Declare required native tools through the project's Nix dependencies and log executable startup failures rather than collapsing them into a generic media or input error.

**Why:** A CELL speech-to-text upload reached production but failed before the paid provider call at the audio duration check. The development shell could run the duration tool through an agent runtime path while the VM configuration did not declare it; the original probe suppressed the underlying error, preventing confirmation of the precise binary-level cause from the old logs.

**How to apply:** For new server-side native tools, verify their published runtime configuration as well as the local executable; include failure details in server logs without logging user media or credentials.