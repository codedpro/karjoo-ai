# Unified Job Hub Design

## Objective

Make Karjoo feel like one place to search, track, and apply across job boards.

The landing page should advertise the product promise clearly: users can discover jobs from multiple providers, manage applications from one place, open the original provider page, and easy apply through Karjoo. Providers are added dynamically one by one. A provider counts as live only when it supports the full workflow:

- Job discovery/search into Karjoo
- Application history/status synchronization into Karjoo
- Easy apply or auto apply through Karjoo

The dashboard gets a new unified job board at `/dashboard/jobs`. Existing pages such as `/dashboard/matches`, `/dashboard/applications`, `/dashboard/archive`, and `/dashboard/auto-apply` remain useful, but the new Jobs page becomes the primary browse-and-act surface.

## Product Positioning

The public landing page should move from “we apply while you sleep” to a broader unified-workflow message:

- Search jobs from every connected provider in one place.
- Apply from Karjoo or open the original provider page.
- Track the provider-reported status of applications Karjoo already knows about.
- Add new providers continuously as their full workflow is verified.

The copy must avoid implying that unsupported providers already have full automation. Provider language should use “connected job boards” and “providers are added continuously” rather than absolute claims like “all job boards are live today.”

The boards section should show provider capability state from the registry:

- `live`: full workflow available
- `in progress`: known provider, not yet fully released
- `planned`: visible roadmap provider

Marketing may say Karjoo is built for all job boards, but the UI must identify which providers are fully live.

## Unified Jobs Page

Add `/dashboard/jobs` as the user-facing job board. It lists normalized rows from `job_listings`, enriched with user-specific state from `matches`, `applications`, and `board_applications`.

Each job card or row shows:

- Title, company, city, salary, provider, and posted date
- Match score and short match reason when available
- Whether the user has already applied
- Provider-reported application status when available
- Freshness indicator when the job was seen or updated recently
- Primary action: `Easy apply with Karjoo`
- Secondary action: `Open on provider`

The page supports server-side filtering and pagination:

- Text search across title, company, city, and description
- Provider filter
- City filter
- Remote/employment type filters where provider data exists
- Posted date filter, defaulting to fresh jobs
- Match status and application status filters
- Sort by newest, match score, company, and provider

The first version should use list/table density rather than a marketing card layout. Job search is an operational workflow; users need scanning, comparison, and repeated actions.

## Action Rules

`Open on provider` always opens `job_listings.url` in a new tab when present.

`Easy apply with Karjoo` is available when:

- The provider is `live`
- The user has a connected or recoverable account for that provider
- The job is not already submitted by Karjoo
- The job does not have a synced provider application that proves the user already applied
- The listing is not stale beyond the product's freshness policy

If the user already applied, the primary action becomes a status label or a link to the application record. The system must not create duplicate apply attempts for the same user/listing/provider evidence.

For contact-style providers, easy apply can prepare the message/resume package and then guide the user to the provider page when a verified automated submit path is not available. That provider should not be marked `live` until this path is accepted as the complete workflow for that provider.

## Provider Registry

Provider metadata should become the source of truth for display and behavior. The current `BOARD_STATUS` can evolve from a simple status map into a capability registry.

Each provider record should describe:

- Provider id and display name
- Public marketing visibility
- Workflow state: `live`, `in_progress`, or `planned`
- Discovery support
- Application sync support
- Easy apply support
- Auto apply support
- Session shape and connection method
- Last verified release notes or internal note

The dashboard should use this registry to decide which providers can be searched, connected, synced, and applied through. The landing page should use the same registry or a public-safe projection of it so marketing copy cannot drift from product reality.

Adding a provider becomes a repeatable checklist:

1. Implement discovery/search and normalize listings.
2. Implement application-history/status sync.
3. Implement easy apply or auto apply.
4. Add dedupe rules and provider-specific stale-result cutoff behavior.
5. Add tests and real-provider runbook notes.
6. Flip the provider to `live`.

## Sync Freshness And Retention

Karjoo keeps all records it has already synced forever unless a separate data-retention feature is later introduced.

Provider syncs must not request pages or result windows older than 45 days. This applies to:

- Job discovery
- Application history sync
- Provider status refreshes that page through historical applications

The 45-day rule is a provider-crawl boundary, not a database deletion rule.

Implementation expectations:

- A shared constant defines the maximum provider lookback window.
- Provider connectors receive a cutoff date or max-age policy instead of hard-coding dates.
- Cursor-based and page-based syncs stop when a page is entirely older than the cutoff.
- Mixed pages keep fresh rows and stop before requesting deeper pages once ordering proves older pages cannot contain fresh rows.
- If a provider cannot expose reliable dates, the connector uses conservative page limits and marks date confidence in logs/tests.

Existing Karjoo-originated application records remain visible even when the provider would no longer return them in a fresh 45-day sync.

## Data Model

The existing tables are the right foundation:

- `job_listings`: normalized provider jobs
- `matches`: user/listing scoring and match state
- `applications`: Karjoo-originated apply attempts
- `board_applications`: provider-reported application history and status
- `board_accounts`: user/provider connection state

The first implementation can avoid new tables if current fields are enough. Likely additions or follow-up migrations:

- `job_listings.last_seen_at` to distinguish first ingestion from recent provider confirmation
- `job_listings.closed_at` or `is_active` once providers expose closure signals
- Provider capability fields if the registry moves to database-backed configuration
- Better indexes for `/dashboard/jobs` filters, especially `(board, posted_at)`, title/company text search, and user-specific joins

The design should not duplicate `board_applications` into `applications`. Karjoo-originated submissions and provider-reported application history are related but different evidence sources.

## Query And API Boundaries

Add a server-only jobs query service, for example `src/lib/apply/jobs-query.ts`.

Responsibilities:

- Parse and clamp URL query parameters
- Query normalized jobs with server-side filters and pagination
- Join or aggregate user-specific match/application/provider-application evidence
- Return display-ready rows without exposing unrelated users' data

Add an authenticated route only if client-side interactions require it. The initial page can be a server component with URL-driven filters, following the existing `/dashboard/applications` and `/dashboard/matches` pattern.

Easy apply actions should go through existing queue/apply services where possible. The Jobs page should not bypass existing dedupe, billing, AI-gate, resume-tailoring, or provider session checks.

## Navigation

Add `Jobs` to the dashboard apply section navigation. A practical order:

1. Jobs
2. Matches
3. Applications
4. Archive
5. Auto Apply

`/dashboard/matches` remains the AI-ranked subset. `/dashboard/jobs` is broader: all fresh searchable listings, whether scored or not.

`/dashboard/applications` should eventually become provider-agnostic instead of Jobinja-specific. Until then, the Jobs page can show provider-specific status summaries and link to the existing provider page where available.

## Empty And Error States

Jobs page empty states:

- No providers connected: prompt the user to connect providers.
- Providers connected but no synced jobs: offer a sync/discovery action.
- Filters return no results: show active filters and provide a reset action.
- Provider temporarily unavailable: keep other providers visible and show a provider-level warning.

Easy apply error states:

- Missing provider account: link to provider connection flow.
- Expired session: link to reconnect.
- Provider no longer has the job: mark stale and keep the record visible.
- Duplicate application detected: show existing application evidence instead of retrying.
- AI or billing limit hit: preserve the job row and explain which optional step is blocked.

## Landing Page Changes

Update the landing page in three areas:

- Hero: explain unified search plus apply, not only night-shift auto apply.
- Capabilities: add “one job board for all providers,” “open on provider,” “easy apply through Karjoo,” and “application statuses synced back.”
- Boards section: show the provider roadmap with truthful full-workflow states.

The current dark console style can remain. The new copy should preserve the existing concise Persian tone and avoid extra explanatory clutter.

## Testing

Add focused coverage for:

- Jobs query parsing, clamping, filtering, sorting, and pagination
- Cross-user isolation when joining jobs to matches/applications/provider applications
- Duplicate prevention when both `applications` and `board_applications` indicate an existing apply
- Provider registry state projection for dashboard and landing usage
- 45-day cutoff behavior for each provider connector
- Jobs page empty states and URL-driven filter rendering
- Easy apply availability rules

Run `npm run typecheck`, focused Vitest suites, and a production build before shipping. For UI implementation, verify desktop and mobile screenshots because the Jobs page will be dense and filter-heavy.

## Rollout

Phase 1: planning and copy update.

- Add this design.
- Update landing copy to advertise the unified workflow truthfully.

Phase 2: provider registry hardening.

- Expand provider metadata from simple status into capability records.
- Use the registry for landing and dashboard state labels.
- Introduce the shared 45-day provider lookback constant.

Phase 3: unified Jobs page.

- Add the server-side jobs query service.
- Add `/dashboard/jobs` with filters, pagination, and provider actions.
- Link it into dashboard apply navigation.

Phase 4: easy apply integration.

- Wire job-row actions into existing queue/apply services.
- Enforce duplicate checks across Karjoo applications and provider-synced applications.
- Add provider-specific action fallbacks where required.

Phase 5: provider expansion loop.

- Bring each provider to full workflow before marking it live.
- Keep in-progress and planned providers visible only where their state is truthful and useful.
