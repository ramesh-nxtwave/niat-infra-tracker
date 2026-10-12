# Pending work report API contract

This is a separate manual, administrator-only workflow. It does not invoke,
alter, or share recipients with the scheduled report. A preview may select
active universities and recipients; both choices are server-validated and
frozen into its immutable snapshot.

## Default recipients

An empty preview request defaults to these recipients:

1. `Karthik@nxtwave.tech`
2. `Varshith@nxtwave.tech`
3. `podduturi.sumithreddy@nxtwave.co.in`

Clients may submit recipient addresses and selected university IDs only; they
must never submit report HTML, CSV, or checklist data.

## `POST /api/reports/pending/preview`

Requires an admin bearer token. The request body is optional; `{}` preserves
the default recipients and all active universities. It may otherwise be:

```json
{
  "recipients": ["manager@example.edu"],
  "universityIds": ["university-id-a", "university-id-b"]
}
```

`recipients` is a nonempty array of at most 50 valid email addresses when
provided. Values are trimmed and case-insensitively deduplicated; addresses
containing whitespace, CR/LF, or mail-header injection content are rejected.
`universityIds`, when provided, must be a nonempty de-duplicated array of
active university IDs. Every selected ID must exist and be active; missing,
deleted, or invalid selections return `400` rather than being silently
excluded. Its absence means all active universities.

A successful response (`200`) contains a short-lived, server-owned immutable
snapshot:

```json
{
  "previewId": "uuid",
  "expiresAt": "2026-05-15T10:10:00.000Z",
  "generatedAt": "2026-05-15T10:00:00.000Z",
  "scope": { "kind": "selected-universities", "universityCount": 2, "universityIds": ["university-id-a", "university-id-b"] },
  "recipients": ["manager@example.edu"],
  "delivery": {
    "mode": "demonstration",
    "message": "Demonstration mode: confirmation records mocked provider acceptance and sends no email."
  },
  "summary": { "pendingItems": 41, "blockers": 3, "overdue": 8, "universitiesWithoutChecklistData": 2 },
  "universities": [
    {
      "id": "university-id",
      "name": "Example University",
      "checklistDataState": "available",
      "counts": { "pending": 4, "blockers": 1, "overdue": 1 },
      "pendingItems": [
        {
          "id": "status-id",
          "space": "All Classrooms",
          "classroom": "C-101",
          "category": "Electrical",
          "item": "Power outlets",
          "status": "Blocker",
          "isBlocker": true,
          "isOverdue": true,
          "targetDate": "2026-05-01",
          "targetDateSource": "target timeline",
          "remarks": "Awaiting vendor"
        }
      ]
    }
  ],
  "attachment": { "filename": "pending-work-report-2026-05-15.csv", "contentType": "text/csv", "rowCount": 43 }
}
```

`checklistDataState` is `missing` when the university has no live checklist
rows; it must be shown as missing data, never as complete. `pendingItems`
excludes only `Done` and `N/A` rows. Blockers and overdue rows are sorted
first. A missing date, remarks, or classroom is represented as `null`; UI
should present that honestly (for example, “No target date provided”). The CSV
is complete rather than a truncated item list: it also has a row for each
university with no pending work or missing checklist data. Its `rowCount` is
the number of CSV data rows, not just pending items.

The server can be configured in `demonstration` mode (the safe default), which
uses a mock provider and makes no network delivery. The response names that
mode explicitly for each preview. A deployment may use `live` only after the
server-side sender configuration described below is explicitly enabled.

## `POST /api/reports/pending/send`

Requires an admin bearer token. The only accepted body is:

```json
{ "previewId": "uuid", "confirmed": true }
```

`confirmed` must be the boolean `true`. The snapshot must be unexpired and is
sent exactly as previewed. Invalid confirmation is `400`; a missing or expired
snapshot is `410`. Repeating or concurrently submitting the same preview is
idempotent: it returns the same accepted result and does not submit another
provider request.

Snapshots, the immutable structured dataset (version 1 or 2 and SHA-256 integrity
hash), frozen recipient list, delivery mode, stable provider idempotency key,
send lease, and provider-accepted outcome are kept
in PostgreSQL—not process memory. HTML, text, and CSV are deterministically
re-derived from that versioned structured snapshot at send/retry time; rendered
email bytes are not stored. This lets a retry after a server restart or on a
different API instance submit the same provider key and exact reviewed content.
Version 1 snapshots continue to render with their original all-university,
default-recipient contract. New customizable previews are version 2. An unknown
snapshot version or failed hash check is rejected before any provider call
rather than attempting to reinterpret stored data.

If a request loses the provider response, the snapshot is marked **unknown**.
Confirmation retries that exact snapshot only while the provider idempotency
window is valid, including after the preview TTL has elapsed. Once that window
has expired, the API returns `409` and explicitly tells the operator to check
Resend; it will never regenerate or imply a safe new send for that unknown
outcome. Accepted snapshots remain recoverable after expiry and return the
durable accepted result.

After a first send attempt, clients must let the server decide whether a retry
is a safe recovery: they must not block retry solely because their local
`expiresAt` timer has elapsed. An unattempted expired preview remains a `410`
and needs a new preview.

A provider-accepted response is `200`:

```json
{
  "accepted": true,
  "providerId": "provider-message-id",
  "recipients": ["manager@example.edu"],
  "message": "Provider accepted the report request. Inbox delivery is not confirmed.",
  "deliveryMode": "demonstration",
  "auditRecorded": true
}
```

`accepted` means only that the selected provider accepted the request; it does
not claim delivery to any inbox. An audit write failure does not change an
accepted result, and is exposed as `auditRecorded: false`.

Live mode requires all of:

- `PENDING_REPORT_DELIVERY_MODE=live`
- `RESEND_API_KEY`
- `PENDING_REPORT_FROM_EMAIL` set to an address/domain verified in Resend
- `PENDING_REPORT_VERIFIED_SENDER=true`

Configuration or verified-sender errors return `503` with actionable setup
guidance. `onboarding@resend.dev` and test/sandbox sender domains are rejected
for this production path. The schema addition is
`PendingReportSnapshot`; Replit applies the development schema after merge and
the production diff during Publish—do not add a startup/deploy migration
command. `POST /api/reports/send` is retired (`410`) and directs callers to
the preview/confirm workflow; it cannot trigger the scheduler.