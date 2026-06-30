/**
 * کارتِ یک تطبیق — امتیاز، شرکت/عنوان، شهر/حقوق، دلیلِ AI و پیش‌نمایشِ انگیزه‌نامه.
 *
 * ارائه‌ای (server-safe). پیش‌نمایشِ انگیزه‌نامه با `<details>` باز/بسته می‌شود (بدونِ JS).
 * لینکِ آگهی با rel="nofollow noopener" باز می‌شود (خروجی به سایتِ شخصِ ثالث).
 */
import type { DashboardMatch } from "./data";
import { boardLabel, MATCH_STATUS } from "./labels";
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

  return (
    <Card className="p-5 transition-colors hover:border-brand/40">
      <div className="flex items-start gap-4">
        <ScoreRing score={match.score} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <Badge tone="muted">{boardLabel(listing.board)}</Badge>
          </div>

          <h3 className="mt-2 truncate text-base font-bold">
            <a
              href={listing.url}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="transition-colors hover:text-brand"
            >
              {listing.title}
            </a>
          </h3>

          <p className="mt-0.5 truncate text-sm text-muted">
            {listing.company ?? "شرکت نامشخص"}
            {listing.city ? ` · ${listing.city}` : ""}
            {listing.salary ? ` · ${listing.salary}` : ""}
          </p>
        </div>
      </div>

      {match.reason ? (
        <p className="mt-4 rounded-xl bg-foreground/[0.03] px-3.5 py-2.5 text-sm leading-7 text-muted">
          <span className="font-medium text-foreground">چرا مناسب است: </span>
          {match.reason}
        </p>
      ) : null}

      {match.coverLetter ? (
        <details className="group mt-3 [&_summary]:cursor-pointer">
          <summary className="flex items-center justify-between text-sm font-medium text-brand marker:content-['']">
            پیش‌نمایش انگیزه‌نامه
            <span className="text-muted transition-transform group-open:rotate-45">+</span>
          </summary>
          <p className="mt-2 whitespace-pre-line rounded-xl border border-border bg-card px-3.5 py-3 text-sm leading-8 text-muted">
            {preview(match.coverLetter, 600)}
          </p>
        </details>
      ) : null}
    </Card>
  );
}
