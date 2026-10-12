---
name: Database migration baseline
description: Safe migration handling for a schema that existed before Prisma migration history.
---

Use Prisma's checked-in, non-interactive migration workflow for post-merge setup. Do not run Drizzle push and Prisma push against the same database, and do not automatically accept data-loss warnings.

**Why:** The application schema existed before Prisma migration tracking. An interactive schema push failed in post-merge setup, while `migrate deploy` initially required a baseline. Existing report snapshot structures were verified before marking their migrations applied.

**How to apply:** Keep post-merge setup on `prisma migrate deploy`. If an older environment lacks migration history, verify each claimed structure before baselining it; never blanket-resolve unverified migrations or use `--accept-data-loss` as an automation shortcut.