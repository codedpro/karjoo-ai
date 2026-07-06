# karjoo-ai — bug & incomplete-feature backlog

Generated from a multi-agent audit (8 subsystem scanners → 55 raw findings → deduped, ranked). Ranked by (severity × user impact) ÷ effort. Effort: S <1h · M few hrs · L 1–2 days · XL bigger.

> State of the codebase: a mid-pivot control-plane MVP. The plumbing (fleet claim/decrypt/node, metering, quotas, Jobinja scraping) is more complete than the product. The value chain is broken at both ends: monetization is an unguarded dev stub (free self-grant of paid tiers), and the "apply while you sleep" promise is unscheduled (queues stay empty). Fastest high-value wins are cheap.

| # | Title | Kind | Sev | Effort | Status |
|---|-------|------|-----|--------|--------|
| 1 | DEV billing stubs let any user self-grant paid plans + mint wallet credit | security | critical | S | ✅ fixed |
| 2 | AI-filter batch keeps calling paid gateway after wallet empty (uncharged spend) | bug | high | S | ✅ fixed |
| 3 | 401 from web-cookie route wrongly un-pairs the extension (re-pair loop) | bug | high | M | ⬜ |
| 4 | Apply messages a fresh tab before its content script loads (spurious fail) | bug | high | M | ⬜ |
| 5 | Popup 8s send timeout shorter than the ops it wraps (looks broken) | bug | high | M | ⬜ |
| 6 | Matches page falsely claims "no session stored on server" | bug | high | S | ✅ fixed |
| 7 | Bearer sessions ignore user deactivation (banned users keep access) | security | high | M | ⬜ |
| 8 | candidate_profiles has no UNIQUE(user_id) — dupe race drops filter prefs | bug | high | M | ⬜ |
| 9 | job_categories never seeded — interests taxonomy empty, selections dropped | incomplete | high | S | ✅ fixed |
| 10 | Monthly credit-grant cron 400s on empty-body POST — grants never run | bug | high | S | ✅ fixed |
| 11 | Pivot's default free flow (filter apply) undiscoverable / dead-ends | incomplete | high | M | ⬜ |
| 12 | No scheduler wired — 24/7 discovery + monthly credits never auto-run | incomplete | high | M | ⬜ |
| 13 | Filter apply caps at first ~25 listings — no pagination cursor | incomplete | high | L | ⬜ |
| 14 | find-jobs synchronous scrape per click, no rate limit (self IP-ban) | security | high | M | ⬜ |
| 15 | No revocation path for extension sessions / stored board credentials | incomplete | high | L | ⬜ |
| 16 | Daily apply cap can be overshot by claimLimit-1 (anti-ban breach) | bug | medium | S | ⬜ next |
| 17 | claim detail query scans ALL user tasks per poll (unbounded) | tech-debt | medium | S | ✅ fixed |
| 18 | API 500s swallowed — never reach Sentry, no alerting | bug | medium | S | ✅ fixed |
| 19 | Empty-filter guard wrong layer + wrong predicate | bug | medium | S | ✅ fixed |
| 20 | Resume upload buffers full body before 5MB check (OOM DoS) | security | medium | S | ✅ fixed |
| 21 | Only Jobinja functional — other 3 boards are scaffolds | incomplete | medium | L | ⬜ |
| 22 | Jobinja APPLY_SPEC selectors unverified best-effort guesses | incomplete | medium | M | ⬜ |
| 23 | Implement real Zarinpal payment flow (sell paid tiers) | incomplete | medium | XL | ⬜ |

Plus: **onboarding** — server-computed "شروعِ کار" checklist on the dashboard (résumé → filters → connect), streamed + auto-hiding. (in progress)

Details for each item live in the audit transcript; fixSketches were captured per finding.
