---
name: Vector Memory cross-artifact imports
description: TypeScript and Vite boundaries when using Vector Memory source from Stillwater artifacts.
---

Keep thin runtime adapters with adjacent declaration files when the API server or dashboard imports source from the Vector Memory package. Direct TypeScript imports make the API server typecheck traverse files outside its `rootDir`; importing the dashboard TSX directly also makes its types resolve from the API package, which does not provide React typings.

**Why:** The Vector Memory package has its own build/type boundary, while Stillwater artifacts enforce separate root and dependency boundaries.

**How to apply:** Bundle the API-side runtime adapter and let Vite resolve the dashboard-side adapter at build time; do not expand the API artifact's typecheck over Vector Memory sources just to satisfy an import.
