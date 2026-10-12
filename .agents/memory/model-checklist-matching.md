---
name: Model checklist matching
description: Why model template copies require conservative cross-module matching.
---

Match model-to-ordinary checklist items only by a unique normalized category and name on both sides; preserve exact-ID matching for ordinary-to-ordinary copies.

**Why:** Model and ordinary checklist modules have independently seeded IDs even when they describe identical work. Same-ID synthetic fixtures concealed a complete failure of real model copying. Renaming or ambiguous duplicate items must block copying rather than guess or create destination rows.

**How to apply:** Exercise distinct source and destination checklist IDs in model-copy regression fixtures. Validate semantic matches against persisted rows on the server, not just client labels, and keep model storage identity separate from its location in classroom navigation.

Offer destination confirmation after a model photo upload or checklist remark is successfully saved, not only after the whole checklist Save button.

**Why:** Users expect these independently persisted edits to prompt for propagation immediately; requiring a second manual save made the copy feature appear absent.

**How to apply:** Default the prompt to the field just saved, never status. Retain the explicit destination confirmation and pending-work safeguards.