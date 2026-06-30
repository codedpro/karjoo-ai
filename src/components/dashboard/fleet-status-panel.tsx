/**
 * پنلِ «اپلای خودکارِ کارگرِ سرور» روی صفحه‌ی اپلای خودکار (Track C — server-safe).
 *
 * دو حالت دارد، بسته به پلنِ کاربر:
 *   • Max/Max+ → «اپلای خودکارِ شما روی N کارگرِ سرور فعال است»، سقفِ IPِ پلن، تازگیِ
 *     نشستِ خزانه، و این‌که ۲۴/۷ بدونِ افزونه اجرا می‌شود.
 *   • Free/Pro → دعوت به «ارتقا به Max برای اپلای خودکارِ سرور».
 *
 * فقط استایل/چیدمان؛ داده از RSC (getFleetStatusData) پاس داده می‌شود. هیچ رازی، هیچ کوئری،
 * هیچ state. سقفِ IP و قابلیت از plans.ts (منبعِ حقیقت) می‌آیند، نه از این‌جا.
 */
import Link from "next/link";

import { Badge, Card, toFaDigits } from "./ui";
import { workerIpCapacityLabel } from "./fleet-labels";
import type { FleetStatusData } from "./fleet-status-data";

export function FleetStatusPanel({ data }: { data: FleetStatusData }) {
  const { capability, assignedNodes, freshness } = data;

  /* ───── Free/Pro: دعوت به ارتقا ───── */
  if (!capability.hasWorkerAutoApply) {
    return (
      <Card className="p-6">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-bold">اپلای خودکارِ کارگرِ سرور</h3>
          <Badge tone="accent">ویژه‌ی Max</Badge>
        </div>
        <p className="mt-2 text-sm leading-7 text-muted">
          با پلنِ <strong className="text-foreground">{capability.planLabelFa}</strong>، اپلای
          خودکار فقط در مرورگرِ خودتان (با افزونه) اجرا می‌شود. برای اپلای{" "}
          <strong className="text-foreground">۲۴ ساعته و بدونِ افزونه</strong> از روی کارگرهای
          ایرانی، به پلنِ Max ارتقا دهید.
        </p>
        <Link
          href="/dashboard/plans"
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          ارتقا به Max برای اپلای خودکارِ سرور
        </Link>
      </Card>
    );
  }

  /* ───── Max/Max+: وضعیتِ فعالِ کارگر ───── */
  const ipCapacity = workerIpCapacityLabel(capability.workerIpLimit);
  const active = assignedNodes > 0;
  const sessionWarn = freshness.total === 0 || !freshness.anyFresh;

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-bold">اپلای خودکارِ کارگرِ سرور</h3>
        <Badge tone={active ? "green" : "amber"}>
          {active ? "فعال" : "آماده‌ی فعال‌سازی"}
        </Badge>
      </div>

      {/* جمله‌ی اصلیِ وضعیت */}
      <p className="mt-2 text-sm leading-7 text-muted">
        {active ? (
          <>
            اپلای خودکارِ شما روی{" "}
            <strong className="text-foreground">
              <span className="ltr-nums">{toFaDigits(assignedNodes)}</span> کارگر (سرور)
            </strong>{" "}
            فعال است و <strong className="text-foreground">۲۴ ساعته بدونِ افزونه</strong> اجرا
            می‌شود.
          </>
        ) : (
          <>
            پلنِ <strong className="text-foreground">{capability.planLabelFa}</strong> شما اپلای
            خودکارِ کارگرِ سرور دارد، اما هنوز کارگری به شما تخصیص نیافته است. پس از تخصیص، اپلای
            ۲۴ ساعته بدونِ افزونه اجرا می‌شود.
          </>
        )}
      </p>

      {/* ردیفِ آمار: سقفِ IPِ پلن + کارگرهای فعال */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card/60 px-4 py-3">
          <p className="text-xs text-muted">سقفِ کارگرِ پلن</p>
          <p className="ltr-nums mt-1 text-lg font-extrabold">
            {ipCapacity ? toFaDigits(ipCapacity) : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card/60 px-4 py-3">
          <p className="text-xs text-muted">کارگرهای فعالِ شما</p>
          <p className="ltr-nums mt-1 text-lg font-extrabold">
            {toFaDigits(assignedNodes)}
            <span className="text-xs font-normal text-muted">
              {" "}
              از {toFaDigits(capability.workerIpLimit)}
            </span>
          </p>
        </div>
      </div>

      {/* تازگیِ نشستِ خزانه */}
      <div className="mt-4 rounded-xl border border-border px-4 py-3">
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
        <p className="mt-1.5 text-xs leading-6 text-muted">
          کارگرِ سرور با نشستِ رمزشده‌ی خودِ شما در خزانه اپلای می‌کند. افزونه این نشست را تازه
          نگه می‌دارد تا با چرخشِ نشست‌ها همچنان کار کند.
        </p>
      </div>

      {/* هشدارِ تازگی (در صورت کهنه‌بودن/نبودِ نشست) */}
      {sessionWarn ? (
        <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-6 text-amber-700 dark:text-amber-400">
          ⚠️ برای اجرای پایدارِ کارگرِ سرور، حداقل یک سایتِ متصل با نشستِ تازه لازم است. افزونه‌ی
          کارجو را نصب و وارد سایتِ هدف شوید تا نشستِ خزانه تازه شود.
        </p>
      ) : null}

      {/* یادآوریِ مرزِ امنیت */}
      <p className="mt-4 rounded-xl border border-border bg-card/60 px-4 py-3 text-xs leading-6 text-muted">
        🔒 نشستِ شما فقط برای خودِ شما استفاده می‌شود؛ کلیدِ خزانه هرگز کنترل‌پلین را ترک نمی‌کند
        و کارگر فقط با نشستِ واقعیِ خودتان عمل می‌کند (بدونِ عبور از تشخیصِ ربات).
      </p>
    </Card>
  );
}
