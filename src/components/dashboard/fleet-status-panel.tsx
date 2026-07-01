/**
 * پنلِ «اپلای خودکارِ سرورِ اپلای» روی صفحه‌ی اپلای خودکار (Track C — server-safe).
 *
 * دو حالت دارد، بسته به پلنِ کاربر:
 *   • Max/Max+ → «اپلای خودکارِ شما روی N سرورِ اپلای فعال است»، سقفِ IPِ پلن، تازگیِ
 *     نشستِ خزانه، و این‌که ۲۴/۷ بدونِ افزونه اجرا می‌شود.
 *   • Free/Pro → دعوت به «ارتقا به Max برای اپلای خودکارِ سرور».
 *
 * فقط استایل/چیدمان؛ داده از RSC (getFleetStatusData) پاس داده می‌شود. هیچ رازی، هیچ کوئری،
 * هیچ state. سقفِ IP و قابلیت از plans.ts (منبعِ حقیقت) می‌آیند، نه از این‌جا. زبانِ بصری روی
 * پرایمیتیوهای مشترک (Card/Badge/ButtonLink) و آیکن‌های SVG سوار است (بدونِ ایموجی).
 */
import { Badge, ButtonLink, Card, cn, toFaDigits } from "./ui";
import { IconServer, IconShield, IconWarn } from "./track-icons";
import { workerIpCapacityLabel } from "./fleet-labels";
import type { FleetStatusData } from "./fleet-status-data";

/** سرسطرِ پنل — آیکنِ سرور + عنوان + نشانِ وضعیت. */
function PanelHead({
  title,
  badge,
}: {
  title: string;
  badge: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"
          aria-hidden
        >
          <IconServer className="h-5 w-5" />
        </span>
        <h3 className="text-balance text-base font-bold leading-tight">{title}</h3>
      </div>
      <div className="shrink-0">{badge}</div>
    </div>
  );
}

export function FleetStatusPanel({ data }: { data: FleetStatusData }) {
  const { capability, assignedNodes, freshness } = data;

  /* ───── Free/Pro: دعوت به ارتقا ───── */
  if (!capability.hasWorkerAutoApply) {
    return (
      <Card padded>
        <PanelHead
          title="اپلای خودکارِ سرورِ اپلای"
          badge={<Badge tone="accent">ویژه‌ی Max</Badge>}
        />
        <p className="mt-3 text-pretty text-sm leading-7 text-muted">
          با پلنِ{" "}
          <strong className="font-semibold text-foreground">
            {capability.planLabelFa}
          </strong>
          ، اپلای خودکار فقط در مرورگرِ خودتان (با افزونه) اجرا می‌شود. برای اجرای{" "}
          <strong className="font-semibold text-foreground">
            ۲۴ ساعته و بدونِ افزونه
          </strong>{" "}
          از روی سرورهای ایرانی، به پلنِ Max ارتقا دهید.
        </p>
        <ButtonLink href="/dashboard/plans" size="sm" className="mt-4">
          ارتقا به Max
        </ButtonLink>
      </Card>
    );
  }

  /* ───── Max/Max+: وضعیتِ فعالِ سرورِ اپلای ───── */
  const ipCapacity = workerIpCapacityLabel(capability.workerIpLimit);
  const active = assignedNodes > 0;
  const sessionWarn = freshness.total === 0 || !freshness.anyFresh;

  return (
    <Card padded>
      <PanelHead
        title="اپلای خودکارِ سرورِ اپلای"
        badge={
          <Badge tone={active ? "green" : "amber"}>
            {active ? "فعال" : "آماده‌ی فعال‌سازی"}
          </Badge>
        }
      />

      {/* جمله‌ی اصلیِ وضعیت */}
      <p className="mt-3 text-pretty text-sm leading-7 text-muted">
        {active ? (
          <>
            اپلای خودکارِ شما روی{" "}
            <strong className="font-semibold text-foreground">
              <span className="ltr-nums">{toFaDigits(assignedNodes)}</span> سرورِ اپلای
            </strong>{" "}
            فعال است و{" "}
            <strong className="font-semibold text-foreground">
              ۲۴ ساعته بدونِ افزونه
            </strong>{" "}
            اجرا می‌شود.
          </>
        ) : (
          <>
            پلنِ{" "}
            <strong className="font-semibold text-foreground">
              {capability.planLabelFa}
            </strong>{" "}
            اپلای خودکارِ سرور دارد، اما هنوز سروری به شما تخصیص نیافته است. پس از تخصیص،
            اپلای ۲۴ ساعته بدونِ افزونه اجرا می‌شود.
          </>
        )}
      </p>

      {/* ردیفِ آمار: سقفِ IPِ پلن + سرورهای فعال */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <StatBox label="سقفِ سرورِ پلن" value={ipCapacity ? toFaDigits(ipCapacity) : "—"} />
        <StatBox
          label="سرورهای فعالِ شما"
          value={
            <>
              {toFaDigits(assignedNodes)}
              <span className="text-xs font-normal text-muted">
                {" "}
                از {toFaDigits(capability.workerIpLimit)}
              </span>
            </>
          }
        />
      </div>

      {/* تازگیِ نشستِ خزانه */}
      <div className="mt-4 rounded-xl border border-border bg-surface/40 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">تازگیِ نشستِ خزانه</span>
          {freshness.total === 0 ? (
            <Badge tone="muted">بدونِ نشست</Badge>
          ) : freshness.anyFresh ? (
            <Badge tone="green">تازه</Badge>
          ) : (
            <Badge tone="amber">نیاز به تازه‌سازی</Badge>
          )}
        </div>
        <p className="mt-1.5 text-pretty text-xs leading-6 text-muted">
          سرورِ اپلای با نشستِ رمزشده‌ی خودِ شما در خزانه اپلای می‌کند. افزونه این نشست را
          تازه نگه می‌دارد تا با چرخشِ نشست‌ها همچنان کار کند.
        </p>
      </div>

      {/* هشدارِ تازگی (در صورت کهنه‌بودن/نبودِ نشست) */}
      {sessionWarn ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-700 dark:text-amber-400">
          <IconWarn className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-pretty text-xs leading-6">
            برای اجرای پایدارِ سرورِ اپلای، دستِ‌کم یک سایتِ متصل با نشستِ تازه لازم است.
            افزونه‌ی کارجو را نصب و وارد سایتِ هدف شوید تا نشستِ خزانه تازه شود.
          </p>
        </div>
      ) : null}

      {/* یادآوریِ مرزِ امنیت */}
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-border bg-surface/50 px-4 py-3 text-muted">
        <IconShield className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-pretty text-xs leading-6">
          نشستِ شما فقط برای خودِ شما استفاده می‌شود؛ کلیدِ خزانه هرگز کنترل‌پلین را ترک
          نمی‌کند و سرور فقط با نشستِ واقعیِ خودتان عمل می‌کند (بدونِ عبور از تشخیصِ ربات).
        </p>
      </div>
    </Card>
  );
}

/** جعبه‌ی آمارِ کوچک — برچسبِ کوتاه + عددِ درشت. */
function StatBox({
  label,
  value,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface/40 px-4 py-3",
        className,
      )}
    >
      <p className="text-pretty text-xs text-muted">{label}</p>
      <p className="ltr-nums mt-1 text-lg font-extrabold leading-tight">{value}</p>
    </div>
  );
}
