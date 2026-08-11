# Extension Queue Executor Design

Date: 2026-08-11
Status: Approved

## Objective

Refine the existing Chrome MV3 extension into a free, persistent browser executor for the same cloud-authoritative application queue used by the server worker. The extension discovers and applies through the user's authenticated browser session and IP, keeps running while Chrome is open even when its UI is closed, and presents live progress in a Chrome side panel.

The server worker remains optional. Only one executor may own an account's run at a time. If the server encounters a board security challenge, it must stop immediately, release uncompleted work, preserve the queue, avoid AI generation, notify the user, and offer one-click extension takeover.

## Product Rules

- The default extension run is free and uses the resume already selected in the user's board profile.
- Free runs do not generate a tailored resume, cover letter, JD summary, match explanation, or AI score.
- Extension execution has no product daily or weekly application cap and no fixed artificial delay. It is sequential and waits for a board result before advancing.
- Cloud filters remain authoritative. Discovery runs through the extension's local board session, includes all matching pages, excludes listings older than 45 days, and orders jobs newest first.
- Paid tailored resumes remain an explicit optional mode and are generated only after the executor verifies that the live application form is accessible.
- Jobinja's visible bulk-apply UI may be used when capability detection confirms it on an authenticated page. The extension must not depend on undocumented private endpoints.
- Chrome must remain open. The side panel may be closed without stopping a background run.

## Architecture

### Control Plane

The Karjoo cloud remains authoritative for:

- account identity and board connections;
- discovery filters;
- queue ordering and task state;
- executor ownership and heartbeat;
- application outcomes and progress events;
- dashboard and extension status views.

An account has one execution state: `paused`, `running`, or `blocked`, and one owner: `extension` or `server`. Starting or taking over a run updates ownership atomically. Claim APIs reject claims from an executor that does not own the run.

### Extension Executor

The existing MV3 service worker owns execution. It wakes from Chrome alarms, heartbeats while running, resumes from cloud state after service-worker suspension, and performs one queue item at a time. It reports lifecycle progress before navigation, after page verification, during submission, and after confirmation.

The toolbar opens a persistent Chrome side panel. The panel reads the same cloud live state as the dashboard and exposes Start, Pause, Stop, Retry, and Continue with extension. Its primary states are Ready, Discovering, Running, Paused, Blocked, Login required, and Complete.

### Server Executor

The existing Playwright worker claims only when the account owner is `server`. It applies at a conservative server-configured pace and never competes with an active extension run. On a security challenge, it reports a blocked result, releases remaining leases, marks the account/board blocked, stops the drain, and emits a user-visible notification.

## Data Flow

### Start in Extension

1. User presses Start in the side panel.
2. Control plane atomically assigns the account run to the extension instance.
3. Extension fetches cloud filters and opens the relevant board search pages locally.
4. Local content scripts collect listing metadata until the 45-day cutoff and send batches to the existing import/queue pipeline.
5. Extension claims the next newest eligible item.
6. It verifies that the real listing and apply form are accessible.
7. Free mode uses the board profile's current resume and submits without AI work.
8. Extension reports the result and immediately advances to the next item.

### Server Block and Takeover

1. Server detects a security challenge before submitting.
2. Current task returns to pending; remaining server leases are released.
3. Run becomes `blocked`, records the board and reason, and stops server claims.
4. Dashboard and Chrome notification explain that no application was attempted.
5. User presses Continue with extension.
6. Control plane atomically changes owner to the extension instance and marks the run running.
7. Extension continues from the preserved queue.

## Failure Semantics

- `security_challenge`: block the run, requeue the task, release leases, notify, and do not spend AI tokens.
- `login_required`: pause the run and ask the user to sign in to the board; resume after local session verification.
- `rate_limited`: pause until the board-provided retry time when available; otherwise require user resume.
- `already_applied`: reconcile the application as submitted/already applied, not failed.
- `form_unavailable`: keep a distinct reviewable outcome; do not infer already applied.
- `site_changed`: stop that board adapter after repeated selector failures and expose the failed item for retry.
- `network_error`: requeue with bounded retry backoff and retain the same owner.

Failures never masquerade as successful applications. A blocked page never becomes a missing-form skip.

## User Interface

The Chrome action opens the side panel. The current popup responsibilities move into the panel so pairing, board health, queue controls, and progress are not split across surfaces.

The main run view contains:

- account and board connection status;
- queue, applied-today, applied-total, and review-needed counts;
- free profile-resume indicator with zero-AI label;
- background continuation toggle;
- current listing and execution step;
- next queued listings;
- Start, Pause, Stop, Retry, and takeover controls;
- a concise failure/review list linked to the associated job and submitted resume.

The dashboard consumes the same live endpoint and remains synchronized without manual refresh.

## Jobinja Bulk Capability

Bulk apply is an optional board capability. The extension inspects authenticated, user-visible Jobinja pages for the official bulk-selection and apply controls. When present, it uses those controls and reconciles each returned listing individually. When absent or changed, the normal sequential executor remains the fallback. Private APIs, challenge bypass, and detection evasion are out of scope.

## Token and Billing Behavior

Queue discovery and free profile-resume application do not invoke AI and do not consume AI credits. AI billing is attached to explicit tailored-resume creation, not to queue claiming or board submission. Tailored generation occurs just in time after accessibility verification, and generated assets are reused for retries of the same application.

## Testing

- Unit-test ownership transitions, stale heartbeat recovery, takeover, pause, and lease release.
- Route-test extension/server authorization, free claims without application quota, progress updates, and blocked state.
- Unit-test MV3 alarm resumption, single-item sequencing, no-delay free mode, notifications, and safe stop behavior.
- Fixture-test local discovery pagination, 45-day cutoff, newest-first ordering, and bulk-capability fallback.
- Worker-test conservative pacing and challenge-triggered block/requeue behavior.
- Build and typecheck the web app, extension, and worker.
- Smoke-test production pairing, Start/Pause, live progress, server block visibility, takeover, and a free Jobinja application without AI usage.

## Release

Increment the extension version, build a distributable ZIP, publish it through the existing extension release path, redeploy the web control plane, and restart the server worker only after its blocked-state and pacing behavior are active. Existing queued tasks remain intact throughout deployment.
