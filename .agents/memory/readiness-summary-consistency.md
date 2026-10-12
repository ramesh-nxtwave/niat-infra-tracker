---
name: Readiness summary consistency
description: Keeps university dashboard readiness aligned with checklist changes made concurrently by different users.
---

University dashboard readiness must be derived from live checklist rows in active report spaces. Any persisted readiness summary must be recalculated atomically rather than through a separate read-then-write sequence.

**Why:** Concurrent checklist edits can race: an older calculation may overwrite a newer summary even though every individual status was saved correctly. This caused multiple production university cards to lag behind their live checklist completion.

**How to apply:** Use live-row aggregation for user-facing readiness lists. When maintaining a persisted summary for other consumers, calculate and update it in one database statement inside the single or bulk checklist mutation transaction, serializing changes per university. After a successful checklist edit, refresh the shared university state immediately so Dashboard, Portal summary, Reports, and Master Tracker do not retain the old percentage.