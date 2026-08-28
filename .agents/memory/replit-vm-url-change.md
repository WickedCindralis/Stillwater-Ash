---
name: Replit VM URL change
description: Deployment behavior observed when Stillwater moved from Autoscale to Reserved VM.
---

Switching Stillwater from Autoscale to Reserved VM changed the generated public `replit.app` hostname. The old hostname became an unassigned “This app isn't live yet” address, while the new VM deployment kept the same static frontend, API artifact, run command, port, database-backed app, and Discord/proactive processes.

**Why:** Replit can issue a different generated hostname when a deployment is republished onto a different target; the URL change does not imply the application image or source changed.

**How to apply:** Verify deployment type and primary URL together, then check `/api/healthz`, frontend root, and startup logs before diagnosing a URL change as an app failure.