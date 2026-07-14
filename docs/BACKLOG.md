# karjoo-ai — bug & incomplete-feature backlog

Generated from a multi-agent audit (8 subsystem scanners → 55 raw findings → deduped, ranked). Ranked by (severity × user impact) ÷ effort. Effort: S <1h · M few hrs · L 1–2 days · XL bigger.

> State of the codebase: a mid-pivot control-plane MVP. The plumbing (fleet claim/decrypt/node, metering, quotas, Jobinja scraping) is more complete than the product. The value chain is broken at both ends: monetization is an unguarded dev stub (free self-grant of paid tiers), and the "apply while you sleep" promise is unscheduled (queues stay empty). Fastest high-value wins are cheap.

| # | Title | Kind | Sev | Effort | Status |
|---|-------|------|-----|--------|--------|
| 1 | DEV billing stubs let any user self-grant paid plans + mint wallet credit | security | critical | S | ✅ fixed |
| 2 | AI-filter batch keeps calling paid gateway after wallet empty (uncharged spend) | bug | high | S | ✅ fixed |
| 3 | 401 from web-cookie route wrongly un-pairs the extension (re-pair loop) | bug | high | M | ✅ fixed (v0.2.7) |
| 4 | Apply messages a fresh tab before its content script loads (spurious fail) | bug | high | M | ✅ fixed (v0.2.7) |
| 5 | Popup 8s send timeout shorter than the ops it wraps (looks broken) | bug | high | M | ✅ fixed (v0.2.7) |
| 6 | Matches page falsely claims "no session stored on server" | bug | high | S | ✅ fixed |
| 7 | Bearer sessions ignore user deactivation (banned users keep access) | security | high | M | ✅ fixed |
| 8 | candidate_profiles has no UNIQUE(user_id) — dupe race drops filter prefs | bug | high | M | ✅ fixed (migration 0012 applied) |
| 9 | job_categories never seeded — interests taxonomy empty, selections dropped | incomplete | high | S | ✅ fixed |
| 10 | Monthly credit-grant cron 400s on empty-body POST — grants never run | bug | high | S | ✅ fixed |
| 11 | Pivot's default free flow (filter apply) undiscoverable / dead-ends | incomplete | high | M | ✅ fixed — «جست‌وجوی مشاغل» button in the apply-filters editor now POSTs `/api/apply/find-jobs` (was uncalled from any UI); dashboard empty-state CTA points to filters. |
| 12 | No scheduler wired — 24/7 discovery never auto-runs | incomplete | high | M | ✅ built — `POST /api/internal/top-up` (guardInternal) runs `runServerDiscovery`: eligible users (toggle on + worker plan + valid session) → AI-filtered `runFilterApply`, per-user error isolation, fail-closed on balance. **Owner must enable the cron + enroll ≥1 fleet worker** (see runbook below). (monthly credits retired in 1xAi unification.) |
| 13 | Filter apply caps at first ~25 listings — no pagination cursor | incomplete | high | L | ✅ fixed — `filter_cursors` (migration 0016) per (user, board, filter-sig); `runFilterApply` scrapes from the persisted page, advances by pages consumed, resets to 1 at end. Cursor holds when a run is cut short by daily-cap/balance so no listing is skipped. |
| 14 | find-jobs synchronous scrape per click, no rate limit (self IP-ban) | security | high | M | ✅ fixed |
| 15 | No revocation path for extension sessions / stored board credentials | incomplete | high | L | ✅ fixed — `GET /api/sessions` + `DELETE /api/sessions/[id]` (revoke a device, user-scoped) and `DELETE /api/board-accounts/disconnect` (deletes the vaulted `session_blobs` so the server can no longer act; sets `needs_reauth`). Dashboard UI: per-board «قطع اتصال» + per-device «لغو دسترسی». Audit-logged. |
| 16 | Daily apply cap can be overshot by claimLimit-1 (anti-ban breach) | bug | medium | S | ✅ fixed |
| 17 | claim detail query scans ALL user tasks per poll (unbounded) | tech-debt | medium | S | ✅ fixed |
| 18 | API 500s swallowed — never reach Sentry, no alerting | bug | medium | S | ✅ fixed |
| 19 | Empty-filter guard wrong layer + wrong predicate | bug | medium | S | ✅ fixed |
| 20 | Resume upload buffers full body before 5MB check (OOM DoS) | security | medium | S | ✅ fixed |
| 21 | Only Jobinja functional — other 3 boards are scaffolds | incomplete | medium | L | ✅ gated — `BOARD_STATUS`/`isBoardLive`/`liveBoardIds` in registry; connect route 409-rejects non-live boards before any write; orchestrator skips non-live boards. Scaffolds stay in the union (extension knows them) but can't be connected/run. |
| 22 | Jobinja APPLY_SPEC selectors unverified best-effort guesses | incomplete | medium | M | ⛔ blocked — needs a live logged-in Jobinja account to record/verify the real apply-form selectors. **Owner action.** |
| 23 | Real payment flow (sell paid tiers) | incomplete | medium | XL | ✅ done via **card-to-card** (کارت‌به‌کارت): user submits transfer + reference → admin approves → credit/upgrade. No self-credit. Set `KARJOO_CARD_NUMBER`/`KARJOO_CARD_HOLDER` in env. |

Plus: **onboarding** — server-computed "شروعِ کار" checklist on the dashboard (résumé → filters → connect), streamed + auto-hiding. (in progress)

Details for each item live in the audit transcript; fixSketches were captured per finding.

---

## Runbook — enabling the 24/7 server discovery scheduler (#12)

The discovery endpoint is built and guarded but **not self-triggering**. Two owner actions turn it on:

1. **Schedule the cron** (external — Next.js self-hosted has no built-in cron). Hit the guarded endpoint every ~10 min with the shared secret:

   ```cron
   */10 * * * * curl -fsS -X POST http://127.0.0.1:3030/api/internal/top-up \
     -H "x-internal-secret: $INTERNAL_API_SECRET" >/dev/null 2>&1
   ```

   Use the loopback host (the route is internal-only; never expose it publicly). `INTERNAL_API_SECRET` must match `.env.local`. The route is idempotent and fail-closed (503 if the secret is unset).

2. **Enroll ≥1 fleet worker.** Discovery only *fills* the queue (`tasks`); the fleet **drains** it and does the actual apply. With no enrolled/running worker node, jobs accumulate but nothing is submitted. See the fleet claim path (`/api/fleet/claim`, `worker_assignments`).

Eligibility (recomputed each run): server-auto-apply toggle ON **and** a worker-tier plan **and** a valid (non-expired, connected) board session. Each eligible user is AI-filtered at their own `minScore`, charged to their own 1xAi wallet; **no balance → skipped, no spend**.

Cost/robustness guarantees (so the cron can fire frequently and safely):
- **No double-charge on overlap** — the run holds a Postgres advisory lock; a second cron tick that overlaps a still-running one returns immediately (`skippedLocked`).
- **No re-charge on re-scan** — each `(user, listing)` is AI-scored **once**; later runs reuse the stored score. The daily-cap gate also sits *before* scoring, so listings beyond the day's budget are never charged.
- **Bounded + fair** — each run processes at most `DEFAULT_DISCOVERY_BATCH` (100) users, ordered by least-recently-served (never-served first), within a `DEFAULT_DISCOVERY_BUDGET_MS` (~4 min) wall-clock budget; the rest are `deferred` and prioritized next tick. No user starves.
