---
name: Replit VM URL change
description: Deployment behavior observed when Stillwater moved from Autoscale to Reserved VM.
---

Switching Stillwater from Autoscale to Reserved VM changed the generated public `replit.app` hostname. The old hostname became an unassigned “This app isn't live yet” address, while the new VM deployment kept the same static frontend, API artifact, run command, port, database-backed app, and Discord/proactive processes. The VM republish also produced an active deployment whose platform visibility was `private`, even though no visibility setting exists in the application source or artifact configuration.

**Why:** Replit can issue a different generated hostname and carry a different access mode when a deployment is republished onto a different target; neither behavior implies that the application image or source changed.

**How to apply:** Verify deployment type, visibility, and primary URL together. If VM is healthy but mobile browsers are redirected to `replit.com` with `privateDeployment=true`, the failure is the platform access gate, not the app password flow.