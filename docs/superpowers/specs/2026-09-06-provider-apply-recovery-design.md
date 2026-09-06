# Provider Apply Recovery

## Goal

Restore recent failed applications caused by e-estekhdam file cleanup and Jobinja page/form lifecycle changes. Provider evidence remains mandatory: transport success is never submission proof.

## Scope

- e-estekhdam failures caused by a full `data.files` bucket and unsuccessful deletion.
- Jobinja failures caused by extension message-channel closure during navigation, missing `#apply_choice_uploaded_cv`, and missing `#apply-form`.
- A scoped production repair of recent records with only these reasons.

## e-estekhdam Recovery

Karjoo may delete every file returned by the user's e-estekhdam `data.files` collection when that collection blocks a tailored application. Cleanup uses the provider's observed deletion contract instead of treating guessed routes as authoritative.

After each deletion attempt, Karjoo re-reads `/ats/cvs`. A `404` is considered an idempotent success only when the target ID is absent from the refreshed collection. If the ID remains, cleanup fails with the provider status and bounded response detail. Karjoo retries the original tailored PDF submission once only after cleanup is verified.

Karjoo never substitutes the provider's account-level CV for the tailored PDF.

## Jobinja Recovery

Submission navigation can destroy the content-script response channel. That transport event is ambiguous, not a provider rejection. The background waits for the tab to settle and performs an exact job-ID lookup in authenticated Jobinja application history. Exact evidence records `submitted`; no evidence parks the task as `verifying`.

The form adapter supports the current and legacy upload-choice controls. If the form or upload choice is absent, it checks authenticated history, login state, closed-job state, and alternate form controls before returning a classified result. It never clicks an unrelated control.

## Queue Safety

- Provider-confirmed submission is the only path to `submitted`.
- Ambiguous post-submit outcomes become `verifying`.
- Explicit provider refusals remain failed or skipped according to existing policy.
- Provider circuit breakers remain active.
- Repair requeues only recent records matching the corrected reason allowlist.
- Existing application, match, job, and tailored-resume records are retained.

## Release And Repair

1. Add focused tests for deletion verification, stale `404`, Jobinja channel closure, history recovery, and alternate form controls.
2. Run extension and server typechecks and full tests.
3. Build a patch extension and publish the matching server contract.
4. Deploy with the existing blue-green process and verify public assets.
5. Dry-run the recent-failure repair, apply it, and report before/after counts.

