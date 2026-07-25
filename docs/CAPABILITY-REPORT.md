# karjoo-ai — Capability & Feature Report

**Date:** 2026-07-25 · **Branch:** `feat/control-plane-mvp` · **Method:** 12 parallel subsystem auditors (code + targeted tests + live probes + read-only DB), plus direct live testing of the running stack.

> **Honesty caveat — read this first.** The audit ran 12 subsystem auditors (all completed) and 12 adversarial verifiers (**all 12 failed — the account hit its monthly spend limit**). So the *gap* claims below did **not** get the independent refutation pass they were designed to get. To compensate, **I personally re-verified all 7 critical findings** against live code, the live app and the live database — those are marked ✅ **verified by me**. The medium/low findings are single-source and should be treated as leads, not facts.

---

## 1. Scoreboard

**263 distinct capabilities** were catalogued across 12 subsystems.

| Status | Count | Meaning |
|---|---:|---|
| ✅ working | 158 | verified by test, probe, or complete reachable code path |
| 🟡 partial | 69 | real but incomplete/limited |
| 🔴 broken | 8 | exists but demonstrably fails |
| ⚪ stub | 12 | scaffold / not implemented |
| ❔ unverified | 16 | exists in code, behaviour not confirmed |

| Subsystem | Maturity | Caps | working / partial / stub / broken |
|---|---:|---:|---|
| Auth, sessions & account security | **78** | 20 | 16 / 2 / 0 / 0 |
| Discovery, filters & matching | 62 | 21 | 12 / 5 / 1 / 2 |
| Fleet control plane & worker | 62 | 27 | 19 / 4 / 3 / 0 |
| Résumé engine | 62 | 20 | 13 / 4 / 0 / 0 |
| Jobinja integration | 62 | 20 | 9 / 7 / 2 / 1 |
| Billing, wallet & plans | 62 | 21 | 11 / 7 / 2 / 1 |
| AI layer & metering | 62 | 24 | 12 / 10 / 0 / 1 |
| Vault & §10 security | 62 | 21 | 16 / 2 / 1 / 0 |
| Public site, content & SEO | 57 | 21 | 10 / 8 / 3 / 0 |
| Browser extension (MV3) | 57 | 22 | 11 / 7 / 0 / 2 |
| Auto-apply pipeline & queue | 55 | 20 | 15 / 5 / 0 / 0 |
| Ops, observability & scheduling | 52 | 26 | 14 / 8 / 0 / 1 |

**Gaps found:** 159 total — 7 critical, 29 high, 76 medium, 47 low.

---

## 2. What I tested live this session (direct evidence)

| Test | Result |
|---|---|
| Full server test suite | **970/970 pass** (97 files) |
| Worker test suite | **75/75 pass** (10 files) |
| Extension test suite | **27 files, 0 failures** |
| Live Jobinja E2E (loads the real packaged extension, drives a real account) | **7/7 pass**, 0 browser leaks |
| Every dashboard page (17) | 307 → `/login` — auth gate correct, **zero 500s** |
| Every public/API route probed (26) | correct 200 / 401 / 405 — **zero 500s** |
| Public surface | `/` 200, `/blog` 200, article 200, `sitemap.xml` 200, `robots.txt` 200, OG image 200 (PNG), JSON-LD present |
| **1xAi AI gateway round-trip** | **live** — 219 models listed; real chat completion returned with token usage |
| Fleet worker restart (in-band `restart` command, no kill) | issued → node acked `done` → exited itself → keepalive relaunched on the fresh build |
| Full end-to-end apply (2026-07-21) | remote IT job → AI-tailored résumé → PDF → uploaded via real apply form → **verified in `/jobs/applied`** |

---

## 3. The headline: *built* ≠ *running*

The engineering is far ahead of the operation. Live database census — **15 of 34 tables have data, 19 are empty**, and the empty ones are the entire value chain:

| Has data | Empty (the value chain) |
|---|---|
| users (4), auth_sessions (9), device_links (7), wallets (3), wallet_ledger (11), ai_model_catalog (8), resume_files (3), board_accounts (2), candidate_profiles (1), worker_nodes (1), user_auto_apply (2) | **job_categories, job_listings, raw_listings, matches, tasks, applications, board_applications, board_profile_snapshots, session_blobs, worker_assignments, user_interests, user_server_auto_apply, usage_records, resumes, filter_cursors, payment_requests, plan_purchases** |

**The scheduler has fired 1,045 times over 7 days and returned `eligible: 0` every single time.** It is healthy (HTTP 202, `errors: 0`) — it simply finds nobody to work for. The eligibility query (`src/lib/apply/discovery-scheduler.ts:127-145`) requires an **INNER JOIN on a live `session_blobs` row** *and* an enabled `user_server_auto_apply` row. Both tables are empty, so:

```
no vaulted session ──┐
                     ├──► eligible: 0 ──► no matches ──► no tasks ──► no applies
server toggle off ───┘
```

Nothing is broken here — these are unset preconditions. But **no user has ever received the core promise of the product.**

---

## 4. Critical findings (all 7 ✅ verified by me)

### C1 — `job_categories` is empty → the interests feature is silently destructive
`/api/categories` returns `{"count":0,...}`; DB `job_categories = 0`, `user_interests = 0`. Worse than dead: `PUT /api/interests` accepts a selection, filters every slug against the empty table, **deletes the user's existing interests**, returns 0, and wipes `titles`/`categories` in `candidate_profiles.preferences`. The seeder (`src/lib/taxonomy/seed.ts`) is only called from `src/db/seed-catalog.ts` — never run on this DB. *(BACKLOG #9 marks this "fixed" — it is not, on this database.)*

### C2 — The 24/7 auto-apply chain has never produced one application
Evidence in §3. Every link is built, guarded and green in tests; end-to-end throughput is exactly zero.

### C3 — The fleet is running but dormant — zero user↔node assignments
`worker_assignments = 0`, so `claimFleetJobs` returns `[]` immediately (`src/lib/fleet/dispatch.ts:192-193`). The live node has heartbeated ~98 ticks claiming nothing. Even if C2 were fixed, the queue would **fill and never drain**, because assignment is admin-only and nothing assigns a node when a user enables the toggle.

### C4 — Browser auto-apply is unreachable: a cookie/Bearer auth mismatch
**Single root cause, three dead features.** The extension calls 10 server routes with a `Bearer` token and no cookies. `readSessionToken()` (`src/lib/auth/http.ts:60-63`) reads **only** the `karjoo_session` cookie. Three of those routes are cookie-only:

| Route | Auth | Extension feature it kills |
|---|---|---|
| `/api/auto-apply` | cookie-only ✗ | the popup's browser auto-apply toggle **and** the 15-min drain tick |
| `/api/apply/find-jobs` | cookie-only ✗ | "پیدا کردن شغل‌ها" button in the popup |
| `/api/me/plan` | cookie-only ✗ | premium detection → **session-vault push never fires** (which is *why* `session_blobs` is empty → C2) |

Live probe: `GET /api/auto-apply` with a Bearer token → **401**. All the drain logic exists and passes 15/15 tests — it can never run. Fixing these three routes is cheap and unlocks the most product value of anything in this report.

### C5 — Every article self-canonicalizes to a 404, and the sitemap points at the wrong domain
Rendered canonical: `https://karjoo.1xai.ir/maharat-shoghl-2026-karfarma` → **404** (real URL is `/blog/<slug>` → 200). The sitemap is worse: `https://karjooai.itmaster.uk/maharat-...` — a **different host** from `NEXT_PUBLIC_SITE_URL=https://karjoo.1xai.ir`. Cause: the content engine sets `canonical_path` without the `/blog` prefix and carries its own site host. **The blog is effectively unindexable** — all content marketing spend is wasted.

### C6 — Plans are sold monthly but never expire or renew
No `plan_expires_at` / `renews_at` / subscription column exists (0 matches in `src/db/schema.ts`); no renewal or downgrade cron (0 entries). `purchasePlan` debits once and sets `users.plan` forever. **One payment of 299,000 toman = Pro for life; 1,990,000 = Max+ (5 worker IPs) for life.** Direct, unbounded revenue leak.

### C7 — No database backups at all
`crontab` has backup jobs for **three sibling projects** (`ukvision-ai`, `1xai`, `xray-market` — one even has weekly verify) and **zero for karjoo**, whose Postgres holds users, `wallet_ledger`, `payment_requests` and the encrypted session vault. Single Docker volume, no dump, no retention. A volume loss or bad migration is unrecoverable.

---

## 5. High-severity findings (29 — single-source, unverified)

**Money & correctness**
- No sweeper for stranded open plan purchases — a crashed upgrade leaves the customer **charged with no plan**.
- Global AI cap (~2.1M toman/month) can kill AI for **all** paying users, even though karjoo pays nothing for it (users' own 1xAi wallets).
- Server discovery and fleet dispatch **ignore `users.is_active`** — a deactivated user keeps getting charged and applied for.

**Reliability**
- **No stale-lease reaper and no retry** (queue *and* fleet): a task a node fails to report on is stuck `leased` forever; a crashed tick loses those jobs permanently.
- A single undecryptable vault blob **500s the entire `/api/fleet/claim`** and strands already-leased tasks.
- Expired vault sessions are still decrypted and dispatched, and are never purged.
- No key-rotation path — rotating `KARJOO_VAULT_KEY` permanently bricks every stored session.
- The admin "update" button **hard-resets the entire production repo** (`worker/` is not its own git repo).

**Product completeness**
- Enabling the server toggle does not assign a fleet node (→ C3).
- The per-job custom résumé is **never generated automatically** — "apply while you sleep" never tailors; the differentiator only fires on manual click.
- The extension **cannot upload a résumé file** — custom-résumé-per-job is worker-only.
- Jobinja profile-snapshot upsert replaces `data` wholesale — the write **destroys the `cvId` it needs**, so profile write-back works at most once.
- Jobinja category fetch omits User-Agent → 403 → picker permanently shows **20 of 48** categories.
- Minimum-salary filter is a **no-op** (scalar `filters[sal_min]` vs Jobinja's indexed range array) — verified: filtered and unfiltered searches return byte-identical listings.
- Card-to-card payment requests: the admin console works, but **nothing can create a request** (`createPaymentRequest` has no caller) — the only Iranian payment path is dead.
- Live AI price sync is dead — the gateway has no `/pricing` endpoint, so catalog prices are permanently stale seeds.

**Auth & ops**
- Extension "sign out" never revokes the server session; there is no "log out everywhere"; nothing in the codebase can set `is_active = false` (banning is manual SQL).
- **No alerting or dead-man's switch** on any cron or on production errors — the pipeline is idle and nothing would tell you if it broke.
- Loki fully wired but effectively unused (1 log line in 7 days).
- Sentry's `/monitoring` ad-blocker tunnel 404s.
- Zero automated tests cover the public site, content engine, or SEO routes.

---

## 6. What genuinely works well

Credit where due — these are verified strengths:

- **Auth (78/100, the most mature subsystem).** Opaque 256-bit server-side sessions, only an HMAC-with-pepper hash stored, httpOnly/Secure/SameSite cookies, one-time 160-bit 10-minute pairing codes, per-IP *and* per-email rate limiting (live-verified: the 6th OAuth start is blocked), OAuth state CSRF with constant-time compare, fail-closed guards. karjoo **never stores a password hash** — identity is delegated to the 1xAi pool.
- **The §10 security model.** AES-GCM vault with key versioning; the worker decrypts, uses, and discards; proof payloads carry only non-secret descriptors (screenshot *byte size*, never bytes). Sessions never leak into logs.
- **The Jobinja apply path is real and proven** — a genuine application was submitted and verified, including AI-tailored résumé → PDF → upload.
- **The fleet control plane is well-designed**: enrollment with hashed credentials, heartbeat/health, claim→process→result, and an in-band `update`/`restart` command channel that I exercised successfully (node acked and restarted itself, no signals).
- **The AI gateway is live and metered** — 219 models, real completions, per-user wallet accounting at 1xAi rates.
- **Test discipline is strong**: 970 + 75 + extension tests green, plus a committed live-browser E2E that loads the real extension.

---

## 7. Recommended features & improvements

### Tier 1 — Unlock what you already built (days, not weeks; highest ROI)

1. **Accept Bearer on the 3 extension routes** (C4). One small change to `/api/auto-apply`, `/api/apply/find-jobs`, `/api/me/plan` revives browser auto-apply, popup job search, **and** the session-vault push that everything else waits on.
2. **Seed `job_categories` on deploy** (C1) and make `PUT /api/interests` refuse to delete when the taxonomy is empty (fail-closed instead of silent data loss).
3. **Auto-assign a fleet node when a user enables server auto-apply** (C3) — respecting the plan's IP limit. Without this the queue can never drain.
4. **Tailor the résumé inside the discovery path** so "apply while you sleep" actually uses the differentiator instead of only firing on a manual click.
5. **Onboarding checklist that names the blocker.** The single biggest product gap is that a user can turn everything on and *nothing happens, silently*. Show: session connected? résumé uploaded? toggle on? node assigned? wallet funded? — with a one-click fix for each.

### Tier 2 — Stop the leaks

6. **Plan expiry + renewal** (C6) — add `plan_expires_at`, a renewal/downgrade job, and a grace period. This is money on the floor today.
7. **Revive card-to-card payments** — the admin console is built and tested but has no way to receive a request; in Iran this is the primary payment rail.
8. **Nightly `pg_dump` + weekly restore verify** (C7) — copy the sibling projects' scripts; you have three working examples on the same box.
9. **Lease reaper + bounded retry** for both the queue and the fleet, so a crashed tick doesn't silently lose a user's applications.
10. **Fix canonical + sitemap host** (C5) — this alone makes the entire blog indexable.
11. **Dead-man's switch on the scheduler** — alert if `eligible > 0` never happens for N hours, or if a cron misses its window. Today the pipeline has been idle for a week in total silence.

### Tier 3 — New capabilities worth building

12. **Outcome tracking & funnel analytics.** `board_applications` already models pending → review → interview → rejected, and the Jobinja parser reads real statuses — it's just never synced. Surfacing *"40 applications → 6 viewed → 2 interviews"* turns the product from "it applies" into "it works", and it's the strongest retention hook available.
13. **Résumé variant A/B testing.** You generate a unique résumé per job already. Track which variants correlate with employer views/interviews and feed that back into the tailoring prompt. **Nobody in this market has this**, and the data plumbing is 80% there.
14. **Telegram bot + notifications.** In Iran, Telegram beats email decisively. Daily digest ("3 applied while you slept, 1 employer viewed your CV"), plus approve/reject-a-match inline. Cheap to build, huge for engagement and trust.
15. **"Why this job" match explanations.** You already spend AI on scoring — surfacing one sentence of reasoning converts a black box into something a user trusts enough to leave running unattended.
16. **Interview prep from the job description.** Natural upsell on an existing AI seam: likely questions, gaps between the JD and their CV, and a suggested pitch. High perceived value, low marginal cost (billed to the user's own wallet).
17. **Broaden beyond Jobinja.** Jobvision, IranTalent and E-estekhdam are scaffolds. Jobinja alone caps the addressable market; the apply-spec architecture is designed for this and the E2E harness pattern now exists to validate each board against reality.
18. **Salary insights.** `raw_listings`/`job_listings` are empty but modelled — aggregated salary-by-role/city data is a genuinely valuable free-tier magnet and an SEO content engine that would actually rank.
19. **Profile completeness coach.** Score the user's Jobinja CV against the roles they target and tell them exactly what to fix — you already have both read and **write** access to their Jobinja profile.

### Tier 4 — Strategic

20. **Referral loop** — job seekers share aggressively when something works.
21. **Public "proof" page** — anonymized stats (applications sent, interviews landed). This category has a trust problem; verifiable numbers are the cheapest moat.

---

## 8. Suggested order of work

```
Week 1  C4 (Bearer) → C1 (seed) → C3 (auto-assign) → onboarding checklist
        = the loop actually closes for a real user, end to end
Week 2  C7 (backups) → C6 (plan expiry) → lease reaper → dead-man's switch
        = stop losing data, money, and jobs silently
Week 3  C5 (SEO) → outcome analytics (#12) → Telegram digest (#14)
        = growth + retention on top of a loop that now runs
```

---

*Auditors covered: auth · discovery/matching · auto-apply queue · fleet control plane · résumé engine · Jobinja integration · billing/wallet/plans · AI layer · vault/security · extension · content/SEO · ops/observability. Critical findings independently re-verified against live code, the running app, and the live database. Medium/low findings did not receive the adversarial verification pass and remain unconfirmed leads.*
