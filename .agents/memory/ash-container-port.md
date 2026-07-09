---
name: Ash Container port conventions
description: Decisions made when porting the Ash companion app into the monorepo
---
- The agent-dashboard frontend intentionally bypasses OpenAPI codegen and uses raw fetch (`src/lib/queryClient.ts`), because it is a faithful copy of the user's original client. **Why:** user asked for a faithful, small port of their uploaded project, not a redesign. **How to apply:** extend this app with the same raw-fetch pattern; don't migrate it to generated hooks unless asked.
- Ash's persona/prompt files are the user's personal creative content. **Why:** this is a companion app with an established character ("Ash Cindralis", user addressed as "Wicked"). **How to apply:** never rewrite persona text, prompts, or in-app copy tone without explicit request.
- gpt-5.x chat models reject `temperature`; the bridge maintains a NO_TEMPERATURE_MODELS allowlist.
