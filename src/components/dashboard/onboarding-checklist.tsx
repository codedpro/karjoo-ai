import "server-only";

/**
 * چک‌لیستِ «شروعِ کار» (Server component) — راهنمای راه‌اندازیِ گام‌به‌گام برای کاربرِ
 * تازه‌وارد. سه گامِ لازمِ محصول را تشخیص می‌دهد و تا وقتی همه کامل نشده‌اند، یک کارتِ
 * فشرده در بالای داشبورد نشان می‌دهد؛ به‌محضِ کاملِ‌شدنِ هر سه گام، هیچ‌چیز رندر نمی‌کند.
 *
 * گام‌ها (ترتیبِ منطقی، ولی تشخیصِ هر کدام مستقل):
 *   ۱) رزومه/پروفایل — یک فایلِ رزومه‌ی آپلودشده، یا مهارت‌ها + نامِ واقعی (نه استابِ
 *      «کاربر کارجو» که writeApplyFilters هنگامِ ستِ فیلترها می‌سازد).
 *   ۲) فیلترهای اپلای — دسته‌های شغلی (categorySlugs) لنگرِ جریانِ پیش‌فرضِ اپلای انبوه‌اند.
 *   ۳) اتصالِ افزونه + سایتِ کاریابی — یک board_accounts با status='connected' هم‌زمان
 *      اثباتِ جفت‌شدنِ افزونه و اتصالِ برد است (چون /connect نشستِ Bearerِ افزونه می‌خواهد).
 *
 * تاب‌آوری (قاعده‌ی طلایی): getterهای data/resume-data و readApplyFilters خطاها را به
 * فراخواننده می‌دهند (swallow نمی‌کنند). پس هر تشخیص را در Promise.allSettled می‌بندیم؛
 * settleِ rejected → آن گام «ناتمام» رندر می‌شود، نه کرشِ کلِ چک‌لیست. هر سه تشخیص
 * round-tripِ DBِ مستقلند و هم‌زمان (concurrent) شلیک می‌شوند.
 *
 * توکن‌محور و RTL: فقط پرایمیتیوهای مشترک (Card/ButtonLink/Badge) + آیکن‌های معنایی +
 * توکن‌های تم. هیچ hexِ سخت، هیچ hookِ کلاینتی؛ یک Server componentِ خالص.
 */
import { getBoardAccountsForUser } from "@/components/dashboard/data";
import {
  getResumeFiles,
  getResumeProfile,
} from "@/components/dashboard/resume-data";
import { readApplyFilters } from "@/lib/apply/filters";
import { IconChevronEnd, IconCheck } from "@/components/dashboard/icons";
import { Badge, ButtonLink, Card, cn, toFaDigits } from "@/components/dashboard/ui";

/* ───────────────────────────────  مدلِ گام  ─────────────────────────────── */

/** یک گامِ راه‌اندازی — برچسبِ فارسی، وضعیتِ تکمیل، و لینکِ عمیقِ صفحه‌ی مربوط. */
interface OnboardingStep {
  key: "resume" | "apply-filters" | "connect-board";
  label: string;
  cta: string;
  deepLink: string;
  done: boolean;
}

/* ─────────────────────────  predicateهای تشخیص (خالص)  ────────────────────── */
/*
 * نکته‌ی حیاتیِ استاب‌پروفایل: نوشتنِ فیلترها *پیش از* گامِ رزومه یک candidate_profiles
 * با fullName = 'کاربر کارجو' و skills خالی می‌سازد. پس صرفِ «وجودِ ردیفِ پروفایل»
 * done نیست؛ محتوایِ واقعی لازم است: فایلِ آپلودشده، یا مهارت + نامِ غیرِ فالبک.
 */

const STUB_FULL_NAME = "کاربر کارجو";

/** گامِ ۱ done است اگر رزومه‌ی واقعی وجود داشته باشد (فایل، یا محتوایِ واقعیِ پروفایل). */
function isResumeDone(
  profile: Awaited<ReturnType<typeof getResumeProfile>>,
  files: Awaited<ReturnType<typeof getResumeFiles>>,
): boolean {
  if (files.length > 0) return true;
  if (!profile) return false;
  const hasRealName =
    profile.fullName.trim() !== "" && profile.fullName !== STUB_FULL_NAME;
  return hasRealName && profile.skills.length > 0;
}

/** گامِ ۲ done است اگر هدف‌گیری ست شده باشد؛ لنگرِ اصلی categorySlugs است. */
function isFiltersDone(
  filters: Awaited<ReturnType<typeof readApplyFilters>>,
): boolean {
  return (
    filters.categorySlugs.length > 0 ||
    filters.cities.length > 0 ||
    filters.jobTypes.length > 0
  );
}

/** گامِ ۳ done است اگر دستِ‌کم یک برد با وضعیتِ 'connected' وصل باشد. */
function isBoardDone(
  accounts: Awaited<ReturnType<typeof getBoardAccountsForUser>>,
): boolean {
  return accounts.some((a) => a.status === "connected");
}

/**
 * یک Promise را به «done: boolean» تبدیل می‌کند و هر شکست (rejected settle یا throw)
 * را به `false` می‌نگارد — تا یک کوئریِ خطادار نتواند کلِ چک‌لیست را زمین بزند.
 */
async function detect(compute: () => Promise<boolean>): Promise<boolean> {
  try {
    return await compute();
  } catch {
    return false;
  }
}

/* ───────────────────────────  کامپوننتِ اصلی  ────────────────────────────── */

/**
 * چک‌لیستِ راه‌اندازی. سه تشخیص را هم‌زمان اجرا می‌کند؛ اگر همه کامل باشند null
 * برمی‌گرداند (چیزی رندر نمی‌شود)، وگرنه کارتِ «شروعِ کار» را بالای داشبورد نشان می‌دهد.
 */
export async function OnboardingChecklist({ userId }: { userId: string }) {
  // هر سه، round-tripِ مستقلِ DB — هم‌زمان و هر کدام fail-safe (شکست → ناتمام).
  const [resumeDone, filtersDone, boardDone] = await Promise.all([
    detect(async () => {
      const [profile, files] = await Promise.all([
        getResumeProfile(userId),
        getResumeFiles(userId),
      ]);
      return isResumeDone(profile, files);
    }),
    detect(async () => isFiltersDone(await readApplyFilters(userId))),
    detect(async () => isBoardDone(await getBoardAccountsForUser(userId))),
  ]);

  const steps: OnboardingStep[] = [
    {
      key: "resume",
      label: "رزومه و پروفایل خود را تکمیل کنید",
      cta: "تکمیلِ رزومه",
      deepLink: "/dashboard/resume",
      done: resumeDone,
    },
    {
      key: "apply-filters",
      label: "فیلترهای اپلای را تنظیم کنید",
      cta: "تنظیمِ فیلترها",
      deepLink: "/dashboard/apply-filters",
      done: filtersDone,
    },
    {
      key: "connect-board",
      label: "افزونه را نصب/متصل کنید و یک سایت کاریابی وصل کنید",
      cta: "اتصالِ افزونه",
      deepLink: "/dashboard/extension",
      done: boardDone,
    },
  ];

  const total = steps.length;
  const completed = steps.filter((s) => s.done).length;

  // همه کامل؟ چیزی نشان نده — چک‌لیست فقط تا زمانِ راه‌اندازی زندگی می‌کند.
  if (completed === total) return null;

  // نخستین گامِ ناتمام = اکشنِ بعدیِ روشن (تنها گامی که CTAِ primary/برجسته می‌گیرد).
  const nextIndex = steps.findIndex((s) => !s.done);

  return (
    <Card padded className="border-brand/25 bg-gradient-to-b from-brand/[0.04] to-transparent">
      {/* سرتیتر + خطِ پیشرفت (ارقامِ فارسی) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">شروعِ کار</h2>
        <Badge tone="brand">
          {toFaDigits(completed)} از {toFaDigits(total)} گام کامل شد
        </Badge>
      </div>
      <p className="mt-1.5 text-sm leading-6 text-muted">
        برای اینکه کارجو بتواند به‌جای شما اپلای کند، این چند گام را کامل کنید.
      </p>

      {/* فهرستِ گام‌ها */}
      <ol className="mt-5 space-y-2.5">
        {steps.map((step, i) => {
          const isNext = i === nextIndex;
          return (
            <li
              key={step.key}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3",
                step.done
                  ? "border-border bg-surface/40"
                  : isNext
                    ? "border-brand/35 bg-brand/[0.06]"
                    : "border-border bg-transparent",
              )}
            >
              {/* نشانه‌ی وضعیت: تیکِ teal برای کامل، شماره‌ی amber برای گامِ بعدی */}
              <span
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold",
                  step.done
                    ? "bg-accent/10 text-accent"
                    : isNext
                      ? "bg-brand/15 text-brand"
                      : "bg-foreground/5 text-muted",
                )}
                aria-hidden
              >
                {step.done ? (
                  <IconCheck className="h-4 w-4" />
                ) : (
                  toFaDigits(i + 1)
                )}
              </span>

              {/* برچسب: کامل‌ها کم‌رنگ و خط‌خورده‌حس، گامِ بعدی برجسته */}
              <span
                className={cn(
                  "min-w-0 flex-1 text-pretty text-sm leading-6",
                  step.done
                    ? "text-muted"
                    : isNext
                      ? "font-semibold text-foreground"
                      : "text-foreground",
                )}
              >
                {step.label}
              </span>

              {/* اکشن: فقط گام‌های ناتمام CTA دارند؛ گامِ بعدی primary، بقیه secondary */}
              {step.done ? (
                <Badge tone="accent">انجام شد</Badge>
              ) : (
                <ButtonLink
                  href={step.deepLink}
                  size="sm"
                  variant={isNext ? "primary" : "secondary"}
                >
                  {step.cta}
                  <IconChevronEnd className="h-4 w-4" />
                </ButtonLink>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
