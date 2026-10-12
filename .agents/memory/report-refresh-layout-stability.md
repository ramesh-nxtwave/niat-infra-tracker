---
name: Report refresh layout stability
description: Prevents automatic or manual report refreshes from shifting the visible report.
---

Keep all routine refresh feedback outside normal document flow. This includes readiness messages and loading states from secondary requests such as report history, not only the primary report spinner. Existing report content must stay mounted while it is revalidated.

**Why:** A secondary print-readiness message briefly appeared above the report filters on each refresh. Although the primary spinner was already non-layout, that independent message still pushed the full report down and back up.

**How to apply:** When adding or changing any report refresh dependency, verify every state transition triggered by the refresh. Announce transient readiness changes through an existing fixed-size slot or screen-reader-only status, and disable affected actions without inserting temporary rows above the report.

Capture a reading anchor immediately before committing a response, not when starting its request. Custom reconciliation anchoring and the browser's native anchoring must have a single owner within the report.

**Why:** A reader may intentionally scroll while a request is pending. Restoring a request-start position would undo that movement. Native anchoring can also apply a second adjustment after a custom layout-effect correction, displacing the supposedly preserved row.

**How to apply:** Scope corrections to the same university and filters, capture the current visible identity at commit, and use surviving visible anchors if a row is removed. Suppress native anchoring only in the owned report subtree; do not schedule later corrections that can fight user input.