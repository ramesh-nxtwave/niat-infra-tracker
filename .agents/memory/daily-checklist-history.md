---
name: Daily checklist history
description: Rules for preserving accurate historical university reports across every checklist mutation path.
---

Record a checklist history snapshot only when status, blocker state, timeline, or remark fields genuinely change. On the first such change, preserve the pre-edit state from the checklist row's creation time before appending the edited state and editor identity. Apply the same behavior to single-item and bulk mutations.

**Why:** Checklist saves can resend unchanged rows, and unrelated photo or capacity changes advance the generic update timestamp. Using either as report history falsely marks changes and can make past reports drift.

**How to apply:** Any new checklist mutation path must use no-op-aware history semantics. Done and N/A are both complete everywhere, including readiness calculations and bulk-skip behavior.

Treat report remark provenance as separate from the destination editor's value; never hydrate an editor from aggregate or historical report text.

**Why:** A combined classroom report can include a model note while another classroom is legitimately blank. Historical notes can also differ from current saved text without any data loss.

**How to apply:** Resolve the original status ID against authorized detail before diagnosing missing remarks. Compare raw historical and current values before display-only dated-note extraction.