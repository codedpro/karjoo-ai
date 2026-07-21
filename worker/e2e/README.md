# Karjoo × Jobinja live E2E

Automated end-to-end tests that load the **real packaged extension** into Playwright's
Chromium and drive a **live Jobinja account** — validating the parts only real Jobinja can
prove, which unit tests (fixtures) can't.

## What it checks

| # | Check | Why it needs live Jobinja |
|---|-------|---------------------------|
| T1 | The packaged extension loads (MV3 service worker registers) | manifest + world:MAIN wiring |
| T2 | Login to Jobinja | session/CSRF flow can drift |
| T3 | `/jobs/applied` is parseable (items + statuses) | the analytics funnel source |
| T4 | Apply-spec selectors resolve on a **real** job (`#apply-form`, résumé-choice radios, file input, submit) — **no submit** | selectors drift when Jobinja redesigns |
| T5 | The extension's **main-world hook captures the cvId** (via a reversible, restored headline edit) | the cvId is a client-side hashid only observable in-page |
| T6 | *(opt-in `E2E_WRITE=1`)* the profile-write path (`basic-data` PUT) round-trips + **restores** | proves the vaulted write end to end |

**Safety:** read-only except the reversible headline edit in T5 (and the opt-in T6) — both
restore the exact original value. Chromium is always closed (SIGTERM-safe), no leaks.

## Prerequisites (one time)

```bash
cd worker && npx playwright install chromium   # full Chromium (system Chrome gates --load-extension)
sudo apt-get install -y xvfb                    # virtual display for the headful extension browser
```

## Credentials

Put them in `worker/e2e/.env.e2e` (gitignored) — already created for the dev account:

```
JB_USER=you@example.com
JB_PASS=…
# E2E_WRITE=1   # opt in to the reversible profile-write check
```

No credentials → the suite prints `SKIP` and exits 0 (safe for CI without secrets).

## Run

```bash
npm run test:e2e            # from worker/  (builds the extension, then runs)
# or:  worker/e2e/run.sh
E2E_WRITE=1 npm run test:e2e   # include the reversible profile-write round-trip
```

Exit code: `0` pass/skip, `1` any failure. Runs headful under xvfb, ~30–60s.
