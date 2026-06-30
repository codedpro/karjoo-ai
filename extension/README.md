# Karjoo (کارجو) — MV3 browser extension

An assisted-apply **and** opt-in background auto-apply helper for Iranian job
boards (Jobinja, JobVision, e-estekhdam, IranTalent). Two paths, both acting
**only as you, on your own accounts, in your own browser**:

1. **Assisted apply (default).** Drains **your own** approved apply queue, pre-fills
   the form, and lets **you** review and submit. No background submit unless you
   opt in (below).
2. **Background auto-apply (opt-in — docs §10, Phase 3).** When **you** turn on the
   **auto-apply toggle**, an MV3 background service worker (`chrome.alarms`)
   periodically drains your pending, **above-threshold** apply queue and fills +
   submits the application on the board page in **your own** browser — even when
   this popup is **closed**, as long as the browser is running. Every apply is
   gated by a **per-day cap**, a **match-quality threshold**, and writes an **audit
   event**. The toggle is **revocable** at any time.

> **Honesty note (it's in the code and here):** the service worker can only run
> **while the browser is running**. It **cannot** apply with the browser fully
> closed — that is the **Max/Max+ worker tier** (server-side Iranian worker nodes,
> docs §10 / Phase 4), not this extension.

**The one firm line (docs §10): no detection-evasion.** No fingerprint spoofing,
no captcha solving, no identity rotation. Auto-apply uses **your own session**
(its real cookies / localStorage token) in **your own** browser — acting as the
authorized user, not defeating a bot detector.

This extension is self-contained: it has its own `package.json` and build and
does **not** touch the root Next.js app or its dependencies.

## What it does

1. **Pairing (no second OTP).** You log into Karjoo on the web with phone OTP,
   the dashboard shows a one-time **pairing code**, you paste it into the popup.
   The extension calls `POST {KARJOO_API}/api/extension/link`, receives a Karjoo
   **extension session token**, and stores it in `chrome.storage`. Signed-in
   state is confirmed via `GET /api/extension/me`. (Legitimacy rule 5.)

2. **Connect boards.** For each board the extension detects, **locally in your
   browser**, whether you are logged in:
   - **Jobinja** keeps auth in a **cookie** → read via `chrome.cookies`
     (cookie *names* only).
   - **JobVision** is an SPA with a **JWT in `localStorage`** → a content script
     reports which *key names* exist.

   On "Connect" it POSTs `/api/board-accounts/connect` with **only**
   `{ board, status: "connected", accountLabel? }`.
   **It never sends the raw cookie / token / password** — see Legitimacy below.

3. **Assisted apply.** It fetches your approved queue
   (`POST /api/apply-queue/claim`), shows each job as a card with the AI cover
   letter, and a content script **pre-fills** (never submits) the form on the
   board site. **You** click submit on the page; the popup's "تأیید و ارسال"
   records the approved outcome via `POST /api/apply-queue/:id/result`.

4. **Background auto-apply (opt-in).** In the popup's "اپلای خودکار" tab you flip
   the toggle on (server-stored consent). A `chrome.alarms` job then runs every
   ~15 min and, **only while the toggle is ON and boards are connected**:
   - fetches the **server-authoritative** settings (the server is the source of
     truth — the toggle, the threshold, and the daily cap all live there),
   - claims your gated queue (`POST /api/apply-queue/claim` returns items only
     when ON + under the daily cap + above your threshold; otherwise an empty
     queue with `reason: 'disabled' | 'quota_exceeded'`),
   - for each item, drives the **per-board APPLY content script** to fill the
     cover letter and **submit** the public form (APPLY_SPEC selectors — Jobinja
     best-effort real; the others scaffolded with `TODO(real-account)`),
   - reports the outcome (`POST /api/apply-queue/:id/result`); a **429** there
     means the daily cap is reached → it **stops** the drain.
   It waits a small **jittered politeness delay** (≈2–8 s) between applies and
   applies only a small **per-tick budget**. All the gating decisions are pure and
   unit-tested in `src/lib/apply-runner.ts`.

5. **Local session refresh.** A second `chrome.alarms` job periodically recaptures
   **your current** session for connected boards — cookies via `chrome.cookies`
   (Jobinja, e-estekhdam) and `localStorage`/`sessionStorage` via a content-script
   probe (JobVision, IranTalent) — and keeps a **fresh LOCAL snapshot**
   (`chrome.storage.local`) so background apply keeps working as the board rotates
   the session. For **Free/Pro** that snapshot **stays on the device** and is never
   transmitted. For **Max/Max+** the same snapshot is **also** pushed to your
   **own** encrypted server vault via `POST /api/session/refresh` (the server
   encrypts it AES-256-GCM at rest). That endpoint is the **only** place raw
   session material is ever sent, and only ever **your own** session for **your
   own** auto-apply.

## Legitimacy boundary (docs §10 — the whole point)

> **No detection-evasion. Your session only ever serves you.**

- **Login DETECTION** returns a **boolean** ("are you logged in?"), derived from
  cookie/localStorage **key names** only — never values. See
  `src/lib/board-detect.ts`.
- **The connect call** body is built by the single chokepoint
  `src/lib/connect-payload.ts#buildConnectPayload`, which **throws**
  (`SecretLeakError`) if any secret-shaped key is present — it sends exactly
  `{ board, status, accountLabel? }`.
- **The apply-RESULT payload** is built by `src/lib/apply-result-payload.ts`,
  another fail-closed chokepoint that **throws** on any credential-shaped key — it
  sends only `{ id, status, externalRef?, reason? }`. The test
  `src/lib/apply-result-payload.test.ts` proves the result carries **no secret**.
- **Session refresh is the one exception, and a deliberate one.** To replay your
  own session, the LOCAL snapshot necessarily contains your real session material.
  It stays in `chrome.storage.local` and is sent to exactly **one** endpoint —
  `POST /api/session/refresh`, your **own** encrypted vault, premium only — and
  **nowhere else**. The non-secret descriptor used for indexing exposes
  names/keys only (proven in `src/lib/session-snapshot.test.ts`).
- **No anti-detection code.** No fingerprint spoofing, no captcha solving, no
  identity rotation, no synthetic "trust" event flags. The auto-apply executor
  (`src/content/apply/apply-executor.ts`) just fills the public form and clicks
  the real submit button, dispatching plain `input`/`change` events — and it
  **never blindly submits**: a missing required selector aborts with a failure.
- **Auto-apply is gated, not silent.** Nothing applies unless **you** turned the
  toggle on; every apply respects the **daily cap** + **threshold** and is
  recorded server-side (audit). The gating is pure + unit-tested in
  `src/lib/apply-runner.ts` (never applies when the toggle is OFF or the cap is
  reached).

## Build

```bash
cd extension
npm install
npm run build        # → dist/  (loadable unpacked extension)
npm run typecheck    # strict TS, no emit
npm test             # vitest unit tests (no browser, no network)
```

`npm run build` produces a loadable `dist/`:

```
dist/
  manifest.json
  background.js
  popup.html  popup.css  popup.js
  content/jobinja.js  content/jobvision.js          (login-detect + assisted pre-fill)
  content/import/{jobinja,jobvision,eestekhdam,irantalent}.js   (profile import — DATA only)
  content/apply/{jobinja,jobvision,eestekhdam,irantalent}.js    (auto-apply executor; jobinja best-effort, rest scaffold)
  content/session-probe.js                          (localStorage/sessionStorage capture for local refresh)
  icons/icon-16.png  icon-48.png  icon-128.png
```

### Configure the Karjoo API origin

- **Build time:** `KARJOO_API=https://app.karjoo.ai npm run build` inlines the
  default origin.
- **Runtime:** the popup's "تنظیمات پیشرفته" lets you set/override the origin; it
  is persisted in `chrome.storage` (`karjoo.apiOrigin`).

Default: `http://localhost:3000`. If you point the extension at a non-localhost
or HTTPS origin, add that origin to `host_permissions` in `manifest.json` and
rebuild.

## Load the unpacked extension (Chrome / Edge / Brave)

1. `npm run build` (creates `dist/`).
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** → select the `extension/dist` folder.
5. Pin "Karjoo" and open the popup.
6. Paste your pairing code from the Karjoo dashboard → **اتصال**.

To reload after a rebuild, click the refresh icon on the extension card.

## Project layout

```
extension/
  manifest.json              MV3 manifest (+ alarms/tabs perms; apply + probe scripts)
  scripts/build.mjs          esbuild bundler + static copy
  src/
    background/
      service-worker.ts      trusted core: owns token, routes messages, wires alarms
      auto-apply.ts          ★ background auto-apply tick (alarm → claim → apply → report)
      session-refresh.ts     local session recapture + (premium) vault push
    content/
      apply-dom.ts           assisted DOM pre-fill applier (no submit)
      jobinja.ts  jobvision.ts            login-detect + assisted prefill
      apply/
        apply-executor.ts    ★ APPLY_SPEC step runner (fill + submit; realm-safe)
        register.ts          per-board CONTENT_APPLY handler (board-match guard)
        jobinja.ts           best-effort real; jobvision/eestekhdam/irantalent scaffold
      session-probe.ts       localStorage/sessionStorage capture (CAPTURE_STORAGE)
    popup/
      popup.html  popup.css  popup.ts  messaging.ts   (+ "اپلای خودکار" toggle tab)
    lib/
      config.ts              origin + storage keys + board registry
      messages.ts            typed runtime-message contracts
      types.ts               domain types (+ AutoApplySettings/Status, PlanTier)
      api-client.ts          the only module that calls the Karjoo server
      storage.ts             injectable chrome.storage wrapper (+ snapshots/settings)
      connect-payload.ts     ★ metadata-only connect builder + no-secret guard
      apply-result-payload.ts ★ auto-apply result builder + no-secret guard
      board-detect.ts        local login detection (boolean only)
      apply-spec.ts          ★ APPLY_SPEC (mirrors Foundation) + url match/maturity
      apply-runner.ts        ★ PURE auto-apply gating (toggle/cap/threshold) + plan
      auto-apply-config.ts   alarm intervals + politeness jitter math
      auto-apply-view.ts     Persian status/label rendering for the popup tab
      session-snapshot.ts    local session model + vault-refresh body builder
      pairing-code.ts        pairing-code sanitize/validate
      prefill-plan.ts        pure pre-fill planning (no submit)
      queue-view.ts          queue → render-ready card views
```

## API endpoints consumed (owned by the control plane)

| Method | Path | Body | Returns | Notes |
|---|---|---|---|---|
| POST | `/api/extension/link` | `{ pairingCode }` | `{ token }` | pairing (no 2nd OTP) |
| GET | `/api/extension/me` | — | `{ user, boards }` | boards = metadata only |
| POST | `/api/board-accounts/connect` | `{ board, accountLabel? }` | `{ account }` | server `.strict()` |
| POST | `/api/apply-queue/claim` | `{ limit? }` | `{ count, items }` or `{ count:0, items:[], reason }` | `reason` = `disabled`/`quota_exceeded` |
| POST | `/api/apply-queue/:id/result` | `{ status, externalRef?, reason? }` | `{ application, taskStatus }` or **429** | 429 = daily cap reached |
| GET | `/api/auto-apply` | — | `{ enabled, minScore }` | **web-cookie** authed; **401/404 → fail-closed OFF** |
| PUT | `/api/auto-apply` | `{ enabled?, minScore? }` | `{ enabled, minScore }` | the toggle (consent); web-cookie authed |
| GET | `/api/me/plan` | — | `{ plan, … }` | web-cookie authed; decides vault eligibility (fail-closed `free`) |
| POST | `/api/session/refresh` | `{ board, session:{cookies?,localStorage?,sessionStorage?,userAgent?,capturedAt?}, expiresAt? }` | `{ board, sessionShape, lastRefreshed, expiresAt }` | extension-bearer; **Max/Max+ only**; the ONE session transmission; server encrypts at rest |
| POST | `/api/profile/import` | `{ board, payload }` | import summary | DATA-only |

Bearer-authed calls (`link`, `me`, `connect`, `claim`, `result`, `session/refresh`,
`import`) send `Authorization: Bearer <karjoo-extension-token>` — never a board
credential.

> **Auth note (intentional split):** `/api/auto-apply` and `/api/me/plan` are authed
> by the **Karjoo web-session cookie** (`getCurrentUser`), not the extension bearer
> token. The extension's same-origin fetch carries that cookie automatically when
> the user is also signed into Karjoo on the web in this browser. If the cookie is
> absent (401) or a route is missing (404), the settings read **fails closed to
> OFF** and the vault push is skipped (the snapshot stays local) — so the
> dashboard remains the authoritative place to grant auto-apply consent, and the
> background tick is **also** gated server-side by the claim route regardless.
