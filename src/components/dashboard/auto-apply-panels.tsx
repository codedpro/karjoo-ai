/**
 * پنل‌های ارائه‌ایِ صفحه‌ی «اپلای خودکار» (server-safe، بدونِ state/I/O).
 *
 * سه پنل: مصرفِ امروز نسبت به سقف، وضعیتِ اپلای با افزونه‌ی مرورگر، و تاریخچه‌ی تغییرات.
 * فقط استایل/چیدمان؛ داده از RSC پاس داده می‌شود. هیچ رازی، هیچ کوئری.
 *
 * دو تصمیمِ محتوایی که این فایل نگه می‌دارد:
 *   • هیچ اصطلاحِ داخلی در متنِ کاربر نیست: «ردِ ممیزی» شد «تاریخچه‌ی تغییرات»، «آستانه»
 *     شد «حداقلِ امتیاز»، و به‌جای نامِ پلن، *نتیجه‌ای* که کاربر می‌گیرد نوشته می‌شود.
 *   • پنلِ افزونه بن‌بستِ آموزشی نیست: به‌جای توضیحِ اینکه «کلید داخلِ افزونه است»،
 *     *وضعیتِ واقعیِ* حساب‌های متصل را نشان می‌دهد و به /dashboard/extension می‌بَرد.
 *
 * زبانِ بصری روی پرایمیتیوهای مشترک (Card/Badge/Callout/EmptyState) و آیکن‌های درون‌خطیِ
 * SVG (بدونِ ایموجی) سوار است. برچسب‌ها با `whitespace-nowrap`/`min-w-0`+`truncate` از
 * شکستِ زشتِ دو-خطی مصون‌اند؛ متن‌های بدنه `text-pretty`.
 */
import {
  Badge,
  ButtonLink,
  Callout,
  Card,
  EmptyState,
  SectionHeading,
  cn,
  toFaDigits,
} from "./ui";
import {
  IconArrowEnd,
  IconBolt,
  IconCheck,
  IconGauge,
  IconPuzzle,
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
            بیشتر از سقفِ روزانه‌ی اشتراکت ارسال نمی‌شود.
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
                atCap ? "bg-rose-500" : "bg-linear-to-l from-brand to-brand-2",
              )}
              style={{ width: `${Math.max(pct, apply.usedToday > 0 ? 6 : 0)}%` }}
            />
          </div>
        ) : (
          <p className="mt-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            اشتراکِ تو سقفِ روزانه ندارد.
          </p>
        )}

        {atCap ? (
          <p className="mt-3 text-pretty rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-xs leading-6 text-rose-600 dark:text-rose-400">
            سقفِ امروز پر شد؛ ارسالِ بعدی فردا انجام می‌شود.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/* ───────────────────  اپلای با مرورگرِ خودت (افزونه)  ─────────────────── */

/**
 * وضعیتِ حالتِ «اپلای با مرورگرِ خودت». پیش‌تر این بخش صرفاً توضیح می‌داد که کلیدِ
 * روشن/خاموش داخلِ افزونه است — یعنی بن‌بست. حالا اول *وضعیتِ واقعی* را می‌گوید
 * (کدام سایت‌ها وصل‌اند و آماده‌اند)، بعد یک اشاره‌ی یک‌جمله‌ای + دکمه‌ی رفتن به
 * صفحه‌ی افزونه می‌دهد.
 */
export function ExtensionApplyPanel({ boards }: { boards: BoardReadiness[] }) {
  const readyBoards = boards.filter((b) => b.status === "connected" && b.specReady);
  const connectedBoards = boards.filter((b) => b.status === "connected");

  const state: { tone: "green" | "amber" | "muted"; label: string; line: string } =
    readyBoards.length > 0
      ? {
          tone: "green",
          label: "آماده",
          line: `افزونه وصل است و می‌تواند در مرورگرِ خودت روی ${readyBoards
            .map((b) => boardLabel(b.board))
            .join("، ")} درخواست بفرستد.`,
        }
      : connectedBoards.length > 0
        ? {
            tone: "amber",
            label: "در حالِ آماده‌سازی",
            line: "حسابت وصل شده، ولی ارسالِ خودکار برای این سایت هنوز آماده نیست.",
          }
        : {
            tone: "muted",
            label: "وصل نیست",
            line: "هنوز هیچ حسابی وصل نشده؛ با افزونه وارد سایتِ کاریابی شو تا این حالت کار کند.",
          };

  return (
    <Card padded>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <PanelIcon tone="accent">
            <IconPuzzle className="h-5 w-5" />
          </PanelIcon>
          <div className="min-w-0">
            <h3 className="text-balance text-base font-bold leading-tight">
              اپلای با مرورگرِ خودت
            </h3>
            <p className="mt-0.5 text-pretty text-xs leading-5 text-muted">
              با هر اشتراکی کار می‌کند، تا وقتی مرورگرت باز باشد.
            </p>
          </div>
        </div>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>

      <p className="mt-4 text-pretty text-sm leading-7 text-muted">{state.line}</p>

      {boards.length > 0 ? (
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
                    {ready ? "آماده‌ی ارسالِ خودکار" : "هنوز آماده نیست"}
                  </div>
                </div>
                <Badge tone={status.tone} className="shrink-0">
                  {status.label}
                </Badge>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Callout
        tone="info"
        className="mt-4"
        action={
          <ButtonLink href="/dashboard/extension" variant="secondary" size="sm">
            صفحه‌ی افزونه
            <IconArrowEnd className="h-4 w-4" />
          </ButtonLink>
        }
      >
        کلیدِ روشن/خاموشِ این حالت داخلِ خودِ افزونه است.
      </Callout>
    </Card>
  );
}

/* ─────────────────────────  تاریخچه‌ی تغییرات  ───────────────────────── */

export function AutoApplyAuditPanel({ audit }: { audit: AutoApplyAuditRow[] }) {
  if (audit.length === 0) {
    return (
      <EmptyState
        icon={<IconReceipt />}
        title="هنوز اتفاقی نیفتاده"
        body="از این‌جا به بعد، هر روشن/خاموش‌شدن و هر ارسال یا صرف‌نظر این‌جا ثبت می‌شود."
      />
    );
  }

  return (
    <Card padded>
      <SectionHeading
        as="h2"
        title="تاریخچه‌ی تغییرات"
        subtitle="تازه‌ترین اتفاق‌ها در بالا."
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

/* ─────────────────────────  آیکنِ هر رویداد  ───────────────────────── */

const AUDIT_ICON_TONES = {
  brand: "bg-brand/10 text-brand",
  accent: "bg-accent/10 text-accent",
  green: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  rose: "bg-rose-500/12 text-rose-600 dark:text-rose-400",
  muted: "bg-foreground/5 text-muted",
} as const;

/** آیکنِ درون‌خطیِ متناسب با نوعِ رویداد (به‌جای ایموجی). */
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
