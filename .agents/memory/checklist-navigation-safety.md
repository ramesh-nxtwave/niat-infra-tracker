---
name: Checklist navigation safety
description: Why ambiguous legacy room destinations fail closed and why route integration tests must mount the real app
---

Do not infer a classroom-to-space association from array order, creation time, or a duplicated room label. If authorized detail cannot prove a unique destination for the original checklist-status ID, show a recoverable message instead.

**Why:** Legacy classroom registry records and checklist spaces can share duplicate names without a persisted identity association. Guessing can direct users to edit the wrong classroom. Repairing those records requires a separate, audited data-association change, not a navigation fallback.

**How to apply:** Retain fail-closed behavior until a stable relationship is established; do not relax ambiguous-target checks to make every link appear successful.

Navigation regression tests must include the real application route table, not only a test-specific router.

**Why:** Component tests previously agreed on an invented destination path while the real app redirected it to the university list. Correct href encoding and isolated destination rendering did not establish end-to-end route correctness.

**How to apply:** Keep at least one report-to-detail interaction and direct-load check mounted through the production App routing when changing destination URLs.

Report return navigation should preserve the originating link's viewport position after report data and open source choosers are restored, not just the URL or an absolute scroll offset.

**Why:** Reports fetch again on return, and live row/group heights can change. Restoring while only the loading screen exists clamps the scroll position; restoring an old document offset can land on a different row.

**How to apply:** Keep return positions isolated per browser-history entry and restore once after rows render. Background refreshes must not repeatedly move focus or scrolling.