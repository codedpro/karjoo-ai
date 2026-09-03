# Provider-Wide Submission Proof

## Goal

Karjoo must only call an application `submitted` when the relevant provider has supplied durable, non-secret evidence that it accepted or already holds the application. This rule applies to every active provider, not only Jobinja.

Existing unproven records remain visible in history but become retryable. Revisiting an application is also a verification operation: if the provider reports that the user already applied, Karjoo records a confirmed submission without sending a duplicate.

## Current Problem

The provider executors are stricter than the persistence boundary. JobVision, e-estekhdam, IranTalent, and Karboom inspect provider responses or state before returning success, but most return only `ok: true`. The server currently accepts that result without evidence and only rejects evidence-free Jobinja submissions.

For the target account, the historical exposure at design time is:

| Provider | Submitted | Submitted without stored evidence |
| --- | ---: | ---: |
| JobVision | 393 | 393 |
| IranTalent | 30 | 30 |
| e-estekhdam | 4 | 4 |
| Jobinja | 280 | 0 |
| Karboom | 0 | 0 |

Missing stored evidence does not prove that these 427 applications failed. It proves that Karjoo cannot currently distinguish genuine provider acceptance from an extension false positive.

## Approaches Considered

### 1. Trust every provider executor

Keep the current model and assume `ok: true` is sufficient. This preserves history but leaves the same false-success class open and provides no auditable reason for the status.

### 2. Require any non-empty proof object

Require `proof`, but accept arbitrary fields and signals. This blocks old clients but still allows malformed or accidental evidence to pass the server boundary.

### 3. Validate provider-specific proof and reverify history

Each executor emits a small `{ provider, signal }` object. The server checks that the provider matches the listing and that the signal is in that provider's allowlist. Historical evidence-free records become retryable while preserving their application rows and audit reasons. This is the selected approach.

## Evidence Contract

Proof contains only a provider id and a stable signal name. It must never contain cookies, tokens, response bodies, personal data, or resume contents.

Accepted signals are:

| Provider | New submission | Existing application |
| --- | --- | --- |
| Jobinja | `flash_message`, `submitted_text`, `apply_form_removed` | `already_applied_text` |
| JobVision | `post_apply_path`, `submitted_text` | `already_applied_text`, `post_apply_path` |
| e-estekhdam | `apply_api_accepted`, `apply_after_cleanup_api_accepted` | `already_applied_api` when the API exposes it |
| IranTalent | `position_is_applied`, `application_history` | `position_is_applied`, `conditions_is_applied`, `apply_conflict` |
| Karboom | `wizard_done` | `already_applied_response` |

An external provider receipt may continue to serve as evidence only when the connector explicitly returns a non-empty `externalRef`. Current browser connectors rely on the typed proof signals above.

The server rejects a submitted result when proof is absent, its provider does not match the task's board, or its signal is not allowlisted. It records a retryable failure using `<provider>_submission_unconfirmed` and never sets `submittedAt`.

## Runtime Flow

1. The executor performs the provider flow.
2. It confirms the result using provider state, response, route, or application history.
3. It returns `ok: true` with typed proof.
4. For `alreadyApplied`, the background reports a confirmed submitted application with the provider proof but does not increment the new-submission counter.
5. The server validates the proof against the listing's provider before persisting `submitted` and completing the task.
6. Invalid or missing proof persists as a failed, retryable application and a failed task.

## Historical Remediation

For the approved account, all non-Jobinja applications currently marked `submitted` without `external_ref` or `proof` are quarantined:

- retain the application row, match, tailored resume link, and original job;
- change application status to `failed`, move the old `submitted_at` value into a structured correction marker, clear `submitted_at`, and attach a correction reason;
- return its task to `pending`, clear leases/errors, and make it immediately retryable;
- do not delete jobs, matches, resumes, or application records;
- let the provider-aware retry either confirm `already applied`, submit successfully with proof, or report a real failure.

The remediation is scoped by account and the exact predicate `status = submitted AND external_ref IS NULL AND proof IS NULL`. It is idempotent and reports before/after counts.

## Compatibility

Older extensions that report evidence-free success will fail closed after the server release. The extension and server therefore ship together with a version bump and an update prompt. Failed reports remain retryable, so an old client cannot permanently hide a job.

## Tests

- Unit-test every provider's success and already-applied proof signal.
- Unit-test server rejection for missing proof, wrong provider, and unknown signal.
- Unit-test server acceptance for each allowlisted signal and valid external receipt.
- Test that `alreadyApplied` is stored as confirmed submitted but does not count as a new submission.
- Test queue/history queries: only confirmed submissions suppress retry.
- Run extension tests, extension typecheck/build, relevant web tests, and the production web build.
- Verify release ZIP/version parity and production before/after database counts.

## Release

Increment the extension patch version, update release notes, rebuild and publish both ZIP copies, restart the web service, verify the live version endpoint and ZIP hash, then run the scoped historical remediation. The database correction happens only after the new server guard is live.
