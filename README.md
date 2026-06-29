# کارجو (Karjoo) — اپلای هوشمند کار با هوش مصنوعی

> AI‑powered job‑application assistant for the Iranian market (JobVision, Jobinja,
> e‑estekhdam, Karboom, …). Fully Persian / RTL. Built on Next.js 16 + the
> **@itmaster/sdk** content engine client.

کارجو رزومه‌ی کاربر را با آگهی‌های شغلی سایت‌های کاریابی ایران تطبیق می‌دهد و با هوش
مصنوعی به‌صورت خودکار اپلای می‌کند. این مخزن شامل لندینگ فارسی و زیرساخت محتوا
(وبلاگ/سئو) است؛ موتور اپلای خودکار به‌صورت داربست (scaffold) آماده‌ی توسعه است.

## Stack

- **Next.js 16** (App Router, `src/`, TypeScript, Turbopack)
- **Tailwind CSS v4**
- **Vazirmatn** (Persian font, via `next/font`)
- **@itmaster/sdk** — pull‑API client for the IT Master content engine

## Content engine connection (@itmaster/sdk)

This site is a registered **TargetSite** in the IT Master engine:

| | |
|---|---|
| Site slug (`PUBLISH_SITE`) | `karjoo-ai` |
| Owner | `dev.codedpro` |
| Engine (`ITMASTER_API_URL`) | `http://127.0.0.1:8088` (local) |

The SDK is wired in [`src/lib/itmaster.ts`](src/lib/itmaster.ts) and used by:

- `/blog` and `/blog/[slug]` — articles pulled from the engine
- `/robots.txt`, `/sitemap.xml`, `/llms.txt` — engine‑managed, dashboard‑controlled
- `/api/itmaster-webhook` — publish → revalidate (set `PUBLISH_PUSH_SECRET` to enable)
- `src/app/layout.tsx` — head tags (verification/analytics) from the engine `site_config`

> The per‑site **pull key** is stored only in `.env.local` (gitignored). The engine
> stores just its hash. Rotate via `POST /v1/publish/sites`.

## Getting started

```bash
cp .env.example .env.local   # fill in PUBLISH_PULL_KEY (already set locally)
npm install
npm run dev                  # http://localhost:3000
```

`.env.local` is pre‑populated for local development against the engine on `:8088`.
For production, point `ITMASTER_API_URL` at the public engine origin and update
`NEXT_PUBLIC_SITE_URL`.

## Auto‑apply engine (scaffold)

The platform‑agnostic apply layer lives in [`src/lib/apply/`](src/lib/apply/):

- `types.ts` — domain contracts (`JobBoardConnector`, `JobListing`, `CandidateProfile`, …)
- `boards/jobvision.ts`, `boards/jobinja.ts` — per‑board connectors (stubs)
- `index.ts` — connector registry + `scoreAndDraft` (AI matching) + `runAutoApply` pipeline

These throw `not implemented` by design — no scraping/automation is wired yet.
Adding a job board = one new connector implementing `JobBoardConnector` + one entry
in the registry. AI matching/cover‑letter generation should go through the 1xai
gateway, never a hard‑wired provider URL.

## Project layout

```
src/
  app/
    layout.tsx            RTL + Vazirmatn + engine head tags
    page.tsx              Persian landing page
    blog/                 SDK‑backed blog (list + article)
    robots.txt/ sitemap.xml/ llms.txt/   turnkey SDK routes
    api/itmaster-webhook/ publish → revalidate
  components/             SiteHeader, SiteFooter
  lib/
    itmaster.ts           engine client (server‑only)
    site.ts               brand identity
    apply/                auto‑apply engine (scaffold)
```
