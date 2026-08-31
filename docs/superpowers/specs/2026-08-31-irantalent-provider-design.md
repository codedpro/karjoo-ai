# IranTalent Provider and Session Reconciliation Design

## Scope

Release IranTalent as a production provider in Karjoo's browser extension and fix provider connection status for every active provider. IranTalent must support category-based discovery, the global 45-day posting-age limit, tailored PDF generation, authenticated browser-session application, live queue progress, retries, and application history.

The active provider set becomes Jobinja, JobVision, e-estekhdam, and IranTalent. Credentials supplied for validation are never written to source code, logs, fixtures, documentation, Karjoo storage, or server-side account records.

## Architecture

IranTalent uses a hybrid extension adapter:

- Public job discovery reads IranTalent's public SSR/API data through the user's browser and normalizes it into `BrowserDiscoveredListing` records.
- Authenticated identity, CV attachment management, and application submission run inside the logged-in IranTalent browser origin.
- Karjoo stores only connection metadata. Provider credentials and raw browser authentication values remain outside normal Karjoo APIs.
- The server remains authoritative for provider enablement, queue order, tailored-resume artifacts, and history.

Server workers must not execute IranTalent initially. IranTalent claims are extension-only until its session and application behavior has proven stable without CAPTCHA or IP intervention.

## Provider Session Reconciliation

The provider manager will stop treating guessed cookie or local-storage key names as the final login decision. Each active provider gets a board-specific authenticated identity probe that returns only:

- whether the browser session is authenticated;
- an optional non-secret account label;
- a bounded reason such as `no_tab`, `logged_out`, `security_challenge`, or `probe_unavailable`.

When a local authenticated user is found, the extension automatically reconciles the Karjoo board-account metadata to `connected`. This read-and-reconcile flow must be idempotent. Reconnect opens or focuses the provider site, polls while the panel remains open, and updates without requiring a second click.

The UI distinguishes checking, connected, paused, disconnected-from-Karjoo, logged out, no open tab, and security intervention. Disconnect changes Karjoo metadata and provider enablement only; it never deletes provider cookies, local storage, or the provider's own session.

## IranTalent Discovery

IranTalent is added to the versioned board-filter contract, catalog API, extension discovery configuration, filter UI, provider manager, queue labels, and history filter.

Discovery requirements:

- use IranTalent category, city, employment-type, work-mode, and sort options where the site supports them;
- cap accepted postings at 45 days and process newest first;
- preserve the site job id, canonical URL, title, company, city, description, posting time, gender restrictions, and already-applied state;
- stop pagination only when the oldest result crosses the date boundary or no next page exists;
- avoid AI scoring and job-fit explanations during discovery;
- exclude jobs that are closed, already applied, gender-incompatible, redirected off-site, or missing an actionable IranTalent application flow.

## Tailored PDF and Application

Every IranTalent queue item requires a tailored PDF before it can be claimed. There is no fallback to the base profile resume.

Application execution is strictly serial per user and provider:

1. Confirm the IranTalent browser identity and actionable job state.
2. Download the tailored PDF already associated with the queue task.
3. Prefer a per-application attachment input when the live flow provides one.
4. Otherwise replace the user's account-level IranTalent CV attachment with the tailored PDF.
5. Verify the displayed attachment filename or returned attachment identifier matches the current task.
6. Submit the application.
7. Verify a success response, applied state, or application-history record before reporting `submitted`.
8. Close extension-created job tabs after terminal success, skip, or recoverable failure.

No second IranTalent task may begin attachment replacement until the previous task has reached a terminal result. If attachment verification is unavailable, the task fails closed and remains retryable.

## Queue and Ownership

IranTalent participates in the same provider enablement gate as the other boards. Pause or Karjoo disconnect prevents discovery, resume preparation, and new claims while preserving pending tasks and generated artifacts.

IranTalent is extension-only in this release. A server-owned run skips IranTalent tasks without leasing them. The extension can continue processing other enabled providers. Security challenges block IranTalent, notify the user, preserve the queue, and do not consume another tailored-resume generation.

## Error Handling

Errors are classified as:

- `login_required`: local session is absent or expired;
- `security_challenge`: CAPTCHA or provider security intervention;
- `job_unavailable`: closed, removed, redirected, or already applied;
- `resume_missing`: tailored PDF cannot be downloaded;
- `resume_upload_failed`: IranTalent did not accept the PDF;
- `resume_verification_failed`: active attachment cannot be tied to the current task;
- `submission_unconfirmed`: submit ran but no durable proof was observed;
- `provider_changed`: selectors or API contracts no longer match.

Login and security errors block IranTalent until local recovery. Upload and transient network failures are retryable with bounded backoff. Closed and already-applied jobs become terminal skips. Submitted status is never inferred from a click alone.

## Validation and Tests

Implementation includes:

- pure tests for IranTalent discovery parsing, pagination, filtering, and date limits;
- fixture tests for profile/session identity mapping and application-state parsing;
- apply-executor tests for per-job upload, serialized account-level replacement, proof verification, already-applied handling, CAPTCHA blocking, and tab cleanup;
- provider-manager tests for automatic reconciliation and accurate status transitions on all active providers;
- server tests for four-provider filter parsing, enabled-board queue gates, extension-only IranTalent ownership, and tailored-PDF requirements;
- live validation against the supplied IranTalent account without exposing credentials or applying to an unintended job;
- extension typecheck, complete extension tests, complete application tests, production build, narrow-panel visual smoke tests, ZIP manifest/hash verification, deployment, and live version-endpoint verification.

## Release

The release increments the extension minor version, updates the dashboard release notes, republishes `karjoo-extension.zip`, and restarts the production web service. IranTalent is shown as active only after discovery, session reconciliation, tailored attachment, and application proof checks pass.
