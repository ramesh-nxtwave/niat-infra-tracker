---
name: Prisma generated-client drift
description: A missing-column error may come from a generated client that no longer matches the checked-in schema
---

Compare Prisma's generated schema with the checked-in schema before treating a development missing-column error as evidence that the database needs a migration.

**Why:** The generated client in the workspace dependencies has contained a field absent from the current source schema, causing otherwise unchanged authorized university detail queries to fail. Regenerating from the current source schema restored reads without any database change.

**How to apply:** When a Prisma query reports an unexpected missing column, verify source/client agreement first. Do not add the column to live or development data just to satisfy a stale generated client.