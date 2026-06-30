# Karjoo Worker Node (کارجو — ناوگانِ کارگر)

A stateless, ephemeral **Iranian worker node** for Karjoo's **Max / Max+** plans. It
applies to above-threshold matches **24/7 on the user's behalf** — without the
extension — by replaying **the user's OWN session** from inside an Iranian IP.

It is the server-side counterpart to the extension's background apply: same
guardrails (§10 of `docs/ARCHITECTURE.md`), same `apply-spec`, but it runs
unattended on a VM with a headful Playwright browser.

```
control plane (Next.js)                 worker node (this package, Iranian VM)
─────────────────────────              ───────────────────────────────────────
POST /api/fleet/enroll      ◀── once ── enroll with the one-time token → credential
POST /api/fleet/heartbeat   ◀── loop ── health + agentVersion
POST /api/fleet/claim       ──────────▶ jobs for THIS node's assigned users, each
                                         carrying the user's server-DECRYPTED session
POST /api/fleet/result      ◀────────── per-job outcome + non-secret proof
POST /api/fleet/commands    ◀── loop ── pending update/restart commands
POST /api/fleet/commands/:id/ack ─────▶ acked → done/failed
```

> **The vault key never leaves the control plane.** The server decrypts the
> session **per job** and sends only that decrypted session to the **assigned**
> node, over the authenticated channel. The node uses it **in memory for one job**
> and **discards** it. It is **never logged and never written to disk.**

---

## The firm line: NO detection-evasion

The node replays the user's **own** cookies, **own** localStorage/sessionStorage
tokens, and **own** User-Agent — **faithfully**. That is acting as the authorized
user. The node does **not** spoof fingerprints, solve captchas, or rotate
identities. (See `docs/ARCHITECTURE.md` §10.)

Other guardrails enforced in the node:

- **Scaffold boards are never blind-submitted.** Only `jobinja` has a
  "best-effort real" apply-spec; `jobvision` / `e-estekhdam` / `irantalent` are
  scaffolds (`TODO(real-account)`). The node **records `skipped`** for them rather
  than risk a wrong submit on a real account.
- **Daily cap is the server's.** A result POST that returns **HTTP 429** stops the
  drain for the tick — the node does not keep applying past the cap.
- **Politeness.** A base delay **+ jitter** is inserted **between** applies.
- **The server gates everything.** `claim` only returns jobs for users **assigned
  to this node** whose **auto-apply toggle is ON, are under the cap, and above the
  threshold** — the node cannot widen that.

---

## Requirements

- **Node.js ≥ 20.**
- A **system Chromium/Chrome** on the VM. We depend on **`playwright-core`**, which
  **downloads no browsers**; you point the node at an installed Chromium via
  `KARJOO_BROWSER_PATH`. (On Debian/Ubuntu: `apt-get install -y chromium`, then
  set `KARJOO_BROWSER_PATH=/usr/bin/chromium`.)
- Network egress from an **Iranian IP** to your control plane.

> CI / build never needs a browser: `npm install && npm run build && npm test` all
> pass **without** Chromium (the browser is mocked in the unit tests).

---

## Configuration (environment variables)

| Var | Required | Default | Meaning |
|---|---|---|---|
| `KARJOO_API` | ✅ | — | Control-plane base URL, e.g. `https://karjoo.ir`. |
| `KARJOO_NODE_KEY` | ✅ | — | This node's **stable** key. The server recognizes the node by it (upsert key). Make it unique per VM. |
| `KARJOO_FLEET_ENROLLMENT_TOKEN` | first run | — | One-time enrollment secret (must match the control plane's). Needed only until the credential is persisted. |
| `KARJOO_BROWSER_PATH` | to apply | — | Path to a system Chromium (we never download one). Without it, best-effort apply jobs fail to launch. |
| `KARJOO_NODE_REGION` |  | — | IP/region label, e.g. `IR-residential`. |
| `KARJOO_AGENT_VERSION` |  | `0.1.0` | Reported in heartbeats (fleet-state visibility). |
| `KARJOO_CREDENTIAL_PATH` |  | `.karjoo-worker/credential.json` | Where the issued credential is persisted (file, `0600`). |
| `KARJOO_HEADLESS` |  | `false` | Run the browser headless. §10 prefers headful/real. |
| `KARJOO_CLAIM_LIMIT` |  | `5` | Max jobs claimed per tick (1–25). Server enforces the real daily cap. |
| `KARJOO_LOOP_INTERVAL_SEC` |  | `60` | Seconds between ticks. |
| `KARJOO_POLITENESS_BASE_MS` |  | `4000` | Base delay between applies. |
| `KARJOO_POLITENESS_JITTER_MS` |  | `6000` | Random jitter added to the base delay. |
| `KARJOO_STEP_TIMEOUT_MS` |  | `15000` | Per-step Playwright timeout. |
| `KARJOO_FLEET_UPDATE_SCRIPT` |  | `./update.sh` | Script the server-commanded `update` runs (pull+restart). |

---

## Run it on a VM

### 1. Install + build

```bash
git clone <your-fork> karjoo-worker && cd karjoo-worker/worker
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci      # downloads NO browser
npm run build                                   # → dist/
```

Install a system Chromium and note its path:

```bash
sudo apt-get update && sudo apt-get install -y chromium
which chromium    # e.g. /usr/bin/chromium
```

### 2. First run = enroll

The first run enrolls with the one-time token and **persists the credential**.
After that the token is no longer needed (the node authenticates with the
credential).

```bash
export KARJOO_API="https://karjoo.ir"
export KARJOO_NODE_KEY="ir-vps-tehran-1"
export KARJOO_NODE_REGION="IR-residential"
export KARJOO_FLEET_ENROLLMENT_TOKEN="<the-one-time-token>"
export KARJOO_BROWSER_PATH="/usr/bin/chromium"

node dist/main.js
# → "enrolling node …" then "node enrolled; credential persisted"
# → then the loop: heartbeat → claim → process → commands
```

The credential is written to `KARJOO_CREDENTIAL_PATH` (`0600`). **Protect that
file** — it authenticates this node. It is git-ignored; never commit it.

On later runs you can omit `KARJOO_FLEET_ENROLLMENT_TOKEN` entirely.

### 3. Run as a service (systemd example)

`/etc/systemd/system/karjoo-worker.service`:

```ini
[Unit]
Description=Karjoo worker node
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/karjoo/worker
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5
Environment=KARJOO_API=https://karjoo.ir
Environment=KARJOO_NODE_KEY=ir-vps-tehran-1
Environment=KARJOO_NODE_REGION=IR-residential
Environment=KARJOO_BROWSER_PATH=/usr/bin/chromium
# First boot only — remove after the credential is persisted:
# Environment=KARJOO_FLEET_ENROLLMENT_TOKEN=...
# Keep the credential file owner-only:
Environment=KARJOO_CREDENTIAL_PATH=/opt/karjoo/worker/.karjoo-worker/credential.json

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now karjoo-worker
journalctl -u karjoo-worker -f
```

`Restart=always` is what makes the **`restart`** command work: the node acks the
command, exits, and systemd brings it back up.

---

## Server-commanded auto-update

The control plane can issue two commands; the node polls them each tick:

- **`update`** → runs the configured **`update.sh`** (pull → reinstall → rebuild →
  restart via your supervisor), then acks `done` (or `failed` with the exit code).
  Edit `update.sh` for your deployment (systemd / pm2 / docker). The script path can
  also be sent in the command payload (`payload.updateScript`).
- **`restart`** → acks `done`, then exits so the supervisor restarts the process.

The node reports its `agentVersion` in every heartbeat so the server sees fleet
state after an update.

---

## Develop & test

```bash
npm run dev        # run from source via tsx (no build step)
npm run typecheck  # tsc --noEmit
npm test           # vitest — NO real browser, NO network
```

The unit tests cover, with the browser **mocked** and the API exercised through an
**injectable fetch**:

- **enroll + credential persistence** (`enroll.test.ts`, `credential-store.test.ts`)
  — first-run enroll, second-run reuse, re-enroll on a changed node key, fatal when
  neither credential nor token exists.
- **claim → process → report** end to end (`agent.test.ts`, `processor.test.ts`) —
  session injection (cookies + storage init script + UA), apply-spec fill+submit,
  non-secret proof, the **daily-cap (429) stop**, and the **politeness** delay.
- **command handling** (`commands.test.ts`) — `update` runs the script and acks
  `acked→done`/`failed`; `restart` acks then restarts; ack failures don't crash.
- **§10 "session is NEVER logged"** (`logger.test.ts`, plus assertions in
  `processor.test.ts` / `agent.test.ts`) — the redacting logger scrubs cookie/token/
  storage material even if a caller passes a whole session object.
- **apply-spec-driven fill** (`apply-plan.test.ts`) — the cover letter is resolved
  into the fill step; optional steps with no value drop; the worker's jobinja
  selectors are asserted to **match the control-plane `apply-spec.ts`**.

---

## File map

```
worker/
├── package.json            # karjoo-worker — playwright-core, NO browser download
├── tsconfig.json           # NodeNext, strict
├── vitest.config.ts        # node env, no browser/network
├── update.sh               # the server-commanded update script (edit per deploy)
├── .npmrc                  # PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD belt-and-suspenders
└── src/
    ├── main.ts             # entrypoint: load config → ensure credential → run loop
    ├── lib/
    │   ├── config.ts       # env → WorkerConfig + politeness delay
    │   ├── logger.ts       # REDACTING logger (§10 session-never-logged)
    │   ├── types.ts        # FleetJob / SessionBundle / result / command wire types
    │   ├── apply-spec.ts   # mirror of src/lib/apply/apply-spec.ts (selectors)
    │   ├── apply-plan.ts   # APPLY_SPEC → resolved fill plan (mirror of the ext runner)
    │   ├── api-client.ts   # the ONLY control-plane caller (Bearer credential)
    │   ├── credential-store.ts # persist the issued credential (0600)
    │   ├── enroll.ts       # bootstrap: load persisted credential or enroll once
    │   ├── session-inject.ts   # bundle → cookies + storage init script + UA
    │   ├── browser.ts      # narrow Playwright surface + playwright-core launcher
    │   ├── processor.ts    # one job: inject → fill+submit → proof → DISCARD
    │   ├── commands.ts     # update/restart handling
    │   └── agent.ts        # the tick + main loop (heartbeat→claim→process→commands)
    └── test/               # fake browser + typed fetch mock (test-only)
```
