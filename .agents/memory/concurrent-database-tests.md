---
name: Concurrent database tests
description: Distinguishing PostgreSQL integration fixture contention from application regressions
---

Database-backed integration fixtures can deadlock when the API test runner executes independent test files concurrently. A deadlock in a full parallel run that passes in isolation and in a serialized full run is fixture contention, not evidence that an application behavior regressed.

**Why:** Parallel test files created photo-history and report fixtures in the same development database; PostgreSQL reported a deadlock, while the affected report tests passed alone and all API tests passed with test-file concurrency limited to one.

**How to apply:** When a full API suite reports a database deadlock, run the affected test independently and use a serialized suite to assess the change. Keep assertions intact; address fixture isolation separately rather than masking production errors.