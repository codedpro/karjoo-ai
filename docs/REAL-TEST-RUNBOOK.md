# کارجو — Real-Test Runbook

Everything below was verified end-to-end against the production build on this box
(account → session → plans/models/wallet → extension pair/link/connect → auto-apply
toggle → queue claim). The only step that needs **you** is the final board login +
submit, since that uses your real Jobinja/JobVision account.

## 0. Prereqs (already set up on this box)
- Postgres (docker) on host port **55432**; all migrations applied; model catalog seeded.
- `.env.local` (gitignored) has: `DATABASE_URL` (55432), `AUTH_TOKEN_PEPPER`, **1xai** wired
  (`ONEXAI_*`, model `gpt-4o-mini`), `KARJOO_VAULT_KEY`, `INTERNAL_API_SECRET`,
  `KARJOO_FLEET_ENROLLMENT_TOKEN`.
- **SMS is not configured** → the OTP is printed in the server console (dev mode).

If the DB isn't running: `KARJOO_DB_PORT=55432 docker compose up -d db`

## 1. Start the app
```bash
cd ~/karjoo-ai
npm run build
PORT=3100 npm run start        # → http://localhost:3100
```
> Note: `npm run dev` currently fails on THIS host — Turbopack hits the OS inotify
> file-watch limit (the box runs many containers). Use `build` + `start` (production,
> no file watchers), or raise it: `sudo sysctl fs.inotify.max_user_watches=524288`.

## 2. Create your account (phone OTP)
1. Open `http://localhost:3100/login` → enter your phone (E.164, e.g. `+98912...`).
2. The OTP is in the **server console**: `[sms:dev] OTP برای <phone>: <code>`. Enter it.
3. You land in the dashboard (`/dashboard`).

## 3. Build your profile
- **Résumé** (`/dashboard/resume`): upload your PDF → text extraction is **free**; the
  AI field-extraction is a **paid** action (needs wallet balance — see step 4).
- **Interests** (`/dashboard/interests`): pick categories → feeds search/matching.

## 4. Add AI credit + pick a model
- **Billing** (`/dashboard/billing`): use the dev **top-up** to add Toman to your wallet.
  Every AI action (matching, cover letters, résumé parse) meters tokens × model price ×
  (1 + margin) and debits the wallet. Free actions (PDF text, applying) never charge.
- **Models** (`/dashboard/models`): pick a model (default `gpt-4o-mini`; `claude-*` works
  once the gateway's Anthropic limit resets). Tags: recommended / premium / cheap / fast / persian.

## 5. Load the browser extension
```bash
cd ~/karjoo-ai/extension && npm install && npm run build   # → extension/dist
```
- Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
  select `~/karjoo-ai/extension/dist`.
- Point the extension at your server (API base = `http://localhost:3100`) — see
  `extension/README.md` for the config field.

## 6. Pair the extension (no second OTP)
- Dashboard → "connect extension" → copy the **pairing code**.
- Extension popup → paste the code → it links and stores its own token. (Verified: this
  exchanges the code for an extension session bound to your account — no second OTP.)

## 7. Connect your job boards
- Log into **Jobinja / JobVision** in the same Chrome profile.
- Extension → "connect boards" → it detects your logged-in session locally and registers
  the account with Karjoo as **connected** (metadata only — your cookies/tokens are NOT
  sent to the server on the Free/Pro path).

## 8. Turn on auto-apply
- `/dashboard/auto-apply` → flip the **toggle ON** (set the match-score threshold).
- With the toggle on + boards connected, the extension's **background service worker**
  drains your above-threshold matches and fills + submits applications on the board pages
  (politeness throttle + the Free **100/day** cap). Every attempt is in the **audit log**.
- Run an ingest/match first so there's something to apply to (the matches page populates
  from live Jobinja listings → AI scoring).

## 9. (Premium, optional) server workers — Max/Max+
For 24/7 apply without the browser open, a worker VM replays your **vaulted** session:
- Push your session to the encrypted vault (`POST /api/session/refresh`, done by the
  extension for premium users).
- Stand up a worker (see `worker/README.md`): set `KARJOO_API`, `KARJOO_NODE_KEY`,
  `KARJOO_FLEET_ENROLLMENT_TOKEN` → it enrolls, gets a credential, and claims jobs.
- Admin assigns the node to your user (within the plan's IP limit: Max=1, Max+=5).

## What's stubbed (needs a real account / VM to finish)
- Per-board **submit selectors**: Jobinja is best-effort; JobVision/e-estekhdam/IranTalent
  are scaffolded (`TODO(real-account)`) — confirm the exact DOM/selectors against a real login.
- Real **SMS** (Kavenegar/SMS.ir) and **Zarinpal** top-up are dev-stubbed for now.
- A real **worker VM** with an Iranian IP for the Max/Max+ path.
