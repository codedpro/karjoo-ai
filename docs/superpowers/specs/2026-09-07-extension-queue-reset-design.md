# Extension Queue Reset and Re-search

## Goal

Add one explicit extension action that discards stale unfinished queue work and immediately rebuilds the queue from the user's current saved filters across enabled providers. Application history and uncertain submissions must never be erased.

## User Experience

The queue toolbar gains a destructive secondary action labelled `پاک‌سازی صف و جست‌وجوی دوباره`. Clicking it opens a native confirmation that states the pending-work count and explains that submitted history and items awaiting provider verification remain intact. While the operation runs, both search buttons are disabled. Success reports how many tasks were removed and starts fresh discovery; failure leaves the run paused and presents a retryable error.

## Server Contract

Add an extension bearer-authenticated reset endpoint. In one database transaction it:

1. Verifies that the requesting extension may take ownership of the user's run.
2. Pauses the run and invalidates active extension or server ownership.
3. Deletes only `pending`, `leased`, and retryable failed/dead task rows belonging to that user. It never deletes `verifying` or `succeeded` tasks and never deletes application, board-history, listing, resume, or audit rows.
4. Resets per-provider discovery cursors and last-discovery progress so enabled providers restart from their first current page while retaining saved filters and the 45-day provider-fetch boundary.
5. Returns the removed count and per-provider counts in a state that the requesting extension can immediately reclaim.

The endpoint is idempotent. Repeating it after a completed reset removes zero additional tasks and remains safe.

## Extension Flow

The background worker exposes one `RESET_QUEUE_AND_REDISCOVER` message. It calls the reset endpoint, aborts any local cycle generation, takes extension ownership, and invokes the existing forced auto-apply tick. Forced discovery bypasses the ordinary queue-depth and ten-minute discovery gates but retains provider deadlines, enabled-provider checks, saved filters, and the 45-day maximum fetch age.

The popup refreshes queue and run views after the request. It does not claim queue items merely to display them.

## Failure Recovery

Recent application failures are handled by evidence class:

- Jobinja post-submit channel closures remain `verifying` until exact provider history resolves them.
- Provider failures known to happen before submission may be reset to pending.
- e-estekhdam file-limit recovery reads deletion controls from the authenticated `/panel/files` page, preserves CSRF/form fields, deletes the account's stored application PDFs, and re-lists `/search-api/ats/cvs` after every action. A response code without disappearance from the list is not success.
- Already-applied responses become submitted only with provider proof. Unavailable or manual-only jobs become skipped rather than looping.

The reset endpoint itself does not reinterpret application outcomes. A separately allowlisted reconciliation handles recent known failure signatures so queue deletion cannot accidentally rewrite history.

## Testing and Release

Tests cover user isolation, task-status scope, verification/history preservation, lease release, cursor reset, idempotency, bearer authentication, extension message handling, duplicate-click prevention, confirmation cancellation, forced discovery, and provider cleanup verification. Release requires full web and extension tests, both type checks, extension build and ZIP/version parity, blue-green deployment, live route/asset checks, and a dry-run followed by an audited recent-failure reconciliation.
