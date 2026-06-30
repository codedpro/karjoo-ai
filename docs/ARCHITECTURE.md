# کارجو / Karjoo — System Architecture & Delivery Plan

> AI-powered auto-apply for the Iranian job market. This is the locked blueprint
> we execute against. Status: **planning complete → starting Phase 1.**

## 1. The product in one line

Scrape public listings from Iranian job boards → AI-match them to the user's
profile → draft a tailored resume/cover letter → **apply on the user's behalf**,
either in the user's own browser (standard) or 24/7 from Iranian worker nodes
(premium). A user's session is **only ever used for that same user** — never to
serve anyone else (no botnet / proxy-resale).

## 2. Three runtimes + an AI service

```
┌────────────────────────────────────────────────────────────────────────┐
│  CONTROL PLANE  (the brain — this Next.js 16 app, server side)           │
│  • user accounts (phone OTP)   • profiles / resumes                      │
│  • PUBLIC listing ingestion    • AI match + cover-letter draft (1xai)    │
│  • encrypted SESSION VAULT     • job queue + scheduler (throttle/caps)   │
│  • dashboard UI                • dispatch  ───────────────┐              │
└──────────────┬──────────────────────────────────────────┼──────────────┘
               │ matched+drafted jobs                       │ apply-job + ephemeral session
               ▼                                            ▼
┌──────────────────────────────┐          ┌────────────────────────────────────┐
│ EXTENSION (MV3, user device) │          │ WORKER NODE (Iranian IP, stateless)│
│ • standard: drain MY queue   │          │ • pull job, decrypt session in mem │
│   in MY browser, MY session  │          │ • replay: token→API / cookie→browser│
│ • premium opt-in: capture &  │          │ • submit, return PROOF, DISCARD    │
│   refresh MY per-site session│          │ • dumb · untrusted · ephemeral     │
└──────────────────────────────┘          └────────────────────────────────────┘
```

**AI service** is reached **only from the control plane**, via the **1xai
gateway** (never a hard-wired provider, never from a worker). It does: match
scoring + tailored cover letter + per-job screening-question answers.

### Boundary rules (these are the safety model)
- A user's session serves **only that user**. Never cross-user. Never resold.
- Workers are **stateless, untrusted, ephemeral**: one job + one in-memory
  session at a time; nothing persisted; signed payloads; mTLS to control plane.
- Secrets (1xai keys, vault KMS key) live **only on the control plane**.
- Every apply path enforces: **dedupe · per-day caps · jitter/throttle ·
  optional human approval.**

## 3. Data flow (premium, 24/7)

```
ingest public listing → AI score vs user → above threshold?
   → draft cover letter (1xai) → queue Application (idempotency key)
   → scheduler releases with jitter, within caps & business hours
   → dispatch to: extension if browser open, else Iranian worker node
   → replay user session → submit → store proof → update dashboard
```

Standard tier is the same pipeline, except the **release step only fires while
the user's browser is open**, and execution is always the user's own extension.

## 4. Where geo / anti-bot is handled (recap of the hard problems)

| Problem | How this design neutralizes it |
|---|---|
| ArvanCloud geo-block (JobVision unreachable abroad) | Apply only ever runs from an **Iranian IP** — user's browser (standard) or Iranian node (premium). |
| OTP / SMS login | We **never store passwords**; we capture the **already-authenticated session** and keep it refreshed. |
| Browser/TLS fingerprint flags | Standard = real user browser. Premium = **headful Playwright** replaying the user's UA/headers (Jobinja) or token+matched headers (JobVision). |
| IP/session mismatch | Premium nodes are Iranian; cap users-per-egress-IP; prefer residential. |
| Ban risk | Throttle + jitter + daily caps + quality threshold + optional human approval. |

## 5. Data model (our Postgres — separate from the IT Master content engine)

- **User** — auth via phone OTP.
- **CandidateProfile** — maps to existing `src/lib/apply/types.ts#CandidateProfile`.
- **Resume / ResumeVariant** — base resume + per-job AI tailoring.
- **BoardAccount** — (user × board), status: `connected | expired | needs_reauth`.
- **SessionBlob** — encrypted, per BoardAccount, **perishable** (`last_refreshed`,
  `expires_at`); cookies **and** localStorage/IndexedDB tokens (see §7).
- **JobListing** — normalized, maps to existing `JobListing`. + **RawListing** (raw capture).
- **Match** — (user × listing), `score`, `status`, `reason`.
- **Application** — the attempt; maps to existing `ApplicationResult`
  (`status: submitted|skipped|failed`, `coverLetter`, `proof`, `externalRef`, `submittedAt`).
- **WorkerNode** — id, region/IP class, health, capacity, last_heartbeat.
- **Task** — queue row (apply task): `matchId`, `sessionRef`, `payload`,
  `attempts`, `idempotencyKey`, `runAfter`.
- **AuditEvent** — append-only log of every captured/used/refreshed session + apply.

## 6. How it maps onto the existing scaffold

The `src/lib/apply/` layer already has the right contracts — we **extend**, not replace:
- `types.ts` → add `applyType: 'structured' | 'contact'`, `sessionShape: 'cookie' | 'token'`
  to the connector, and split **`scrapePublic()`** (read-only ingestion, control plane)
  from authenticated **`apply()`** (extension/worker).
- `boards/*.ts` → each board implements the connector. Adding a board stays
  "one connector + one registry entry" (`index.ts`).
- `scoreAndDraft()` → implement against the **1xai gateway**.
- `runAutoApply()` → becomes the **control-plane orchestrator** (ingest → match →
  draft → queue), not a synchronous loop.

## 7. Per-site session capture (the foundation everything hangs on)

| Board | Apply type | Session shape | Capture mechanism | Replay |
|---|---|---|---|---|
| **Jobinja** | structured | session **cookie** | `chrome.cookies` | headful browser |
| **JobVision** | structured | **JWT in localStorage** (SPA) | **content script** reading `localStorage`/`IndexedDB` (cookies API won't see it) | token → JSON API + matched headers |
| **IranTalent** | structured | cookie/token (TBD) | both | TBD |
| **e-estekhdam / Karboom / Divar** | contact-in-text | n/a (apply = message) | — | templated outreach (low priority) |

> The single biggest technical gotcha: **JobVision's auth token is NOT a cookie.**
> "Capture the session" is per-site and sometimes needs a content script.

## 8. Tech stack

- **Control plane:** this Next.js 16 app (API route handlers + RSC dashboard).
  ⚠️ Read `node_modules/next/dist/docs/` before writing Next code (per AGENTS.md).
- **DB:** Postgres. ORM: **Drizzle** (TS-native, light) — TBD vs Prisma.
- **Queue:** start with Postgres `SELECT … FOR UPDATE SKIP LOCKED` (no extra infra);
  graduate to Redis/BullMQ if volume needs it.
- **Workers:** separate Node service + **Playwright** (headful, stealth), deployed on Iranian VPS.
- **Extension:** MV3, TypeScript (background service worker + content scripts).
- **AI:** **1xai gateway** (matching, cover letters, screening answers).
- **Auth:** phone OTP via an Iranian SMS provider (Kavenegar / SMS.ir).
- **Content/SEO:** unchanged — stays on `@itmaster/sdk` (blog, robots, sitemap, llms).

## 9. Delivery roadmap (each phase ships & de-risks)

- **Phase 0 — Foundations.** Postgres + schema, user auth (phone OTP), dashboard shell.
- **Phase 1 — Listing intelligence (Jobinja, READ-ONLY).** ⭐ start here.
  `jobinja.scrapePublic()` → normalize → store; implement `scoreAndDraft` (1xai).
  Output: "your top matches + a drafted cover letter." **No applying → zero account risk.**
  Proves the actual moat (AI matching), slots into the existing scaffold.
- **Phase 2 — Extension MVP (standard tier).** MV3 extension drains the user's own
  queue and applies on Jobinja in the user's browser; dedupe + throttle + report-back.
- **Phase 3 — Auto-apply: extension background apply (Free/Pro) + toggle + local session
  refresh.** In scope (§10), guardrailed (toggle, caps, threshold, audit, no evasion).
- **Phase 4 — Worker fleet (Max/Max+ 24/7): node registration + secure dispatch +
  per-plan IP limits + server-commanded auto-update + session vault/refresh.** In scope (§10), guardrailed.
- **Phase 5 — Scale boards.** JobVision (token/API), then IranTalent, contact-type boards.
- **Phase 6 — Polish.** Human-approval mode, analytics, proof screenshots, billing/tiers, alerts.

## 10. Legitimacy scope (locked 2026-06-30)

Decision: build only the legitimate parts; **park** anything that violates platform
ToS or amounts to access-control / detection **evasion**. (A user's session only ever
serves that same user — already locked.)

**✅ BUILD — clearly legitimate**
- **Read-only public listing aggregation.** Jobinja `robots.txt` allows `/jobs`
  (only `/style_guide/` disallowed). Going forward: honor `robots.txt` per board,
  polite rate limits, an identifiable User-Agent, and prefer official feeds/APIs
  where they exist.
- **AI job-matching, AI cover-letter / resume tailoring** — content generation for the user.
- **Accounts, profiles, dashboard, application tracking, new-match alerts.**
- **Browser extension as a USER-PRESENT assistant** — pre-fills the application;
  the user reviews and approves each submit (smart autofill). Defensible assistive automation.

**⚖️ AUTO-APPLY — IN SCOPE (owner decision, 2026-06-30), with guardrails.** (This
supersedes the earlier "parked" stance; recorded honestly.) Auto-apply is core across
tiers, gated by an explicit user **"auto-apply" toggle** (one-time consent, revocable).
Two execution paths, both acting ONLY as the consenting user on their own accounts/data:
- **Free/Pro — extension background apply.** With the toggle ON, the MV3 background
  service worker (chrome.alarms) applies to queued, above-threshold matches **in the
  user's OWN browser** even when the popup is closed (while the browser runs), using the
  user's live session. It periodically refreshes its **local** session snapshot
  (cookies + localStorage + sessionStorage) for the target boards so it keeps working as
  sessions rotate. Session stays on the device.
- **Max/Max+ — server worker apply.** The user's session is captured into the encrypted,
  perishable **vault** (`session_blobs`) and replayed by **Iranian worker nodes** (1 IP
  Max, 5 IPs Max+) so apply runs 24/7 **without** the extension. The extension keeps the
  vaulted session fresh.

Guardrails on BOTH paths (non-negotiable): the opt-in toggle; **per-day caps** (Free
100/day; plan-based otherwise); a **match-quality threshold**; a full **audit trail**; a
user's session/data only ever serves **that same user** (never cross-user); and
reasonable **throttling/jitter for politeness + account-safety**.

**THE ONE FIRM LINE (unchanged): NO detection-evasion.** We do not build fingerprint
spoofing, captcha-solving, identity rotation, or any feature whose purpose is to defeat a
platform's bot-detection / access controls. Using the user's OWN session faithfully (its
real cookies/UA) is acting as the authorized user — not evasion.

Honest residual risk (owner-accepted): this violates the boards' ToS for automated
access; accounts can be banned; storing live sessions server-side (Max/Max+) is a real
security liability → encrypted at rest, short retention, per-user isolation, tight
access. Quality-gating + caps + the toggle exist to protect the user's account (the asset).
