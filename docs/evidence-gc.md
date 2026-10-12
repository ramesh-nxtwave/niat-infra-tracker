# Evidence object garbage collection

Evidence GC is an operator-controlled, database-coordinated cleanup for
unreferenced checklist evidence. It is intentionally separate from report
preview cleanup and never performs a bucket listing or blanket sweep.

## Safety model

- Only `/objects/uploads/<UUID>` is owned by this collector. Local `/uploads`,
  native/raw GCS bucket URLs (for example
  `https://storage.googleapis.com/<bucket>/uploads/<uuid>`), report-preview
  files, external URLs, and other object namespaces are never candidates.
  Accepted clients must persist the canonical API path; an absolute URL is
  accepted only when its pathname is exactly that canonical path.
- Every upload intent is inserted into `evidence_objects` before its
  presigned URL is returned. The object remains active for at least 30 days,
  including if the browser never completes the upload.
- A global `evidence_object_references` index is maintained by PostgreSQL
  triggers for current checklist photos, photo history/gallery rows,
  `UniversityUpdate.imageUrl` (including JSON-array strings), and paths found
  anywhere in immutable pending report snapshot datasets. A reference in any
  university protects the object.
- References are admitted only while the object is `active`. `deleting` and
  `deleted` are tombstones: late writes fail rather than racing physical
  deletion.
- An unreferenced object is first marked `eligibleAt` while it remains active;
  a new reference clears that timestamp. Physical deletion requires both the
  upload-intent retention (at least 30 days) and 30 additional days after
  `eligibleAt`. This is a recoverable grace period measured from the actual
  last-reference removal, not from object creation.
- A collector transaction first records `eligibleAt` while the object remains
  active. Only a later run, after the grace period, locks the object and
  commits `state=deleting` with a lease before making any storage call. A crash
  leaves that durable tombstone; a later explicit run can retry after the lease
  expires. Physical deletion is idempotent (`404` is success), and completion
  records `state=deleted`.
- After storage IO, the object transition, per-object attempt outcome, and run
  counters commit in one database transaction. A bookkeeping failure leaves the
  object in `deleting` with its claimed attempt and unfinished run, so a later
  explicit run can repeat the idempotent storage delete without falsely
  reporting completion.

## Installation and deploy

The Prisma schema is the source of truth and must be applied with the existing
`db push` workflow:

```bash
cd artifacts/api-server
pnpm run db:generate
pnpm run db:push
pnpm run db:setup-evidence-gc
```

`db:setup-evidence-gc` is idempotent. It takes a PostgreSQL advisory lock,
locks the source tables in `SHARE` mode, installs the trigger
functions/indexes, backfills canonical object rows and references, then enables
the triggers before releasing the source-table lock. API startup runs the same
setup before opening its listening port, so a deployment that has completed
`db push` cannot accept a checklist write before the coordination layer is
installed or during its initial scan.
The post-merge setup script runs it automatically after Prisma `db push`.

## Operator procedure

The API routes require an active administrator JWT:

1. Run a bounded preview:

   ```http
   POST /api/evidence-gc/dry-run
   Content-Type: application/json

   {"retentionDays":30,"limit":100}
   ```

   Save the returned `runId`. The response includes bounded counts of eligible
   objects, newly-unreferenced objects that would receive an `eligibleAt` mark,
   retryable deleting tombstones, reference-protected objects, and the
   limit/retention contract. A dry-run itself does not mark or delete rows; it
   is a count preview, not a frozen candidate manifest.

2. Review the durable run:

   ```http
   GET /api/evidence-gc/runs/<runId>
   ```

3. If the counts and scope are approved, explicitly apply the matching bounded
   policy:

   ```http
   POST /api/evidence-gc/apply
   Content-Type: application/json

   {"dryRunId":"<runId>","retentionDays":30,"limit":100}
   ```

    Apply rejects a missing, expired, consumed, mismatched, or
    actor-mismatched dry-run id. A dry-run is single-use and expires after
    15 minutes. Apply re-evaluates references, leases, and eligibility at apply
    time, so concurrent changes can make the selected rows differ from the
    preview. The maximum batch is 500 objects. There is no scheduler or
    implicit delete path.

4. Inspect the apply run and its per-object outcomes with the run lookup
   endpoint. Failed storage rows remain `deleting`, retain the last error,
   release their lease, and are eligible for a later explicit apply. An
   unexpected reference on a deleting object stops deletion and records an
   error for operator investigation; it never reopens reference admission. If
   the process dies after storage IO but before the database update, the
   original run remains unfinished and its claimed attempt is superseded by a
   later explicit run, which repeats the safe idempotent delete and records the
   tombstone.

Dry-run and apply runs, per-object claims, errors, and final outcomes are
durable in `evidence_gc_runs` and `evidence_gc_attempts`. Do not manually
delete rows from `evidence_objects` or run a storage bucket sweep; tombstones
are part of the concurrency contract and are retained for audit/retry safety.