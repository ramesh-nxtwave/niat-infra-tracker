---
name: Checklist transaction admission
description: Why checklist concurrency must be limited before acquiring database transactions, not only inside them.
---

Limit concurrent checklist mutations before starting their transactions, while retaining the database university lock for cross-instance correctness.

**Why:** A reproduced burst of valid saves exhausted transaction admission because transactions occupied connections while waiting on the same university lock. Live logs showed the same Prisma P2028 failure class. Increasing timeouts alone does not address this pressure, and a bounded manual-save loop alone does not cover autosaves or older published clients.

**How to apply:** Include single-item and bulk writers in admission control. Keep readiness, required evidence history, and checklist history atomic with the mutation. When diagnosing recurrence, compare the actual published client with the workspace before assuming merged save fixes are live.

Distinguish transaction admission, database lock waiting, and transaction execution when diagnosing P2028; a numeric request reference is scoped to a process and time, not globally unique.

**Why:** A later published bulk-copy incident hit an already-open transaction's five-second execution deadline, despite pre-transaction admission working. The same error code had previously described pool pressure.

**How to apply:** Correlate timestamp and request route with bounded timing diagnostics before choosing a remedy; do not infer a classroom-association fault or raise all transaction timeouts from the error code alone.

Reject overlapping resolved destinations or source/destination overlap before applying a batch planned from a single snapshot.

**Why:** Grouping writes cannot preserve sequential A→B→A intent when both plans were derived from A; it also corrupts initial-history semantics.

**How to apply:** Preserve request-wide conflict validation when optimizing batch queries, including legacy callers that omit explicit destination status IDs.