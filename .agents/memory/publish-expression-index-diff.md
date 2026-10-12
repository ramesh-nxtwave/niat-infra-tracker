---
name: Publish expression-index diff
description: Verified mismatch between a valid PostgreSQL expression index and generated publish SQL.
---
Treat generated migration SQL as independently fallible even when the development schema is valid.

**Why:** Comparing development and read-only production catalogs and recomputing the publish diff reproduced truncation inside the quoted CASE expression of an MD5 remark-history index. The source index was valid; the generated CREATE INDEX was not.

**How to apply:** Compare pg_indexes definitions with the fresh publish diff before changing report semantics or retrying unchanged. Any workaround belongs in development and the schema source, not production or startup DDL. Verify the recomputed diff after a workaround; do not assume all expression indexes fail.

Prefer the existing plain status/date index for now rather than reintroducing the CASE/MD5 expression index.

**Why:** The user approved removing that optional optimization to unblock publishing, accepting potentially slower large-history lookups without changing report results. Recomputed publish SQL no longer contained the malformed expression, and report integration checks passed.

**How to apply:** Any future remark-history optimization must preserve NULL/empty-string distinctions and pass a freshly computed publish diff before being considered ready.