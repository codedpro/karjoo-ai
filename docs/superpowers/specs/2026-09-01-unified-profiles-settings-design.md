# Unified Profiles And Provider Settings Design

## Objective

Make `/dashboard/profiles` the single place where a user manages the information and rules that describe them to Karjoo:

- Their editable Karjoo resume profile and uploaded resume files
- Resume-generation and matching behavior currently stored as hidden profile preferences
- Their account/profile state on every active provider
- The real per-provider categories and search filters used by discovery

The page must expose the same capabilities already configured for `dev.codedpro@gmail.com` to every user without hard-coding that account into the UI.

## Information Architecture

The page keeps one scrollable document with stable anchor navigation. It contains four sections:

1. **Karjoo profile**: the existing comprehensive resume form and file workspace.
2. **Resume behavior**: identity and tailoring settings used by resume generation and hard filtering.
3. **Provider profiles**: Jobinja, JobVision, e-estekhdam, and IranTalent account/profile status.
4. **Job targeting**: the existing provider-specific targeting editor and real provider catalogs.

`/dashboard/auto-apply` remains the operational surface for starting, pausing, and observing execution. It links to the Profiles targeting section instead of rendering a competing targeting editor.

## Resume Behavior Settings

The editor exposes the preference fields that already affect matching and resume generation:

- Gender used to exclude gender-incompatible listings
- Latin full name, resume phone, output language, template, and location visibility
- Broad matching mode and broad matching sections
- Declared skill domains from the canonical `SKILL_DOMAINS` catalog
- Resume emphasis/instructions
- Client/proof company names
- Unlimited discovery/apply mode

The fixed and variable resume-company policy remains code-owned. The UI shows the selected domain set that drives variable-company selection, while company names and deterministic dates remain governed by the tested resume policy.

Settings are stored in `candidate_profiles.preferences`. Writes merge only the owned keys into the latest preferences object. They must preserve `boardFilters`, queue limits, AI settings, and unrelated future keys.

## Provider Profiles

The provider area renders all active providers in one responsive grid. Every provider card shows:

- Provider name and current connection state
- Account label when available
- Last connection time
- Last imported/synchronized profile time
- Imported name, headline, city, years of experience, skills, and profile URL when available
- Current targeting summary for that provider

Missing profile data is represented as “not synchronized” rather than an empty or fake profile. Connection state comes from `board_accounts`; imported profile data comes from `board_profile_snapshots`; targeting comes from the same `ApplyFilters` object used by discovery and the extension.

## Synchronization

The server remains authoritative for all non-secret state.

- Dashboard and extension targeting both read and write `/api/apply/filters`.
- Provider connection state uses `board_accounts`.
- Every successful extension profile import upserts a data-only `board_profile_snapshots` row for that provider before merging safe fields into the Karjoo profile.
- Profile snapshots never contain cookies, tokens, passwords, authorization headers, or session material. Existing recursive credential guards remain mandatory.
- Provider cards refresh from server data after navigation or router refresh. Extension imports are visible on the next dashboard refresh without a second data model.

The existing Jobinja-specific edit action stays available only where the provider supports server-side profile editing. Other providers are displayed as synchronized read-only snapshots because Karjoo does not have verified write APIs for them.

## API And Service Boundaries

Add a dedicated authenticated resume-settings endpoint and service:

- `GET /api/resume/settings` returns the normalized editable settings.
- `PATCH /api/resume/settings` validates and merges only owned preference keys.

Keep the comprehensive profile endpoint unchanged so normal profile saves cannot accidentally overwrite preferences.

Add a provider-profile data helper that reads accounts, snapshots, latest imports, and targeting in parallel for the authenticated user. It returns display-safe metadata only.

Update the profile import service to upsert a sanitized snapshot for every supported provider in the same user-scoped operation as the import history record.

## Error Handling

- A failed provider catalog must leave that provider editable with an explicit unavailable-catalog state; other providers continue rendering.
- A failed settings save leaves local edits visible and reports the server error.
- An extension import with no meaningful profile fields does not replace an existing snapshot.
- A rejected credential-shaped import writes neither a snapshot nor a profile change.
- Disconnected providers retain prior snapshots and targeting so reconnecting does not destroy user data.

## Accessibility And Responsive Layout

- Anchor navigation wraps without horizontal scrolling.
- Provider selection uses a segmented tab control with text status, not color alone.
- Binary settings use checkboxes/toggles; language and template use select/segmented controls; long option sets use searchable checkbox lists.
- All controls have labels, keyboard focus styles, and stable dimensions.
- The provider grid is one column on mobile and two columns on wide screens.
- No nested cards are introduced; repeated provider records may use cards, while page sections remain unframed.

## Testing And Release

Add focused tests for:

- Resume-settings parsing, validation, and preference-preserving merge
- Authenticated settings routes and cross-user isolation
- Four-provider profile aggregation and empty states
- Provider import snapshot persistence and credential rejection
- Profiles page information architecture and removal of duplicate targeting from Auto Apply
- Responsive rendering and no control/text overlap at mobile and desktop widths
- Existing filter queue invalidation after targeting saves

Run the complete web and extension test suites, type checks, production builds, and browser screenshots before deploying the web app and publishing the updated extension ZIP.
