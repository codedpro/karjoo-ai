# JobVision Extension and Multi-Board Filters Design

Date: 2026-08-16
Status: Approved

## Objective

Add JobVision as a real extension-only discovery and application board, while
turning the current Jobinja-specific filter screen into one cloud-synchronized
multi-board configuration. Users choose categories and supported filters for
each site independently, then see both sites in the same queue, live progress,
history, failure, retry, and interview-preparation views.

JobVision application automation must work even though JobVision does not
support a stable, per-application PDF attachment. Karjoo must represent this
limitation honestly and must not rotate a shared JobVision resume while calling
it a permanent tailored attachment.

## Confirmed JobVision Behavior

Investigation of JobVision's current production application established these
contracts:

- Public search uses `POST /api/v1/JobPost/List` with page number, page size,
  sorting, and board filter identifiers.
- Board metadata comes from `GET /api/v1/JobPost/GetAllSearchFilters`. It
  includes JobVision category IDs and URL titles, industries, work types,
  seniority levels, experience requirements, salary ranges, and time ranges.
- Job details come from `GET /api/v1/JobPost/Detail?jobPostId=...`.
- Authenticated submission uses `POST /api/v1/Application/Apply` with the job
  ID and tracking fields. The request has no file, resume ID, or attachment ID.
- JobVision authentication is an OIDC session stored under
  `CandidateClient_v2` in browser origin storage. Analytics cookies are not the
  authenticated session.
- JobVision can upload one account-level personal CV through
  `POST /api/v1/ModalCvMaker/UploadPersonalCv` using multipart field
  `formFile`.
- JobVision explicitly tells the candidate that employers always see the
  latest version of the personal CV. Replacing that file after each application
  would therefore also change what earlier employers see.
- A completed JobVision CV follows the native "JobVision CV" submission path.
  The personal-CV modal is primarily a fallback for an incomplete JobVision CV.

The supplied successful application capture confirms the endpoint and payload
shape but is not retained in source, logs, fixtures, documentation, or server
storage. No bearer token, password, or origin session value may leave the
user's browser.

## Product Rules

- JobVision discovery and submission run only in the Chrome extension through
  the user's local JobVision session and IP.
- The server remains the cloud control plane, but it never executes JobVision
  requests and never receives JobVision credentials.
- Jobinja continues to require a persisted, tailored PDF for every submission.
- JobVision uses the account's native JobVision CV or an already uploaded shared
  personal CV selected by JobVision's native flow. If neither is usable, the
  extension pauses for user action instead of inventing a successful
  submission.
- JobVision does not automatically generate a tailored PDF that cannot be
  attached. This avoids AI spend with no delivery value.
- A user may explicitly generate and archive a tailored JobVision PDF from the
  job detail/history view for interview preparation or manual use.
- If JobVision later introduces a true per-application attachment, it is enabled
  only after the adapter verifies that the attachment is immutable for that
  application. A generic file input is not sufficient proof.
- Discovery uses board filters, not AI scoring, unless the user separately
  enables AI filtering.
- Discovery reads every available result page until it reaches the configured
  creation-date cutoff. It has no arbitrary page-count limit.
- The default and maximum supported age cutoff is 45 days. Expired or older
  listings never enter the queue.
- Queue order is newest to oldest across all enabled boards, with deterministic
  tie-breaking by discovery time and task ID.
- Candidate gender exclusions are enforced before queueing and again before
  submission. A male profile must not apply to women-only listings.
- Daily and weekly limits are optional user controls. An unset limit means no
  user limit; existing plan-level safety rules remain separate.
- CAPTCHA, login, rate-limit, and security-challenge pages pause only the
  affected board and preserve its pending tasks. They are never bypassed.
- A failed or interrupted task remains retryable unless the listing is closed,
  ineligible, already applied, or explicitly rejected by a terminal board
  response.

## Board Capability Model

Resume handling is a declared adapter capability rather than one global rule:

| Board | Discovery | Submission | Resume strategy | Executor |
| --- | --- | --- | --- | --- |
| Jobinja | Local browser pages | Local form | Immutable tailored PDF per application | Extension or server where supported |
| JobVision | Public structured API from extension | Native local page | Native JobVision CV or existing shared personal CV | Extension only |

The capability model contains explicit values such as
`per_application_attachment`, `native_profile_resume`, `extension_only`, and
`supports_public_discovery`. Claim preparation uses these capabilities:

- Jobinja claims must include a ready tailored-resume descriptor.
- JobVision claims must not trigger resume generation and instead declare
  `resumeStrategy: "native_profile_resume"`. A result may refine this to
  `shared_personal_resume` when JobVision's own modal selects the account's
  existing personal CV.
- The UI labels the actual strategy on every current, queued, and completed
  item. It never shows "tailored resume sent" for a JobVision native-CV apply.

## Filter Storage

The existing `candidate_profiles.preferences` JSON remains the storage owner.
No schema migration is required. Add a versioned nested structure:

```json
{
  "boardFiltersVersion": 1,
  "boardFilters": {
    "jobinja": {
      "enabled": true,
      "categoryKeys": ["web-programming"],
      "cities": ["Tehran"],
      "employmentTypeKeys": ["is_fulltime"],
      "remoteOnly": false,
      "minSalary": 0,
      "sort": "published_at_desc"
    },
    "jobvision": {
      "enabled": true,
      "categoryKeys": ["30", "260", "176"],
      "cities": [],
      "employmentTypeKeys": ["120"],
      "remoteOnly": false,
      "sort": "newest"
    }
  },
  "maxAgeDays": 45,
  "paused": false,
  "dailyLimit": null,
  "weeklyLimit": null,
  "aiFilterEnabled": false
}
```

Board category keys are opaque strings at the shared API boundary. Jobinja
stores its machine slug; JobVision stores the decimal JobVision category ID.
Each adapter validates and converts its own values. Labels and URL titles come
from the current board catalog and are not persisted as targeting identity.

For compatibility, reads migrate legacy top-level Jobinja fields into
`boardFilters.jobinja` when the nested structure is absent. Writes maintain the
legacy Jobinja mirror during this release so existing dashboard and worker code
continues to behave correctly. Unknown preference keys remain untouched.

## Category Catalogs

Expose one normalized catalog endpoint per board behind a shared response
shape:

```ts
interface BoardFilterCatalog {
  board: BoardId;
  categories: Array<{ key: string; labelFa: string; labelEn?: string }>;
  employmentTypes: Array<{ key: string; labelFa: string; labelEn?: string }>;
  supports: {
    cities: boolean;
    remoteOnly: boolean;
    minimumSalary: boolean;
    industries: boolean;
  };
  source: "live" | "cache" | "fallback";
}
```

JobVision metadata is fetched from its public filter endpoint, normalized, and
cached with stale fallback. The extension may fetch public metadata directly,
but cloud filter writes always use the normalized Karjoo contract. A temporary
catalog outage must not delete saved selections.

## JobVision Discovery

The extension background executor owns JobVision pagination. It sends the
selected category IDs and supported board filters to JobVision's list endpoint,
using a page size accepted by the current API and `sortBy` for newest-first
ordering.

For each result it records:

- JobVision job ID and canonical URL;
- title, company, location, categories, work type, seniority, and industry;
- remote/internship flags and gender restriction;
- activation/creation time and expiration state;
- JobVision's `isApplied` and canceled-application state when available.

The executor imports results in bounded batches, de-duplicates by
`board + externalId`, and continues pages until a page contains no jobs newer
than the cutoff or the API reports no next page. It does not generate a JD
summary, match reason, cover letter, score, or resume during discovery.

Existing queued tasks are reconciled during discovery. Already-applied jobs are
marked applied/reconciled, closed jobs become terminal skipped, and transiently
failed eligible jobs may be returned to pending according to retry policy.

## JobVision Authentication

The content script detects the presence of the `CandidateClient_v2` OIDC record
and confirms login through JobVision's rendered authenticated state. Presence
of a storage key alone is not proof of a valid session.

The extension does not upload the OIDC record to Karjoo, copy bearer values into
Chrome extension storage, print them in logs, or include them in error reports.
Authenticated requests are performed by JobVision's own page application after
native UI interaction. Public discovery needs no candidate token.

If the session is expired, the executor retains at most one extension-created
JobVision tab, focuses it for login, marks that board `login_required`, and stops
claiming JobVision tasks. Other enabled boards may continue only when executor
ownership and tab safety permit independent progress.

## JobVision Submission

For a claimed JobVision task, the extension performs these stages:

1. Open or reuse one extension-owned JobVision detail tab.
2. Wait for the Angular detail view and stable job ID.
3. Verify login, listing availability, gender eligibility, and current
   `isApplied` state.
4. Verify the visible native apply control is present and enabled.
5. Click JobVision's native apply control once.
6. If JobVision's native modal offers an already uploaded personal CV, select
   its native `Send personal CV` action and record
   `shared_personal_resume`. If the modal requires CV creation or upload, pause
   with `resume_setup_required` and retain the intervention tab. Do not upload
   a per-job Karjoo PDF into the shared account slot.
7. If CAPTCHA, login, or a security challenge appears, pause with its exact
   reason and do not report an application.
8. Confirm success through JobVision's post-apply state and a refreshed
   `isApplied` result before reporting success.
9. Report the native resume strategy and close extension-created tabs after a
   terminal result.

Submission is idempotent. A retry re-checks `isApplied` before clicking. A job
already applied on JobVision is reconciled as applied rather than submitted
again or marked failed.

## Queue and Retry Semantics

Queue tasks remain cloud-authoritative and include their board. One extension
executor processes tasks sequentially, while queue ordering is global across
enabled boards.

- `network_error`, temporary 5xx, and interrupted navigation: requeue with
  bounded exponential backoff.
- `login_required`, `captcha_required`, `security_challenge`, and
  `resume_setup_required`: pause the board, retain one intervention tab, notify
  the user, and leave the task pending.
- `rate_limited`: honor the board retry time when present; otherwise pause for
  manual resume.
- `already_applied`: reconcile as applied without another click.
- `listing_closed`, `expired`, `older_than_cutoff`, or `gender_mismatch`:
  terminal skipped with a precise reason.
- `site_changed`: stop JobVision after repeated selector/state failures and
  expose all affected items for retry after an adapter update.
- tailored resume generation failures affect only boards that require a
  tailored attachment. They must not block native-CV JobVision tasks.

Leases are released on pause, browser shutdown recovery, or stale heartbeat.
No retry may create duplicate application records for the same board listing
and user.

## Unified Extension Interface

The side panel keeps the existing Live, Filters, History, and Detail views.

### Live

- Global queue, applied today, applied total, failed, and review counts.
- Per-board connection and blocked state.
- Current job with board, execution stage, resume strategy, and Open Job.
- Complete upcoming queue with board filter, pagination/load-more, and newest
  ordering.
- Start, Pause, Stop, takeover, and board-specific Continue actions.
- Live updates without reload while the panel is open.

### Filters

Use a compact board selector for Jobinja and JobVision. Each board shows:

- enabled toggle and local-login status;
- searchable category checklist from that board's live catalog;
- only filters the board actually supports;
- selected count, reset, save, and discovery preview/count where available.

Shared controls appear once: 45-day cutoff, daily limit, weekly limit, global
discovery pause, and optional AI filter. Saving writes one cloud record and
refreshes both the dashboard and extension representation.

### History and Detail

History supports board and status filters, search, pagination, retry, Open Job,
and resume actions. Each result identifies the actual resume strategy:

- Jobinja: `Tailored PDF sent`, with View Resume.
- JobVision: `JobVision profile CV sent` or `Shared personal CV sent`, with no
  misleading per-job PDF action.

JobVision detail offers `Generate tailored PDF` as an explicit manual action.
The resulting PDF is archived in Karjoo and shown for interview preparation,
but it is not labeled as submitted to JobVision.

## API Changes

- `GET/PUT /api/apply/filters`: return and accept the versioned multi-board
  filter contract while preserving legacy Jobinja compatibility.
- `GET /api/boards/:board/catalog`: return the normalized board catalog;
  initially support Jobinja and JobVision.
- `POST /api/extension/discovery/import`: accept board-tagged normalized batches
  without AI-generated fields.
- `GET /api/extension/discovery`: return enabled boards, board filters, cutoff,
  and shared limits.
- `POST /api/apply-queue/claim`: return board capability and resume strategy;
  require a tailored descriptor only for capable/required boards.
- `GET /api/extension/run`: include per-board health, queue pagination metadata,
  resume strategy, retryability, and board-specific blocked reason.

Every authenticated cloud endpoint derives the user from the Karjoo web or
extension session. No endpoint accepts a client-supplied user ID, JobVision
token, or JobVision password.

## Security and Privacy

- Never persist or transmit JobVision bearer tokens, passwords, OIDC records,
  cookies, or full local-storage snapshots.
- Never place credentials in source, fixtures, command arguments, telemetry, or
  exception messages.
- Limit extension host permissions to the current JobVision web and API origins.
- Treat public API responses as untrusted input and validate all normalized
  fields and bounds.
- Generated PDFs remain user-scoped and private. Manual JobVision PDFs use the
  same authorization checks as Jobinja resume assets.
- CAPTCHA is an intervention state, not an automation target.

## Testing

- Fixture-test JobVision filter metadata and category normalization.
- Fixture-test list pagination, all-page traversal, 45-day cutoff, newest-first
  ordering, gender filtering, de-duplication, and already-applied reconciliation.
- Test legacy Jobinja filter migration, nested board writes, unknown-key
  preservation, and extension/dashboard synchronization.
- DOM-test JobVision login detection, native apply button, applied state,
  incomplete-CV modal, expired listing, login, CAPTCHA, and selector changes.
- Test that JobVision claims never trigger AI resume generation and never claim
  a tailored PDF was submitted.
- Test Jobinja still refuses submission without its tailored PDF.
- Test transient retry/backoff, terminal skips, stale lease recovery, and no
  duplicate application after extension restart.
- Test extension-created tab cleanup for success, failure, pause, intervention,
  and stop.
- Test Live, Filters, History, and Detail board/status/search/pagination states.
- Run web and extension unit tests, typechecks, lint, production builds, and
  packaged-extension smoke tests.
- Perform one controlled JobVision production smoke application through the
  native browser session, then verify JobVision `isApplied`, Karjoo history,
  queue advancement, tab cleanup, and zero AI resume charge.

## Release

1. Deploy backward-compatible control-plane filter/catalog/queue contracts.
2. Publish the incremented extension with JobVision disabled by default for
   existing users until they select categories and confirm local login.
3. Enable JobVision for the target account after its categories are saved.
4. Requeue eligible transient JobVision failures; do not alter completed or
   terminal applications.
5. Verify production synchronization and one controlled native-CV application.
6. Keep the server JobVision connector disabled so no server IP or stored
   credential path can claim JobVision work.
