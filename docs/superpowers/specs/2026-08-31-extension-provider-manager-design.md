# Extension Provider Manager Design

## Objective

Add a compact provider manager at the top of the Karjoo extension. Users can inspect and control every currently active job provider without leaving the live queue view.

Only these production-ready providers are shown:

- Jobinja
- JobVision
- e-estekhdam

IranTalent and other planned providers remain hidden until their complete discovery and application flows are released.

## Entry Point

The extension top bar gains one provider button beside the execution status. The button uses a familiar connection/account icon, displays the number of connected providers, and has an accessible label and tooltip.

Activating it opens a compact anchored menu below the top bar. The menu is not a separate page and does not interrupt the queue view. Clicking outside, pressing Escape, or activating the button again closes it.

## Provider Rows

Each provider row contains:

- Provider name
- Status indicator and concise status text
- Pause/resume control
- Context menu for login, reconnect, and disconnect

Supported states are:

- `checking`: local session and server metadata are being reconciled
- `connected`: local browser login is valid and Karjoo metadata is connected
- `login_required`: Karjoo is enabled but no valid local provider session is detected
- `paused`: provider remains connected but discovery and queue claims are suspended
- `disconnected`: provider is detached from Karjoo

Status is derived from both server metadata and a fresh local browser-session probe. Raw cookies, tokens, passwords, and storage values never enter UI state or provider-management API payloads.

## Actions

### Login

Available when the local session is missing. It opens the provider's normal login or jobs page in a browser tab. The extension never fills or stores credentials. When the user returns, the provider manager probes the session again and connects metadata only after a valid login is detected.

### Reconnect

Available for connected or login-required providers. It opens the provider website, performs a fresh local session check, and updates Karjoo's metadata when the session is valid. A failed check leaves the provider in `login_required` without deleting queue data.

### Pause and Resume

Pause changes that provider's synchronized `boardFilters[board].enabled` value to false. It stops:

- New discovery for that provider
- Claiming existing pending tasks for that provider
- Starting new applications for that provider

Pending jobs remain in the queue and retain their order, generated artifacts, attempts, and history. A currently executing submission is allowed to finish; pause affects the next claim. Resume sets the provider back to enabled and makes retained tasks claimable again.

### Disconnect

Disconnect is Karjoo-only. It:

- Marks provider metadata as requiring reconnection
- Disables the provider filter
- Prevents discovery and queue claims
- Preserves pending jobs and application history
- Leaves all job-website cookies, tokens, and browser login state untouched

No website logout endpoint is called and no provider cookie is removed.

## Synchronization

The server remains authoritative for provider metadata and enabled state. The extension performs optimistic UI updates but refreshes the complete provider state after every action.

The existing filter form and provider menu edit the same `boardFilters` object. Changes made in either surface appear in the other on the next synchronization cycle. The menu does not create a second pause field.

The queue claim query must exclude pending tasks whose provider filter is disabled. Queue overview still includes those tasks so users can see that work is retained; paused provider rows and queue items receive a clear paused label.

## Error Handling

- Session probe unavailable: show `Checking failed` with Login and Reconnect actions.
- Metadata request fails: restore the prior rendered state and show a concise extension error.
- Disconnect succeeds but filter save fails: refresh server state and report the partial failure instead of pretending the provider is fully disconnected.
- Provider blocks access or presents CAPTCHA: retain the existing intervention behavior and show `Login required` or the run-level blocked state.

## Accessibility and Layout

- Provider button and row menus are keyboard accessible.
- Escape closes the menu and returns focus to the provider button.
- Status is communicated with text as well as color.
- Controls have stable dimensions and do not resize the header.
- The menu fits the Chrome side-panel width without nested cards or horizontal scrolling.

## Testing

Add focused coverage for:

- Provider state derivation from metadata, enabled filters, and local session probes
- Contextual action visibility
- Pause/resume preserving tasks while changing claim eligibility
- Disconnect leaving browser session material untouched
- Server/extension filter synchronization
- Menu keyboard and close behavior
- Existing Jobinja, JobVision, and e-estekhdam session detection regression tests

Run the full extension suite, server tests covering board accounts, filters, queue claims, and the production builds before publishing a new extension version.
