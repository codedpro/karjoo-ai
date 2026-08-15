"use client";

/**
 * شبکه‌ی کارت‌های پلن (client component) — Free/Pro/Max/Max+ با CTAِ ارتقا.
 *
 * فهرستِ پلن‌ها و پلنِ فعلیِ کاربر از سرور (RSC) می‌آیند؛ این کامپوننت فقط تغییرِ پلن
 * را مدیریت می‌کند: کلیکِ CTA → POST /api/me/plan با کلیدِ پلن. *ارتقا* قیمتِ پلن را
 * همان لحظه از کیف‌پولِ واحدِ 1xAi کسر می‌کند؛ موجودیِ ناکافی → ۴۰۲ + لینکِ شارژ در
 * 1xai (topupUrl). سپس router.refresh تا RSCها (موجودی/وضعیت) تازه شوند.
 *
 * هیچ توکن/رازی نمی‌بیند؛ فقط با کوکیِ نشستِ httpOnly کار می‌کند (مرورگر خودش کوکی را
 * می‌فرستد). userId هرگز از کلاینت فرستاده نمی‌شود — سرور آن را از نشست می‌گیرد.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { IconCheck, IconWarn } from "./icons";
import { Button, Card, cn, toFaDigits } from "./ui";
import { formatToman } from "./wallet-format";
import { applyQuotaLabel, ctaLabel, workerIpLabel } from "./plans-labels";
import type { PlanDefinition, PlanKey } from "@/lib/billing/plans";

/** پاسخِ POST /api/me/plan — موفق یا خطا (۴۰۲ با لینکِ شارژِ 1xai می‌آید). */
interface ChangePlanResult {
  ok?: boolean;
  error?: string;
  /** فقط روی ۴۰۲ (موجودیِ ناکافی): نشانیِ شارژِ کیف‌پولِ واحد. */
  topupUrl?: string;
  plan?: PlanKey;
  upgraded?: boolean;
  /** موجودیِ واحد پس از کسر (فقط روی ارتقای موفق). */
  balanceToman?: number;
}

export function PlansGrid({
  plans,
  currentPlan,
}: {
  plans: PlanDefinition[];
  /** کلیدِ پلنِ فعلیِ کاربر (نرمال‌شده). */
  currentPlan: PlanKey;
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<PlanKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** لینکِ شارژِ 1xai — فقط وقتی سرور ۴۰۲ (موجودیِ ناکافی) برگرداند پر می‌شود. */
  const [topupUrl, setTopupUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const currentDef = plans.find((p) => p.key === currentPlan);
  const currentPrice = currentDef?.priceToman ?? 0;

  async function changePlan(target: PlanDefinition) {
    if (target.key === currentPlan || busyKey) return;
    setError(null);
    setTopupUrl(null);
    setNotice(null);
    setBusyKey(target.key);
    try {
      const res = await fetch("/api/me/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: target.key }),
      });
      const data: ChangePlanResult = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        // ۴۰۲ = موجودیِ کیف‌پولِ واحد کافی نیست → پیام + لینکِ شارژ در 1xai.
        setError(data.error ?? "تغییرِ پلن ناموفق بود.");
        if (res.status === 402 && data.topupUrl) setTopupUrl(data.topupUrl);
        return;
      }

      // پیامِ موفقیت — ارتقا مبلغ را همان لحظه از کیف‌پولِ واحد کسر کرده است.
      if (data.upgraded) {
        setNotice(
          `پلنِ شما به «${target.labelFa}» ارتقا یافت و ${toFaDigits(
            formatToman(target.priceToman),
          )} تومان از کیف‌پولِ 1xAi شما کسر شد.`,
        );
      } else {
        setNotice(`پلنِ شما به «${target.labelFa}» تغییر کرد.`);
      }
      // RSCها (وضعیتِ پلن/موجودی) را با داده‌ی تازه دوباره بخوان.
      router.refresh();
    } catch {
      setError("اتصال به سرور برقرار نشد.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div>
      {/* شبکه‌ی ۱→۲→۴: در پوسته‌ی سیال، چهار ستون فقط در نمایشگرِ خیلی پهن جا می‌شود؛
          قبلاً از xl چهار ستون می‌شد و کارت‌ها به ستون‌های باریکِ فشرده تبدیل می‌شدند. */}
      <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-4">
        {plans.map((plan) => {
          const isCurrent = plan.key === currentPlan;
          const isUpgrade = plan.priceToman > currentPrice;
          const busy = busyKey === plan.key;
          const isFree = plan.priceToman === 0;
          // پلنِ «حرفه‌ای» را برجسته می‌کنیم (محبوب‌ترین حالتِ معمول).
          const featured = plan.key === "pro";

          return (
            <Card
              key={plan.key}
              className={cn(
                "relative flex flex-col p-6",
                isCurrent
                  ? "ring-2 ring-brand"
                  : featured
                    ? "ring-1 ring-brand/40"
                    : "",
              )}
            >
              {/* نشانِ گوشه: پلنِ فعلی یا محبوب — end-4 برای RTL درست می‌نشیند */}
              {isCurrent ? (
                <span className="absolute -top-2.5 inset-e-4 whitespace-nowrap rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-bold text-brand-foreground shadow-brand">
                  پلنِ فعلی
                </span>
              ) : featured ? (
                <span className="absolute -top-2.5 inset-e-4 whitespace-nowrap rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-brand-foreground">
                  پیشنهادی
                </span>
              ) : null}

              {/* عنوان — کلیدِ لاتینِ پلن (FREE/PRO/…) حذف شد: برای کاربرِ فارسی‌زبان
                  فقط نویزِ فنی بود و نامِ فارسیِ کنارش همان را می‌گفت. */}
              <h3 className="text-balance text-lg font-extrabold">{plan.labelFa}</h3>

              {/* قیمت */}
              <div className="mt-4 flex items-baseline gap-1.5 whitespace-nowrap">
                {isFree ? (
                  <span className="text-2xl font-extrabold">رایگان</span>
                ) : (
                  <>
                    <span className="ltr-nums text-2xl font-extrabold tracking-tight">
                      {toFaDigits(formatToman(plan.priceToman))}
                    </span>
                    <span className="text-sm text-muted">تومان / ماه</span>
                  </>
                )}
              </div>

              {/* هوش مصنوعی — در همه‌ی پلن‌ها به‌میزانِ مصرف از کیف‌پولِ واحدِ 1xAi */}
              <div className="mt-4 rounded-xl border border-border bg-surface/60 px-3.5 py-2.5">
                <p className="text-xs text-muted">هوش مصنوعی</p>
                <p className="mt-0.5 text-sm font-bold">
                  به‌میزانِ مصرف — نرخِ خودِ 1xAi
                </p>
              </div>

              {/* مشخصاتِ کلیدی */}
              <dl className="mt-4 space-y-2 text-sm">
                <SpecRow
                  label="سهمیه‌ی اپلای"
                  value={toFaDigits(applyQuotaLabel(plan.applyQuotaPerDay))}
                />
                <SpecRow
                  label="IPِ ورکرِ اپلای خودکار"
                  value={toFaDigits(workerIpLabel(plan.workerIpLimit))}
                />
                <SpecRow
                  label="تماسِ مستقیم"
                  value={plan.directContact ? "دارد" : "—"}
                />
              </dl>

              {/* فهرستِ قابلیت‌ها */}
              <ul className="mt-4 space-y-1.5 text-xs leading-6 text-muted">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <IconCheck className="mt-0.5 h-3.5 w-3.5 text-brand" />
                    <span className="text-pretty">{toFaDigits(f)}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <Button
                type="button"
                onClick={() => changePlan(plan)}
                disabled={isCurrent || busy || busyKey !== null}
                aria-current={isCurrent ? "true" : undefined}
                variant={isCurrent ? "secondary" : "primary"}
                className={cn("mt-6 w-full", isCurrent && "cursor-default")}
              >
                {busy
                  ? "در حال تغییر…"
                  : ctaLabel(isCurrent, isUpgrade, plan.labelFa)}
              </Button>
            </Card>
          );
        })}
      </div>

      {/* پیام‌ها */}
      {error ? (
        <p
          role="alert"
          className="mt-5 text-pretty rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400"
        >
          {error}
          {topupUrl ? (
            <>
              {" "}
              <a
                href={topupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold underline underline-offset-4"
              >
                شارژِ کیف‌پول در 1xai ↗
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="mt-5 text-pretty rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400"
        >
          {notice}
        </p>
      ) : null}

      {/* نحوه‌ی پرداخت: کسرِ فوری از کیف‌پولِ واحدِ 1xAi */}
      <p className="mt-5 flex items-start gap-2 text-pretty rounded-xl border border-border bg-surface/60 px-4 py-3 text-xs leading-6 text-muted">
        <IconWarn className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          هزینه‌ی ارتقا همان لحظه از کیف‌پول کسر می‌شود؛ اگر موجودی کافی نبود، اول در{" "}
          <a
            href="https://1xai.ir/topup"
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring rounded-sm font-bold text-brand underline underline-offset-4"
          >
            صفحه‌ی شارژِ 1xai ↗
          </a>{" "}
          شارژ کنید. پایین‌آوردنِ پلن رایگان و فوری است.
        </span>
      </p>
    </div>
  );
}

/** یک ردیفِ مشخصه (برچسب راست/مقدار چپ) درونِ کارتِ پلن. */
function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="whitespace-nowrap font-medium">{value}</dd>
    </div>
  );
}

