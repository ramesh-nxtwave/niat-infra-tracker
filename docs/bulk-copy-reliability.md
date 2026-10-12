# Bulk-copy reliability evidence

## Scope and safety

This note records API-level evidence for Task #92. The development checks use
throwaway universities, users, classrooms, spaces, checklist rows, evidence
paths, and history records. The fixtures are removed by their test cleanup
hooks. No production university, classroom, checklist row, evidence object, or
history record was written.

The API checks intentionally exercise the whole-classroom contract: each
update names its source status, destination classrooms, destination spaces, and
destination status rows. This is different from the older `spaceIds`-only
contract, which remains covered by the existing large-bulk test.

## Published incident baseline (scoped observation)

The production read-only log review found the reported failure:

- Reference **1151**, at `2026-09-12T11:12:51.766Z`, was a `POST
  status/bulk` on autoscale PID 19. Prisma reported `P2028 Transaction
  already closed`; the transaction timeout was **5,000 ms** and **5,028 ms**
  had elapsed since transaction start. The request response time was **5,115
  ms**.
- Earlier reference **1147** showed the same P2028 class and a **5,116 ms**
  response time.
- The active autoscale deployment metadata reported a successful public
  deployment at <https://niatinfratracker.replit.app>.

These observations establish that the published request crossed the interactive
transaction execution deadline. They do **not** distinguish time spent waiting
for the university/row lock from time spent validating, copying, and writing
the requested rows. The references and deployment URL are retained only to
scope the observation; no university identifiers are reproduced here. The
published behavior was not mutated or replayed against production.

## Development measurements

The following measurements were taken with the API route and test fixtures in
the workspace after the backend route changes were present:

| Fixture | Result | Measured time |
| --- | --- | ---: |
| 8 checklist items × 10 classroom destinations (80 explicit targets), with a photo and history assertion for every target | HTTP 200; all 80 acknowledged and persisted; reload and identical retry were successful | **562.4 ms** end-to-end |
| Same large copy's server timing | Transaction 516 ms; transaction work 510 ms | **516 ms** |
| 3 checklist items × 4 destinations (12 targets), with one target row deliberately held by a development-only transaction beyond the 5-second budget | HTTP 503 `CHECKLIST_SAVE_BUSY`; all rows/history/readiness/audit state remained unchanged; retry after release committed all 12 | **5,472.1 ms** end-to-end; server transaction 5,429 ms, work 5,411 ms |

### Direct before/after harness

To compare the route itself rather than compare separate fixture shapes, a
temporary detached worktree checked out the task-base route from `HEAD`
(`18a20ff`, before the uncommitted route optimization). A temporary harness
created the same synthetic 8-item × 10-destination fixture and sent the same
80-target evidence-copy body to that route. It then ran once against the
workspace route and counted Prisma delegate operations inside the interactive
transaction. The harness and worktree were removed after the measurement.

| Route | Result | Transaction delegate calls | End-to-end time |
| --- | --- | ---: | ---: |
| Task-base route from detached `HEAD` | HTTP 200; 80 targets applied | **74** | **467.3 ms** |
| Workspace optimized route | HTTP 200; 80 targets applied | **25** | **133.4 ms** |

On this focused run the optimized route removed **49 transaction delegate
calls (66.2%)** and reduced elapsed time by **333.9 ms (71.4%)**. The call
counter is a harness-level count of Prisma delegate method invocations, not a
wire-level SQL statement count. The timings are one development run and are
subject to database/cache and host load; they support the direction and
mechanism of the reduction, not a production latency SLO.

The blocked-row fixture is a controlled reproduction of the P2028 deadline
class, not a claim that the optimized copy still takes five seconds for normal
work. It is useful because it verifies the failure contract: a busy response
does not partially commit the other destinations, and an explicit retry is
safe. It also demonstrates why the published timing alone cannot classify lock
wait versus transaction work.

The 562.4 ms result is local development evidence for the optimized workload
and is not a production performance or deployment claim. The production
references above remain the baseline for the affected published behavior until
the active deployment is independently exercised and its diagnostics correlate
the two timing components.

## API regression coverage

`artifacts/api-server/src/routes/universities.status.test.ts` now includes
isolated API regressions for:

- multi-item, multi-destination whole-classroom copies with exact
  per-target `statusId`, `classroomId`, `spaceId`, and `outcome` acknowledgements;
- large copies that carry evidence to every target, preserve evidence history,
  survive a university reload, and do not add history on an identical retry;
- `skipDone`, including preservation of the completed target's remark,
  evidence, and history, plus exact applied/skipped acknowledgement;
- a transaction deadline failure that rolls back every target, readiness
  recalculation, audit record, checklist history row, and photo-history row,
  followed by a retry with no duplicate history;
- overlapping single and classroom saves, with complete committed rows and
  one history snapshot per committed write;
- legacy same-target sequences whose remarks are `A → B → A` or `A → B → C`,
  rejected with `CHECKLIST_BULK_TARGET_STATUS_DUPLICATE` before either update
  can write;
- explicit source-as-destination requests, rejected with
  `CHECKLIST_BULK_SOURCE_TARGET_OVERLAP` while source, unrelated targets,
  readiness, audit, and history remain unchanged;
- existing authorization, source-snapshot, foreign-destination, ambiguous
  association, no-op, and exact-status tests in the same API file.

The initial locally run API test invocation completed with **12 tests passed,
0 failed** before the follow-up validation cases were added. It included the
full status test file and emitted the measurements above. The API test suite
does not assert that a deployed production request has been fixed; deployment
verification remains a separate check.

After the lock-cleanup and resolved-target validation additions, the focused
follow-up invocation ran five relevant tests: **5 passed, 0 failed**. It
covered the previous-row lock holder, the timed-out rollback, overlapping
single/bulk saves, both legacy duplicate sequences, and source/target overlap.
Fixture cleanup now releases any held transaction before closing the server or
deleting its university, including assertion-failure cleanup.

## Interpretation and remaining verification

The local evidence supports these conclusions:

1. The optimized route handles a representative large explicit copy well
   below the previously observed 5-second transaction deadline.
2. Atomic rollback, evidence/history consistency, skip-Done behavior, exact
   acknowledgements, reload persistence, authorization boundaries, and retry
   idempotence are covered against synthetic data.
3. A transaction that is intentionally blocked beyond its execution budget
   still returns structured busy guidance and leaves no partial mutation.

It does **not** prove that reference 1151 is fixed in the public deployment or
that the published incident's lock/work split has been identified. Confirming
the deployed build, repeating a representative request with synthetic
development data, and comparing admission wait, lock wait, and transaction
work timings are still required before publishing a production reliability
claim.