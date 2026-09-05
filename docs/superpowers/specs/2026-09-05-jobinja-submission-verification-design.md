# Jobinja Submission Verification Design

Date: 2026-09-05
Status: approved for implementation

## Problem

Jobinja does not consistently leave a success flash or remove its apply form after a valid
submission. The extension currently clicks submit, waits for a narrow set of DOM signals, and
records `jobinja_submission_unconfirmed` as a failure when none appears. This makes successful
applications look failed and makes a retry capable of submitting a duplicate.

Production data for the affected account contains 64 current unconfirmed attempts and 669 older
records bulk-corrected to unconfirmed. Jobinja history was last synchronized on 2026-08-31, so it
cannot currently settle attempts made after that time.

## Approaches Considered

1. **Explicit verification lifecycle (chosen).** Add `verifying` states, reconcile against the
   provider's application history, and permit retry only after an authoritative negative check.
   This is accurate and duplicate-safe, at the cost of a schema migration and UI updates.
2. **Keep `failed`, then reconcile later.** Smaller schema change, but the UI remains false while
   verification is pending and existing retry paths remain dangerous.
3. **Treat every submit click as success.** Avoids visible failures but recreates the original
   false-success problem and cannot distinguish provider validation errors from accepted requests.

## State Model

Add `verifying` to both application and task statuses.

- A provider-confirmed submission is `applications.status = submitted` and
  `tasks.status = succeeded`.
- A submit whose provider outcome is not yet observable is
  `applications.status = verifying` and `tasks.status = verifying`.
- A completed provider-history scan that contains the job promotes it to `submitted` with proof.
- A completed provider-history scan covering the attempt time but not containing the job changes
  it to `failed` and returns its task to `pending`, making it retryable.
- An unavailable, expired, partial, or blocked history scan leaves the item `verifying`. Absence
  from an incomplete scan is never evidence of failure.

`verifying` tasks are not claimable and do not consume submission quota until promoted to
`submitted`.

## Extension Flow

The Jobinja executor will use a board-specific outcome detector after the final click:

1. Reject explicit negative validation/error messages before testing positive text.
2. Accept existing durable DOM signals: positive flash, submitted text, already-applied text, or
   removal of the apply form/button.
3. If the DOM remains ambiguous, fetch Jobinja's authenticated `/jobs/applied` history from the
   same browser session and match the job identifier parsed from `/jobs/{jobId}`.
4. Report `submitted` with an allowlisted `application_history` proof when found.
5. Report `verifying` when history cannot be fetched or does not provide a complete time window.
6. Report `failed` only for explicit provider rejection, missing required form controls, upload
   failure, authentication failure, or a completed negative history check.

The result payload remains secret-free. It may carry provider, signal, normalized job identifier,
and check timestamp, but never cookies, tokens, response bodies, or resume contents.

## Server Reconciliation

Jobinja application-history ingestion will reconcile `verifying` records after every extension
push or server-vault sync. Matching uses the normalized Jobinja job identifier from the listing and
history URLs; the history application's own `externalId` is a different identifier and is not used
as the job match key.

The synchronizer continues to obey the existing 45-day provider-read boundary: stored history is
kept forever, while no provider pages older than 45 days are requested. A sync records whether it
successfully covered the full required window. Only a successful complete scan can produce a
negative result.

Reconciliation writes structured proof and an audit event for every transition. Re-running it is
idempotent.

## Existing Data Repair

After deployment:

1. Move all Jobinja records whose reason starts with `jobinja_submission_unconfirmed` into
   `verifying`, including the 669 bulk-corrected historical rows.
2. Run an authenticated Jobinja history sync for the affected account through the 45-day boundary.
3. Promote exact job-ID matches to `submitted` with `application_history` proof.
4. Requeue only unmatched attempts whose timestamps are covered by the completed scan.
5. Leave older or otherwise uncovered attempts as `verifying`; expose a manual provider check,
   never a blind retry.

No record is deleted.

## UI

Dashboard and extension history display `در حال بررسی` for `verifying`, not `ناموفق`. These rows
show the provider-check time/status and do not expose the retry action. Confirmed rows display the
normal submitted state. Completed negative checks become failed rows with the existing retry
action.

## Testing And Release

- Unit tests cover positive and negative Persian messages, delayed DOM mutation, history matches,
  partial-history behavior, and secret-free proof payloads.
- Queue tests cover every state transition, idempotency, quota behavior, and retry eligibility.
- Reconciliation tests prove matching by Jobinja job ID rather than application ID or title.
- Migration tests verify enum values and preserve all existing records.
- A dry-run report shows counts for confirmed, negative, and unresolved records before repair.
- Release the server first, then extension, run reconciliation, and verify the QA Engineer example
  plus aggregate counts in production.

