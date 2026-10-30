---
name: Database export through CodeExecution
description: Exporting full read-only SQL results into workspace files via CodeExecution.
---

When exporting SQL results through CodeExecution, encode each JSON aggregate as base64 in SQL, join all wrapped output lines after the header, and decode with Node's Buffer inside a small `"use impure"` helper. Durable scope may not provide `atob` or `TextDecoder`.

**Why:** large SQL result cells can be line-wrapped, and the durable JavaScript runtime omits common decoding globals.

**How to apply:** keep `executeSql` and `writeFile` in durable scope, pass only the encoded string into the impure decoder, and report counts/bytes rather than logging exported private content.
