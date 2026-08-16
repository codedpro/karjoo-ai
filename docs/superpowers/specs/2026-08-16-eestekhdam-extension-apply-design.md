# e-estekhdam Extension Apply Design

## Goal

Add e-estekhdam as a first-class Karjoo board for filtered job discovery and queued applications. Applications run in the user's browser session and support the site's structured application form, including a tailored PDF resume and cover letter when those controls are present.

## Approved Approach

Use a browser-first connector. The control plane owns filters, queue state, tailored artifacts, history, and live progress. The extension owns e-estekhdam page navigation, authenticated discovery, form interaction, file attachment, and final submission.

Alternatives considered:

1. Server login with stored phone/password. Rejected because credentials would need durable storage and the server remains vulnerable to CAPTCHA and IP/session challenges.
2. Server replay of copied cookies. Retained only as a future premium optimization because session rotation and security challenges make it less reliable than the active browser.
3. Browser-first execution with server fallback handoff. Selected because it uses the user's current authenticated session and fits the existing extension queue owner model.

The phone number and password are never added to source code, logs, database records, extension storage, or API payloads.

## Board Configuration

The unified filters model gains an `e-estekhdam` board entry with:

- enabled state
- category keys
- city/location keys
- employment types
- remote-only selection
- optional minimum salary when the board exposes it
- the existing 45-day maximum posting age

The dashboard and extension use one server-authoritative configuration. e-estekhdam categories are served through the existing board-catalog API pattern.

## Discovery

Discovery runs inside a background browser tab on e-estekhdam using the active cookie session. The content adapter extracts structured listing data from the site's search result pages, follows pagination without a page-count cap, and stops after listings exceed the configured age limit.

Each listing includes a stable external id, canonical URL, title, company, location, description where available, posted date, gender restriction when present, and prior-application state when rendered. Listings without an in-site application action may be discovered for visibility but are marked non-automatable and are not submitted automatically.

## Application Flow

For each claimed e-estekhdam task, the extension:

1. Downloads the job-specific PDF resume from Karjoo.
2. Opens or reuses the exact job page in a background tab.
3. Detects login, CAPTCHA/security challenges, already-applied state, and whether an in-site form exists.
4. Opens the application form.
5. Selects the upload-resume path when required and attaches the tailored PDF.
6. Fills the job-specific cover letter when a cover-letter field exists.
7. Submits once and confirms success from the site's response or rendered state.
8. Reports submitted, already applied, failed, or blocked to the shared queue history.
9. Closes extension-created tabs after terminal outcomes.

Missing optional cover-letter controls do not block submission. A missing required resume attachment control, rejected PDF, unknown form shape, login page, or CAPTCHA never triggers a guessed submit.

## Session And Fallback

The extension detects e-estekhdam login from session-cookie names and confirms it against the rendered authenticated page before applying. Cookie values stay in Chrome and are not sent to normal Karjoo endpoints.

If server execution cannot authenticate or encounters a board security challenge, the run is blocked without consuming another tailored-resume generation. The dashboard and browser notification direct the user to transfer ownership to the extension. After takeover, the same queued task resumes in the active browser session.

CAPTCHA is never solved or bypassed. One intervention tab is retained for the user; the queue resumes after the session is valid and the user starts or takes over the run again.

## Cover Letter And Resume

e-estekhdam uses `tailored_pdf`, not the board's profile resume, whenever its structured form accepts an attachment. The queue claim prepares one PDF and one cover letter for the task. Retries reuse the existing artifacts unless they are absent or invalid, avoiding duplicate AI cost.

The application history records whether a tailored resume existed and exposes the same resume preview already used by other boards. Cover-letter text is not logged in worker output.

## Error Handling

Blocking reasons are board-specific and actionable:

- `eestekhdam_login_required`
- `eestekhdam_captcha_required`
- `eestekhdam_security_challenge`
- `eestekhdam_form_unavailable`
- `eestekhdam_contact_only`
- `eestekhdam_already_applied`
- existing resume download/upload failures

Login/security failures preserve the lease for intervention. Contact-only and already-applied outcomes are terminal skips. Unknown form states fail closed and remain retryable after adapter updates.

## Testing And Release

Tests cover filter parsing, catalog responses, discovery extraction and pagination, age/gender filtering, active-session detection, login/CAPTCHA/already-applied states, PDF attachment, optional cover-letter behavior, successful submission, tab cleanup, and server-to-extension takeover semantics.

Release verification requires the extension test suite, extension typecheck/build, control-plane tests/build, a cache-busted extension version, production restart, and validation that the public version endpoint and downloaded ZIP report the same version.
