# Extension Tailored Resume and Live Console Design

Date: 2026-08-15
Status: Approved

## Objective

Repair the Chrome extension so it can reliably take ownership of the user's cloud queue, generate and upload a Karjoo tailored resume for every Jobinja application, expose synchronized filters, and provide one live console for the current job, upcoming queue, history, submitted resumes, failures, and retries.

The extension must never fall back to the Jobinja profile resume. If a tailored resume cannot be prepared or uploaded, the application must not be submitted.

## Confirmed Production Failure

For `dev.codedpro@gmail.com`, production inspection showed:

- the execution run was `running` with owner `server`;
- three tasks were leased and 269 tasks remained pending;
- the extension hid Start whenever the server owned the run;
- takeover appeared only when a server run was blocked;
- claimed extension items did not include a tailored resume asset;
- the extension upload executor explicitly skipped file uploads;
- recent applications had persisted `resume_id` values, but the side panel did not expose resume actions.

These are contract and UI defects, not an empty queue.

## Product Rules

- Every extension application requires a persisted per-job Karjoo resume.
- Resume generation, PDF rendering, download, or upload failure pauses the run and returns the task to a recoverable queue state.
- The Jobinja profile resume is never used as a fallback.
- A user may explicitly transfer an active server-owned run to the extension, not only a blocked run.
- One executor owns a run at a time. Takeover atomically changes ownership and releases unfinished server leases.
- Queue, execution progress, filters, and application history remain cloud-authoritative.
- The extension and dashboard edit and display the same filter record.
- Job and resume actions always remain scoped to the authenticated user.

## Architecture

### Control Plane

The Next.js control plane will provide four extension-facing capabilities:

1. A mandatory tailored-resume gate during extension claim.
2. An authenticated PDF asset endpoint for the claimed task's persisted tailored resume.
3. Bearer-compatible filter read/write endpoints and category options.
4. A richer live overview containing current job, queue details, history details, listing links, resume availability, and retry eligibility.

Claim will return a resume descriptor only after verifying that the resume belongs to the same user and listing. The descriptor includes a resume ID, an authenticated download path, and a safe filename. It never contains another user's asset or an arbitrary filesystem path.

### PDF Renderer

An internal renderer converts the existing print-ready tailored-resume HTML to PDF. It is not publicly reachable and accepts requests only from the control plane. The renderer uses Chromium so the PDF matches the current A4 templates, fonts, RTL behavior, and page-break rules.

Generated PDF bytes are returned through the authenticated task asset endpoint with `private, no-store` headers. The endpoint validates the extension Bearer session, task ownership, listing-to-resume relationship, and current task state before rendering or returning bytes.

### Extension Executor

For each claimed task, the service worker performs these stages sequentially:

1. claim task;
2. verify the tailored resume descriptor exists;
3. download PDF bytes through the authenticated API client;
4. open the listing in the user's Jobinja session;
5. verify the real application form is available;
6. send the PDF bytes and filename to the Jobinja content script;
7. construct a browser `File`, assign it to the file input through `DataTransfer`, and dispatch input/change events;
8. verify that the upload control accepted the file;
9. submit and confirm the application;
10. report the result with the exact resume ID already bound server-side.

The extension must not log or persist resume bytes. Bytes live only for the current operation and are discarded after the result.

## Ownership and Recovery

The side panel exposes `Continue with extension` whenever the server owns an active, paused, or blocked run. Takeover performs one atomic server transition:

- assign owner and executor ID to the requesting extension;
- requeue server-leased tasks that have no submitted application;
- clear stale current-task progress;
- preserve completed applications and pending queue order;
- start an immediate extension tick.

Extension leases are also recoverable. A heartbeat timeout or browser restart returns an unfinished leased task to pending. Starting an already-owned extension run releases its own stale lease before claiming again.

## Failure Semantics

- `tailored_resume_missing`: pause, requeue, show Generate/Retry; never open the submit flow.
- `tailored_resume_generation_failed`: pause, retain the error and next retry time.
- `resume_render_failed`: pause and requeue without submitting.
- `resume_download_failed`: pause and requeue without submitting.
- `resume_upload_failed`: pause and requeue without submitting.
- `login_required` or `security_challenge`: block and preserve the queue.
- `form_unavailable`: keep a reviewable failure distinct from already applied.
- `already_applied`: reconcile as submitted/already applied rather than failed.
- selector/site changes: fail visibly with retry support and do not claim additional jobs.

Failed items are not converted directly to terminal task failures when recovery is possible. Retry returns the task to pending, clears its lease, and starts from resume verification.

## Side Panel

The side panel remains a compact operational console with four views controlled by tabs:

### Live

- account and executor owner;
- queued, applied today, applied total, and failed/review counts;
- Start, Pause, Stop, and Continue with extension;
- current job title, company, stage, elapsed time, and Open Job action;
- mandatory `Tailored resume for every job` mode status;
- next queued jobs with status and resume readiness.

### Filters

- Jobinja categories;
- cities;
- full-time and part-time;
- remote-only;
- minimum salary;
- newest/relevance/salary ordering;
- discovery pause;
- daily and weekly limits.

Saving writes the shared cloud filter record and triggers a live refresh. External dashboard changes appear in the extension on the next poll without reload.

### History

- newest-first applied, skipped, and failed entries;
- status, channel, time, company, and failure reason;
- Open Job;
- View Resume when `resume_id` exists;
- Retry for recoverable failures.

### Job Detail

Clicking the current job, queue row, or history row opens an in-panel detail view containing the full available JD, URL, posted date, queue/application state, execution attempts, last error, resume readiness, and relevant actions. The live poll updates the open detail without navigation or manual refresh.

## API Contracts

- `POST /api/apply-queue/claim`: extension-owner claims require a tailored resume and return its descriptor.
- `GET /api/apply-queue/:taskId/resume.pdf`: extension Bearer-authenticated PDF for that user's task and listing.
- `GET/PUT /api/apply/filters`: accept web cookie or extension Bearer authentication.
- `GET /api/boards/jobinja/categories`: accept extension Bearer authentication where required by the panel.
- `GET /api/extension/run`: include complete queue/history metadata needed by the panel, including resume and retry flags.
- `POST /api/extension/run` takeover: allow explicit takeover from any server-owned non-completed state.
- `POST /api/applications/:id/retry`: accept extension Bearer authentication.

No endpoint accepts a client-supplied user ID.

## Synchronization

The panel polls the live overview every two seconds while open. The background executor writes progress before and after every material stage. Filter state is fetched on panel open, after save, and periodically while the Filters tab is visible. Mutations return the updated server representation so the UI does not wait for another poll.

The dashboard and extension continue to use the same execution-run, task, application, resume, and candidate-profile preference records.

## Testing

- Unit-test mandatory resume descriptors and ownership checks.
- Route-test PDF access, cross-user denial, missing resume, and renderer failure.
- Route-test extension Bearer filter GET/PUT and retry.
- Test active server takeover and lease release without duplicate submission.
- Test service-worker stage transitions and pause/requeue behavior for every resume failure.
- DOM-test `File`/`DataTransfer` upload and acceptance verification.
- Test side-panel live, filters, history, detail, resume, retry, empty, blocked, and error states.
- Run root and extension tests, typechecks, lint, production builds, and a packaged-extension smoke test.
- Verify production with `dev.codedpro@gmail.com`: takeover, one tailored-resume upload, live progress, history entry, and resume opening.

## Release

- Publish extension version `0.4.0` with updated description and release notes.
- Build and publish `karjoo-extension.zip`.
- Deploy the internal renderer and control plane before publishing the extension.
- Recover the account's stale leases during takeover, not through destructive queue deletion.
- Existing submitted applications and their archived resumes remain unchanged.
