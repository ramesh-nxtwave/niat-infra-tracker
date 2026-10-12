---
name: Manual report confirmation safety
description: Preserve reviewed report content and uncertain delivery outcomes across retries and releases.
---

Treat a reviewed manual email report as an immutable, versioned snapshot. Keep its recipients, rendering contract and provider idempotency key stable across retries and server restarts. Any failure after a provider request begins is an uncertain outcome, not permission to generate a replacement send.

**Why:** Provider acceptance can precede a lost HTTP response or failed local persistence. Rebuilding a report with a new key can duplicate emails; changing rendering or recipients between preview and confirmation can send content the administrator never reviewed.

**How to apply:** Preserve old rendering versions when changing email formats, or reject unsupported snapshot versions before delivery. Let the server recover attempted sends after preview expiry within the provider deduplication window; never let a client-side expiry force an uncertain send onto a new preview. Keep demonstration mode clearly labelled and do not enable live manager delivery without separate approval.

Treat HTML, plain text, and CSV together as the reviewed rendering contract, including coverage warnings. Verify legacy compatibility against fixed output digests rather than only checking that old templates still contain expected headings.

**Why:** Adding room-level missing-data warnings can change CSV rows as well as email markup; a template-only compatibility check can miss changes to reviewed attachments.

**How to apply:** Version every changed output together and retain golden fixtures for supported historical snapshot versions.

Keep dashboard visibility separate from sent-report scope.

Use the dashboard's grouped pending rows as the counting unit for new manual report emails, previews, and exports, while retaining underlying room identities.

**Why:** Counting each classroom separately in email doubled the apparent pendencies compared with the grouped portal and confused recipients. The user explicitly requested the portal's table format for email.

**How to apply:** Keep CR, Lab Room, and Staff Room sections consistent across outputs; do not silently revert email totals to raw room-level records.

**Why:** The user's pending-only request concerned the report being sent, not hiding completed work on the Reports Dashboard. Applying it globally hid expected completed items.

**How to apply:** Preserve Pending and Done on the dashboard and its print view; Send Report remains pending-only. Do not infer dashboard filtering changes from email-format requests.
Retain unresolved provider outcomes until explicitly reconciled, even after deduplication expires. Accepted delivery receipts must outlive the detailed report content; retiring content must never make confirmation eligible to send again.

**Why:** An elapsed recovery window does not prove non-delivery. Full checklist content is unnecessary for long-term duplicate-confirmation protection, but the acceptance identity and original idempotency evidence are essential.

**How to apply:** Cleanup may delete only never-attempted expired previews and compact only settled accepted content after the recovery period. Do not apply a generic age-based deletion rule to attempted reports.

Do not apply Resend's retry policy to Gmail. Gmail message submission has no provider-enforced idempotency key, so an uncertain send must remain blocked until reconciled.

**Why:** A timeout or failed receipt write can occur after Gmail accepted the email. A stable MIME Message-ID does not make a repeated submission safe.

**How to apply:** Bind each preview to its original transport and sender. Only retry Gmail after a proven pre-submission failure; preserve uncertain state across lease expiry, restarts, and provider configuration changes.
