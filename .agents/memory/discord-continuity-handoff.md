---
name: Discord continuity boundary
description: Privacy rule for keeping Stillwater chat out of Discord model packets and replies.
---

Do not put raw Stillwater chat history into any Discord model packet, including owner DMs. Discord packets may contain Discord calls, selected-channel context, and owner-DM history only in owner DMs. If private continuity is ever reintroduced, it must consist solely of server-built text from fixed allowlisted classifications generated inside an existing private Stillwater call, not free-form or raw chat.

**Why:** An OpenAI request showed a Discord packet containing raw private chat, including temporary integration-test messages. Labeling it “never disclose” did not prevent private text from crossing the provider boundary. A prompt plus keyword filtering cannot prove that free-form text did not paraphrase other private sources.

**How to apply:** Review the outbound Discord model request, not just the Discord reply. Never query private chat while assembling a Discord packet. If a future bounded continuity mechanism is approved, strip and validate its enum block before parsing other response controls and reject malformed, nested, duplicate, unknown, incomplete, or free-form content.