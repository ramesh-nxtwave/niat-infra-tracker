---
name: Coupled URL filter history
description: Preserving usable browser history when URL-backed filters invalidate dependent selections.
---

When a URL-backed filter change makes a dependent selection invalid, update the filter and clear the selection in one navigation. Automatic cleanup of an externally supplied invalid URL must replace the current history entry rather than push another one.

**Why:** Splitting one user action into a filter navigation followed by a cleanup navigation leaves an incompatible intermediate URL in browser history. Going Back can then trigger cleanup again and trap the user on the newer shortlist.

**How to apply:** Use this rule whenever Reports or another page stores parent filters and dependent selections in query parameters. Cover Back and Forward with a selected dependent value that becomes excluded.