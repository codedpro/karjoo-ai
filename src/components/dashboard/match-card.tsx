/**
 * کارتِ یک تطبیق — امتیاز، شرکت/عنوان، شهر/حقوق، دلیلِ AI و پیش‌نمایشِ انگیزه‌نامه.
 *
 * ارائه‌ای (server-safe). پیش‌نمایشِ انگیزه‌نامه با `<details>` باز/بسته می‌شود (بدونِ JS).
 * لینکِ آگهی با rel="nofollow noopener" باز می‌شود (خروجی به سایتِ شخصِ ثالث).
 *
 * چیدمانِ RTL: از property‌های منطقی استفاده می‌شود. عنوان `truncate` می‌شود و
 * `title` می‌گیرد تا هیچ‌وقت زشت دو-خطی نشود؛ نشان‌ها `whitespace-nowrap`اند.
 */
import { ChevronDown } from "lucide-react";

import type { DashboardMatch } from "./data";
import { IconMapPin, IconWallet } from "./icons";
import { boardLabel, MATCH_STATUS } from "./labels";
import { TailorResumeButton } from "./tailor-resume-button";
import { Badge, Card, ScoreRing } from "./ui";

/** بریدنِ متن برای پیش‌نمایش (بدونِ شکستنِ وسطِ کلمه، تقریبی). */
function preview(text: string, max = 180): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  return clean.slice(0, max).trimEnd() + "…";
}

export function MatchCard({ match }: { match: DashboardMatch }) {
  const status = MATCH_STATUS[match.status] ?? MATCH_STATUS.scored;
  const { listing } = match;
  const company = listing.company ?? "شرکت نامشخص";

  return (
    <Card
      padded
      interactive
      className="group/card relative overflow-hidden"
    >
      {/* نوارِ لبه‌ی برند در حاشیه‌ی آغازین — امضای بصریِ ظریف در RTL */}
      <span
        className="pointer-events-none absolute inset-y-0 inset-s-0 w-1 bg-linear-to-b from-brand/70 to-brand-2/40 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100"
        aria-hidden
      />

      <div className="flex items-start gap-4">
        <ScoreRing score={match.score} />

        <div className="min-w-0 flex-1">
          {/* نشان‌ها — نمی‌شکنند؛ در تنگی به خطِ بعد می‌روند نه وسطِ کلمه */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={status.tone}>{status.label}</Badge>
            <Badge tone="muted">{boardLabel(listing.board)}</Badge>
          </div>

          <h3 className="mt-2 truncate text-base font-bold leading-6" title={listing.title}>
            <a
              href={listing.url}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="focus-ring rounded-sm transition-colors hover:text-brand"
            >
              {listing.title}
            </a>
          </h3>

          {/* شرکت + متادیتا — هر آیتم آیکن‌دار و truncate تا در یک خط جمع بماند */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="truncate font-medium text-foreground/80" title={company}>
              {company}
            </span>
            {listing.city ? (
              <span className="inline-flex min-w-0 items-center gap-1" title={listing.city}>
                <IconMapPin className="size-3.5 text-muted/70" />
                <span className="truncate">{listing.city}</span>
              </span>
            ) : null}
            {listing.salary ? (
              <span className="inline-flex min-w-0 items-center gap-1" title={listing.salary}>
                <IconWallet className="size-3.5 text-muted/70" />
                <span className="truncate">{listing.salary}</span>
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {match.reason ? (
        <div className="mt-4 rounded-xl border-s-2 border-brand/40 bg-brand/4 py-2.5 pe-3.5 ps-3">
          <p className="text-pretty text-sm leading-7 text-muted">
            <span className="font-semibold text-foreground">چرا مناسب است؟ </span>
            {match.reason}
          </p>
        </div>
      ) : null}

      {match.coverLetter ? (
        <details className="group mt-3">
          <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-1 py-1 text-sm font-semibold text-brand marker:content-['']">
            پیش‌نمایشِ انگیزه‌نامه
            <ChevronDown
              strokeWidth={1.75}
              className="size-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <p className="mt-2 whitespace-pre-line text-pretty rounded-xl border border-border bg-surface/70 px-3.5 py-3 text-sm leading-8 text-muted">
            {preview(match.coverLetter, 600)}
          </p>
        </details>
      ) : null}
      {/* رزومه‌ی سفارشیِ هر شغل — جایگزینِ انگیزه‌نامه (به‌ویژه برای جابینجا). */}
      <TailorResumeButton listingId={match.listingId} />
    </Card>
  );
}
