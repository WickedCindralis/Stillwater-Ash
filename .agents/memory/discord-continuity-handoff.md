---
name: Discord continuity handoff
description: Privacy and provider-call rules for carrying bounded Stillwater continuity into Discord.
---

Discord continuity must be generated inside an existing private Stillwater provider call so a Discord event never triggers a separate summarization request. The model may emit only fixed allowlisted classifications; the server constructs the persisted summary from those values. Never persist or forward free-form model-authored continuity.

**Why:** A prompt plus keyword filtering cannot prove that free-form text did not paraphrase a screenshot, diary, Notes, Core Anchors, private quotation, or another private source. Fixed enums preserve broad continuity without creating a private-text exfiltration path.

**How to apply:** Strip and validate the continuity block before parsing any other response control. Reject malformed, nested, duplicate, unknown, incomplete, or free-form content. Discord should read the saved server-built summary and make only its normal reply-model call.