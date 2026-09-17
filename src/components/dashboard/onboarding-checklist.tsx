import "server-only";

/**
 * چک‌لیستِ «شروعِ کار» (Server component) — راهنمای راه‌اندازیِ گام‌به‌گام برای کاربرِ
 * تازه‌وارد. سه گامِ لازمِ محصول را تشخیص می‌دهد و تا وقتی همه کامل نشده‌اند، یک کارتِ
 * فشرده در بالای داشبورد نشان می‌دهد؛ به‌محضِ کاملِ‌شدنِ هر سه گام، هیچ‌چیز رندر نمی‌کند.
 *
 * تشخیصِ گام‌ها در `lib/onboarding/setup-status.ts` است (مشترک با صفحه‌ی «شروع»)؛ هر CTA
 * به همان گام در راهنمای گام‌به‌گامِ `/dashboard/start` می‌رود.
 *
 * توکن‌محور و RTL: فقط پرایمیتیوهای مشترک (Card/ButtonLink/Badge) + آیکن‌های معنایی +
 * توکن‌های تم. هیچ hexِ سخت، هیچ hookِ کلاینتی؛ یک Server componentِ خالص.
 */
import { getSetupStatus } from "@/lib/onboarding/setup-status";
import { IconChevronEnd, IconCheck } from "@/components/dashboard/icons";
import { Badge, ButtonLink, Card, cn, toFaDigits } from "@/components/dashboard/ui";

/** یک گامِ راه‌اندازی — برچسبِ فارسی، وضعیتِ تکمیل، و گامِ مربوط در راهنمای شروع. */
interface OnboardingStep {
  key: "resume" | "apply-filters" | "connect-board";
  label: string;
  cta: string;
  deepLink: string;
  done: boolean;
}

/* ───────────────────────────  کامپوننتِ اصلی  ────────────────────────────── */

/**
 * چک‌لیستِ راه‌اندازی. سه تشخیص را هم‌زمان اجرا می‌کند؛ اگر همه کامل باشند null
 * برمی‌گرداند (چیزی رندر نمی‌شود)، وگرنه کارتِ «شروعِ کار» را بالای داشبورد نشان می‌دهد.
 */
export async function OnboardingChecklist({ userId }: { userId: string }) {
  const status = await getSetupStatus(userId);

  const steps: OnboardingStep[] = [
    {
      key: "resume",
      label: "رزومه و پروفایلت را کامل کن",
      cta: "آپلودِ رزومه",
      deepLink: "/dashboard/start?step=resume",
      done: status.resume,
    },
    {
      key: "apply-filters",
      label: "بگو دنبالِ چه شغلی هستی (شهر، زمینه، دورکاری)",
      cta: "انتخابِ شغل‌ها",
      deepLink: "/dashboard/start?step=jobs",
      done: status.targeting,
    },
    {
      key: "connect-board",
      label: "افزونه‌ی مرورگر را نصب کن و حسابِ سایتِ کاریابی‌ات را وصل کن",
      cta: "اتصالِ افزونه",
      deepLink: "/dashboard/start?step=connect",
      done: status.connected,
    },
  ];

  const total = steps.length;
  const completed = steps.filter((s) => s.done).length;

  // همه کامل؟ چیزی نشان نده — چک‌لیست فقط تا زمانِ راه‌اندازی زندگی می‌کند.
  if (completed === total) return null;

  // نخستین گامِ ناتمام = اکشنِ بعدیِ روشن (تنها گامی که CTAِ primary/برجسته می‌گیرد).
  const nextIndex = steps.findIndex((s) => !s.done);

  return (
    <Card padded className="border-persimmon/30 bg-persimmon/5">
      {/* سرتیتر + خطِ پیشرفت (ارقامِ فارسی) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">شروعِ کار</h2>
        <Badge tone="brand">
          {toFaDigits(completed)} از {toFaDigits(total)} گام کامل شد
        </Badge>
      </div>
      <p className="mt-1.5 text-sm leading-6 text-muted">
        تا این سه گام کامل نشود، کارجو نمی‌تواند به‌جای تو درخواست بفرستد.
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
