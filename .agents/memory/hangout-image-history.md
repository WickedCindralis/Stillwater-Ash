---
name: Hangout image history
description: User-defined rules for retaining chat images and associating Hangout screenshots with replies.
---

In Hangout, save the screenshot on Ash's reply message, not as a separate image-only message. If Ash does not return a reply, do not add that screenshot to message history. Do not delete or rewrite existing image-only entries. Record saved images in Activity with the image type: `upload`, `generated`, or `screenshot`.

**Why:** The user explicitly requires one screenshot plus Ash's reply to form one history message, while preserving all pre-existing history.

**How to apply:** Only persist a Hangout screenshot together with a non-empty successful reply. Keep historical message rows unchanged, and add the corresponding type-coded Activity event when saving an image to chat history.
