---
name: Shared evidence retention
description: Why classroom evidence copies retain underlying objects when gallery entries are removed.
---

Treat copied evidence as shared references, not independently owned files. Removing a gallery entry may remove its database reference but must not immediately delete the storage object.

**Why:** A reference scan followed by asynchronous deletion has a race: a new copy can reference the object after the scan and before deletion, breaking saved evidence. University-scoped locks alone do not protect cross-university object references.

**How to apply:** Do not restore best-effort physical deletion based on a prior zero-reference count. Coordinate all reference admission with garbage collection across universities. Current evidence fields remain authoritative when history timestamps tie.

Deletion admission must remain irreversible after storage IO may have begun; recoverability belongs to the eligibility grace period, not to a failed deletion attempt.

**Why:** A storage timeout does not prove the object survived. Reopening reference admission after a timeout could save a copy whose bytes were already deleted. Saved report datasets and JSON-array university updates also retain evidence independently of classroom galleries.

**How to apply:** Retry uncertain physical deletions idempotently without reviving the object. Keep conservative report pins until their owning snapshots are removed, independently of report-preview retention.