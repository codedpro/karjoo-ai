# Karjoo (کارجو) — MV3 browser extension

A **user-present, user-approved** assisted-apply helper for Iranian job boards
(Jobinja, JobVision). It is the "standard tier" client from
`docs/ARCHITECTURE.md` (Phase 2): it drains **your own** approved apply queue in
**your own** browser, pre-fills the application form, and lets **you** review and
submit. There is **no unattended auto-submit**.

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

## Legitimacy boundary (docs §10 — the whole point)

> **The raw third-party cookie / token / password NEVER leaves the browser.**

- Local session detection returns a **boolean** ("are you logged in?"), derived
  from cookie/localStorage **key names** only — never values. See
  `src/lib/board-detect.ts`.
- The connect call body is built by the single chokepoint
  `src/lib/connect-payload.ts#buildConnectPayload`, which **throws**
  (`SecretLeakError`) if any secret-shaped key is present. The test
  `src/lib/connect-payload.test.ts` proves the payload is exactly
  `{ board, status, accountLabel? }`.
- Every submission requires an explicit user action. There is **no** background
  submit, **no** "humanization" / anti-detection / fingerprint-evasion code.

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
  content/jobinja.js
  content/jobvision.js
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
  manifest.json              MV3 manifest (minimal host permissions)
  scripts/build.mjs          esbuild bundler + static copy
  src/
    background/service-worker.ts   trusted core: owns token, routes messages
    content/
      apply-dom.ts           DOM pre-fill applier (no submit)
      jobinja.ts             Jobinja content script (cookie board → prefill)
      jobvision.ts           JobVision content script (token probe + prefill)
    popup/
      popup.html  popup.css  popup.ts  messaging.ts
    lib/
      config.ts              origin + storage keys + board registry
      messages.ts            typed runtime-message contracts
      types.ts               domain types (Identity, queue item, connect payload)
      api-client.ts          the only module that calls the Karjoo server
      storage.ts             injectable chrome.storage wrapper
      connect-payload.ts     ★ metadata-only payload builder + no-secret guard
      board-detect.ts        local login detection (boolean only)
      pairing-code.ts        pairing-code sanitize/validate
      prefill-plan.ts        pure pre-fill planning (no submit)
      queue-view.ts          queue → render-ready card views
```

## API endpoints consumed (owned by the control plane)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/extension/link` | `{ code }` | `{ token, identity? }` |
| GET | `/api/extension/me` | — | `Identity` |
| POST | `/api/board-accounts/connect` | `{ board, status:"connected", accountLabel? }` | `{ ok }` |
| POST | `/api/apply-queue/claim` | — | `{ items: ApplyQueueItem[] }` |
| POST | `/api/apply-queue/:id/result` | `ApplyResultReport` | `{ ok }` |

All authed calls send `Authorization: Bearer <karjoo-extension-token>` — never a
board credential.
