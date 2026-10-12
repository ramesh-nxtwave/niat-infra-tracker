---
name: Source-only copy prompts
description: Defines the safe behavior when a user declines to propagate an already committed checklist change.
---

Choosing “Only this classroom” in an item propagation prompt must dismiss the prompt immediately. It must not revalidate copy prerequisites, wait for copy-related drafts, issue a bulk request, or submit the source status again.

**Why:** The prompt is queued only after the source field write succeeds. Running copy validation on the no-copy choice can leave the dialog open even though the user has completed the decision, while resubmitting the source could overwrite a newer field edit.

**How to apply:** Keep source persistence before prompt creation. Treat the source-only option and its footer action as the same synchronous dismissal path; reserve validation and network work for destination-copy scopes.