---
name: Replit VM URL change
description: Deployment behavior observed when Stillwater moved from Autoscale to Reserved VM.
---

Switching Stillwater from Autoscale to Reserved VM changed the generated public `replit.app` hostname. The old hostname became an unassigned “This app isn't live yet” address, while the new VM deployment kept the same static frontend, API artifact, run command, port, database-backed app, and Discord/proactive processes. A later check found the active deployment marked `private`, but the available records do not establish that this happened during the VM switch.

**Why:** Replit can issue a different generated hostname when a deployment is republished onto a different target, while visibility is a separate platform control-plane state; neither behavior implies that the application image or source changed.

**How to apply:** Verify deployment type, visibility, and primary URL together. If VM is healthy but mobile browsers are redirected to `replit.com` with `privateDeployment=true`, the failure is the platform access gate, not the app password flow. Use deployment audit history to identify later visibility changes.