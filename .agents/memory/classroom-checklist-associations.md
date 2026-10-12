---
name: Classroom checklist associations
description: Safety rules for linking classroom registry rows to checklist spaces.
---

Treat a persisted classroom-to-space association as authoritative. For legacy rows with no persisted link, allow only an exact-one normalized-name match on both active registry rows and active classroom spaces; otherwise fail closed and require an explicit administrator choice.

**Why:** Repeated room deletion and recreation can leave several active checklist spaces with the same display name. Choosing by array order or creation time can expose or overwrite the wrong statuses and evidence, while treating every nullable rollout link as broken would hide valid legacy checklists.

**How to apply:** Association repair must select an existing active same-university classroom space without recreating checklist rows or deleting history/media. Bulk-copy validation and UI normalization must honor the same persisted-link-first rule.