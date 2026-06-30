/**
 * پنل‌های ارائه‌ایِ صفحه‌ی «اپلای خودکار» (server-safe، بدونِ state/I/O).
 *
 * سه پنل: مصرفِ امروز نسبت به سقف، آمادگیِ حساب‌های متصل، و ردِ ممیزیِ اپلای خودکار.
 * فقط استایل/چیدمان؛ داده از RSC پاس داده می‌شود. هیچ رازی، هیچ کوئری.
 */
import { Badge, Card, EmptyState, toFaDigits } from "./ui";
import {
  applyUsageLabel,
  applyUsagePct,
  autoApplyEventLabel,
  boardLabel,
} from "./auto-apply-labels";
import { BOARD_ACCOUNT_STATUS } from "./labels";
import type {
  AutoApplyAuditRow,
  BoardReadiness,
} from "./auto-apply-data";
import type { ApplyUsageStatus } from "./plan-data";

/* ─────────────────────────  مصرفِ اپلای امروز  ───────────────────────── */

export function ApplyUsagePanel({ apply }: { apply: ApplyUsageStatus }) {
  const pct = applyUsagePct(apply.usedToday, apply.limit);
  const atCap = apply.limit !== null && apply.usedToday >= apply.limit;

  return (
    <Card className="p-6">
      <h3 className="text-base font-bold">سقفِ اپلای امروز</h3>
      <p className="mt-1 text-sm text-muted">
        اپلای خودکار هرگز از سقفِ روزانه‌ی پلنِ شما فراتر نمی‌رود.
      </p>

      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="ltr-nums text-2xl font-extrabold">
            {toFaDigits(apply.usedToday)}
          </span>
          <span className="text-sm text-muted">
            {toFaDigits(applyUsageLabel(apply.usedToday, apply.limit))}
          </span>
        </div>

        {apply.limit !== null ? (
          <div
            className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-foreground/10"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full rounded-full transition-all ${
                atCap ? "bg-rose-500" : "bg-brand"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">
            پلنِ شما سقفِ روزانه ندارد.
          </p>
        )}

        {atCap ? (
          <p className="mt-3 rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-xs leading-6 text-rose-600 dark:text-rose-400">
            به سقفِ امروز رسیده‌اید؛ اپلای خودکار تا فردا متوقف است.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/* ─────────────────────────  آمادگیِ حساب‌های متصل  ───────────────────────── */

export function BoardReadinessPanel({ boards }: { boards: BoardReadiness[] }) {
  return (
    <Card className="p-6">
      <h3 className="text-base font-bold">آمادگیِ سایت‌ها</h3>
      <p className="mt-1 text-sm text-muted">
        اپلای خودکار فقط روی سایت‌هایی اجرا می‌شود که حساب‌تان متصل و مشخصاتِ اپلای آن
        آماده باشد.
      </p>

      {boards.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-card/50 px-4 py-5 text-center text-sm text-muted">
          هنوز حسابی متصل نشده است. برای اتصال، افزونه‌ی کارجو را نصب و وارد سایت شوید.
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {boards.map((b) => {
            const status =
              BOARD_ACCOUNT_STATUS[b.status] ?? BOARD_ACCOUNT_STATUS.needs_reauth;
            const ready = b.specReady && b.status === "connected";
            return (
              <li
                key={b.board}
                className="flex items-center justify-between gap-2 rounded-xl border border-border px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{boardLabel(b.board)}</div>
                  <div className="text-xs text-muted">
                    {b.specReady
                      ? "مشخصاتِ اپلای آماده است"
                      : "مشخصاتِ اپلای هنوز آزمایشی/در حالِ ساخت است"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {ready ? (
                    <Badge tone="green">آماده</Badge>
                  ) : (
                    <Badge tone="muted">ناآماده</Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ─────────────────────────  ردِ ممیزیِ اپلای خودکار  ───────────────────────── */

export function AutoApplyAuditPanel({ audit }: { audit: AutoApplyAuditRow[] }) {
  if (audit.length === 0) {
    return (
      <EmptyState
        icon="🧾"
        title="هنوز رویدادی ثبت نشده"
        body="هر روشن/خاموش‌شدنِ تاگل و هر تلاش/ردِ اپلای خودکار اینجا ثبت می‌شود تا همیشه بدانید چه اتفاقی افتاده."
      />
    );
  }

  return (
    <Card className="p-6">
      <h3 className="text-base font-bold">ردِ ممیزیِ اپلای خودکار</h3>
      <p className="mt-1 text-sm text-muted">
        فهرستِ شفافِ تصمیم‌ها و تلاش‌های اخیرِ اپلای خودکار (تازه‌ترین اول).
      </p>

      <ul className="mt-4 space-y-2.5">
        {audit.map((row) => {
          const meta = autoApplyEventLabel(row.eventType);
          const score = extractScore(row.metadata);
          return (
            <li
              key={row.id}
              className="flex items-start gap-3 rounded-xl border border-border px-3.5 py-3"
            >
              <span className="mt-0.5 text-lg" aria-hidden>
                {meta.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{meta.label}</span>
                  <Badge tone={meta.tone}>{toFaDigits(faDate(row.createdAt))}</Badge>
                </div>
                {meta.description ? (
                  <p className="mt-0.5 text-xs leading-6 text-muted">
                    {meta.description}
                  </p>
                ) : null}
                {score !== null ? (
                  <p className="mt-0.5 text-xs text-muted">
                    امتیاز: <span className="ltr-nums">{toFaDigits(score)}٪</span>
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** امتیاز را از metadata (score یا minScore، در بازه‌ی ۰..۱) به درصدِ صحیح می‌کشد. */
function extractScore(meta: Record<string, unknown> | null): number | null {
  if (!meta) return null;
  const raw = meta.score ?? meta.minScore;
  if (typeof raw !== "number" || Number.isNaN(raw)) return null;
  return Math.round(Math.min(1, Math.max(0, raw)) * 100);
}

/** تاریخِ کوتاهِ فارسی (تقویمِ شمسی، منطقه‌ی تهران) — صرفاً نمایشی. */
function faDate(d: Date): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}
