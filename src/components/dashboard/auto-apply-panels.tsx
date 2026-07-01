/**
 * پنل‌های ارائه‌ایِ صفحه‌ی «اپلای خودکار» (server-safe، بدونِ state/I/O).
 *
 * سه پنل: مصرفِ امروز نسبت به سقف، آمادگیِ حساب‌های متصل، و ردِ ممیزیِ اپلای خودکار.
 * فقط استایل/چیدمان؛ داده از RSC پاس داده می‌شود. هیچ رازی، هیچ کوئری.
 *
 * زبانِ بصری روی پرایمیتیوهای مشترک (Card/Badge/SectionHeading/EmptyState) و آیکن‌های
 * درون‌خطیِ SVG (بدونِ ایموجی) سوار است. برچسب‌ها با `whitespace-nowrap`/`min-w-0`+`truncate`
 * از شکستِ زشتِ دو-خطی مصون‌اند؛ متن‌های بدنه `text-pretty`.
 */
import { Badge, Card, EmptyState, SectionHeading, cn, toFaDigits } from "./ui";
import {
  IconBolt,
  IconCheck,
  IconGauge,
  IconPlug,
  IconReceipt,
  IconServer,
  IconWarn,
} from "./icons";
import {
  applyUsageLabel,
  applyUsagePct,
  autoApplyEventLabel,
  boardLabel,
} from "./auto-apply-labels";
import { BOARD_ACCOUNT_STATUS } from "./labels";
import type {
  AutoApplyAuditEventType,
  AutoApplyAuditRow,
  BoardReadiness,
} from "./auto-apply-data";
import type { ApplyUsageStatus } from "./plan-data";

/* ────────────────────────  آیکنِ‌باکسِ سرسطرِ پنل  ───────────────────────── */

/** آیکن‌باکسِ کوچکِ رنگی برای سرِ هر پنلِ کناری — لحن (tone) رنگ را می‌دهد. */
function PanelIcon({
  children,
  tone = "brand",
}: {
  children: React.ReactNode;
  tone?: "brand" | "accent" | "muted";
}) {
  const tones = {
    brand: "bg-brand/10 text-brand",
    accent: "bg-accent/10 text-accent",
    muted: "bg-foreground/5 text-muted",
  } as const;
  return (
    <span
      className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", tones[tone])}
      aria-hidden
    >
      {children}
    </span>
  );
}

/* ─────────────────────────  مصرفِ اپلای امروز  ───────────────────────── */

export function ApplyUsagePanel({ apply }: { apply: ApplyUsageStatus }) {
  const pct = applyUsagePct(apply.usedToday, apply.limit);
  const atCap = apply.limit !== null && apply.usedToday >= apply.limit;

  return (
    <Card padded>
      <div className="flex items-center gap-3">
        <PanelIcon tone="brand">
          <IconGauge className="h-5 w-5" />
        </PanelIcon>
        <div className="min-w-0">
          <h3 className="text-balance text-base font-bold leading-tight">
            سقفِ اپلای امروز
          </h3>
          <p className="mt-0.5 text-pretty text-xs leading-5 text-muted">
            اپلای خودکار هرگز از سقفِ روزانه‌ی پلنِ شما فراتر نمی‌رود.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="ltr-nums text-2xl font-extrabold leading-none">
            {toFaDigits(apply.usedToday)}
          </span>
          <span className="text-pretty text-xs text-muted">
            {toFaDigits(applyUsageLabel(apply.usedToday, apply.limit))}
          </span>
        </div>

        {apply.limit !== null ? (
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-foreground/10"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="مصرفِ سقفِ روزانه"
          >
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                atCap ? "bg-rose-500" : "bg-gradient-to-l from-brand to-brand-2",
              )}
              style={{ width: `${Math.max(pct, apply.usedToday > 0 ? 6 : 0)}%` }}
            />
          </div>
        ) : (
          <p className="mt-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            پلنِ شما سقفِ روزانه ندارد.
          </p>
        )}

        {atCap ? (
          <p className="mt-3 text-pretty rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-xs leading-6 text-rose-600 dark:text-rose-400">
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
    <Card padded>
      <div className="flex items-center gap-3">
        <PanelIcon tone="accent">
          <IconPlug className="h-5 w-5" />
        </PanelIcon>
        <div className="min-w-0">
          <h3 className="text-balance text-base font-bold leading-tight">
            آمادگیِ سایت‌ها
          </h3>
          <p className="mt-0.5 text-pretty text-xs leading-5 text-muted">
            اپلای خودکار فقط روی سایت‌های متصل و آماده اجرا می‌شود.
          </p>
        </div>
      </div>

      {boards.length === 0 ? (
        <p className="mt-5 text-pretty rounded-xl border border-dashed border-border bg-surface/60 px-4 py-5 text-center text-xs leading-6 text-muted">
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
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface/40 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {boardLabel(b.board)}
                  </div>
                  <div className="text-pretty text-xs leading-5 text-muted">
                    {b.specReady
                      ? "مشخصاتِ اپلای آماده است"
                      : "مشخصاتِ اپلای در حالِ ساخت است"}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <Badge tone={ready ? "green" : "muted"}>
                    {ready ? "آماده" : "ناآماده"}
                  </Badge>
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
        icon={<IconReceipt className="h-7 w-7 text-brand" />}
        title="هنوز رویدادی ثبت نشده"
        body="هر روشن/خاموش‌شدنِ تاگل و هر تلاش یا ردِ اپلای خودکار این‌جا ثبت می‌شود تا همیشه بدانید چه اتفاقی افتاده."
      />
    );
  }

  return (
    <Card padded>
      <SectionHeading
        as="h2"
        title="ردِ ممیزیِ اپلای خودکار"
        subtitle="فهرستِ شفافِ تصمیم‌ها و تلاش‌های اخیرِ اپلای خودکار (تازه‌ترین اول)."
      />

      <ul className="mt-5 space-y-2.5">
        {audit.map((row) => {
          const meta = autoApplyEventLabel(row.eventType);
          const score = extractScore(row.metadata);
          return (
            <li
              key={row.id}
              className="flex items-start gap-3 rounded-xl border border-border bg-surface/40 px-3.5 py-3"
            >
              <AuditIcon eventType={row.eventType} tone={meta.tone} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-balance text-sm font-semibold">
                    {meta.label}
                  </span>
                  <Badge tone="muted" className="ltr-nums">
                    {toFaDigits(faDate(row.createdAt))}
                  </Badge>
                  {score !== null ? (
                    <Badge tone={meta.tone} className="ltr-nums">
                      {toFaDigits(score)}٪
                    </Badge>
                  ) : null}
                </div>
                {meta.description ? (
                  <p className="mt-1 text-pretty text-xs leading-6 text-muted">
                    {meta.description}
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

/* ─────────────────────────  آیکنِ رویدادِ ممیزی  ───────────────────────── */

const AUDIT_ICON_TONES = {
  brand: "bg-brand/10 text-brand",
  accent: "bg-accent/10 text-accent",
  green: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  rose: "bg-rose-500/12 text-rose-600 dark:text-rose-400",
  muted: "bg-foreground/5 text-muted",
} as const;

/** آیکنِ درون‌خطیِ متناسب با نوعِ رویدادِ ممیزی (به‌جای ایموجی). */
function AuditIcon({
  eventType,
  tone,
}: {
  eventType: AutoApplyAuditEventType;
  tone: keyof typeof AUDIT_ICON_TONES;
}) {
  const Icon =
    eventType === "server_auto_apply_enabled" ||
    eventType === "server_auto_apply_disabled"
      ? IconServer
      : eventType === "auto_apply_enabled"
        ? IconCheck
        : eventType === "auto_apply_attempted"
          ? IconBolt
          : eventType === "auto_apply_skipped"
            ? IconWarn
            : IconReceipt;
  return (
    <span
      className={cn(
        "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
        AUDIT_ICON_TONES[tone] ?? AUDIT_ICON_TONES.muted,
      )}
      aria-hidden
    >
      <Icon className="h-4 w-4" />
    </span>
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
