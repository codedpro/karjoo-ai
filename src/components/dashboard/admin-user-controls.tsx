"use client";

/**
 * کنترل‌های ادمین روی یک کاربر (client) — اشتراک، اعتبار، دسترسی.
 *
 * این کامپوننت *هیچ اختیاری ندارد*: فقط فرم می‌سازد و `FormData` را به server action
 * می‌دهد. همه‌ی راستی‌آزمایی‌ها (ادمین‌بودن، معتبربودنِ مبلغ/پلن) سمتِ سرور تکرار
 * می‌شود؛ کاری که این‌جا انجام می‌شود صرفاً کاهشِ خطای تایپی است، نه امنیت.
 *
 * `useActionState` (React 19) به‌جای state دستی: پیامِ نتیجه و وضعیتِ «در حالِ ارسال»
 * را خودِ فرم می‌دهد، پس دکمه در حینِ کار قفل می‌شود و دوبار کلیک، دوبار پول جابه‌جا
 * نمی‌کند.
 *
 * کنش‌های خطرناک (کم‌کردنِ اعتبار، بستنِ دسترسی) عمداً *تأییدِ صریح* می‌خواهند —
 * یک `confirm` قبل از ارسال، چون این‌ها با یک کلیک برگشت‌پذیر نیستند.
 */
import { useActionState, useId } from "react";

import {
  adjustUserCreditAction,
  setUserAccessAction,
  setUserPlanAction,
  type AdminActionResult,
} from "./admin-users-actions";
import { ASSIGNABLE_PLANS, planLabel, tomanFa } from "./admin-labels";
import { Button, Card, cn } from "./ui";

const IDLE: AdminActionResult | null = null;

const INPUT_CLASS =
  "focus-ring w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted/70";
const LABEL_CLASS = "block text-xs font-semibold text-muted";

/* ─────────────────────────────  پیامِ نتیجه  ─────────────────────────────── */

function Notice({ result }: { result: AdminActionResult | null }) {
  if (!result) return null;
  return (
    <p
      role="status"
      className={cn(
        "text-pretty rounded-xl border px-3.5 py-2.5 text-sm",
        result.ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
      )}
    >
      {result.message}
    </p>
  );
}

/* ────────────────────────────────  اشتراک  ─────────────────────────────── */

export function PlanControl({
  userId,
  currentPlan,
}: {
  userId: string;
  currentPlan: string;
}) {
  const [result, action, pending] = useActionState(
    async (_prev: AdminActionResult | null, formData: FormData) =>
      setUserPlanAction(formData),
    IDLE,
  );
  const planId = useId();
  const renewId = useId();

  return (
    <Card padded className="space-y-4">
      <div>
        <h3 className="text-base font-bold">اشتراک</h3>
        <p className="mt-1 text-sm text-muted">
          تغییرِ دستیِ اشتراک — پولی جابه‌جا نمی‌کند. برای پرداختِ واقعی، درخواستِ
          کارت‌به‌کارت را در بخشِ «پرداخت‌ها» تأیید کن.
        </p>
      </div>

      <form action={action} className="space-y-3">
        <input type="hidden" name="userId" value={userId} />

        <div>
          <label htmlFor={planId} className={LABEL_CLASS}>
            اشتراکِ جدید
          </label>
          <select
            id={planId}
            name="plan"
            defaultValue={ASSIGNABLE_PLANS.includes(
              currentPlan as (typeof ASSIGNABLE_PLANS)[number],
            )
              ? currentPlan
              : "free"}
            className={cn(INPUT_CLASS, "mt-1.5")}
          >
            {ASSIGNABLE_PLANS.map((plan) => (
              <option key={plan} value={plan}>
                {planLabel(plan)}
              </option>
            ))}
          </select>
        </div>

        <label htmlFor={renewId} className="flex items-center gap-2 text-sm">
          <input
            id={renewId}
            type="checkbox"
            name="renew"
            className="focus-ring h-4 w-4 rounded border-border"
          />
          <span>دوره‌ی ۳۰ روزه از امروز تمدید شود</span>
        </label>

        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "در حالِ ثبت…" : "ثبتِ اشتراک"}
        </Button>
      </form>

      <Notice result={result} />
    </Card>
  );
}

/* ────────────────────────────────  اعتبار  ─────────────────────────────── */

export function CreditControl({
  userId,
  balanceToman,
}: {
  userId: string;
  balanceToman: number | null;
}) {
  const [result, action, pending] = useActionState(
    async (_prev: AdminActionResult | null, formData: FormData) =>
      adjustUserCreditAction(formData),
    IDLE,
  );
  const amountId = useId();
  const reasonId = useId();
  const directionId = useId();

  return (
    <Card padded className="space-y-4">
      <div>
        <h3 className="text-base font-bold">اعتبار</h3>
        <p className="mt-1 text-sm text-muted">
          موجودیِ فعلی: <span className="font-semibold text-foreground">{tomanFa(balanceToman)}</span>
        </p>
      </div>

      <form
        action={action}
        className="space-y-3"
        onSubmit={(event) => {
          // کم‌کردنِ اعتبار برگشت‌پذیر نیست ⇒ تأییدِ صریح.
          const form = event.currentTarget;
          const direction = new FormData(form).get("direction");
          if (direction === "debit" && !confirm("از اعتبارِ این کاربر کم شود؟")) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="userId" value={userId} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={amountId} className={LABEL_CLASS}>
              مبلغ (تومان)
            </label>
            <input
              id={amountId}
              name="amountToman"
              type="number"
              min={1}
              step={1000}
              required
              placeholder="۵۰۰۰۰"
              className={cn(INPUT_CLASS, "ltr-nums mt-1.5")}
            />
          </div>

          <div>
            <label htmlFor={directionId} className={LABEL_CLASS}>
              نوعِ تغییر
            </label>
            <select
              id={directionId}
              name="direction"
              defaultValue="credit"
              className={cn(INPUT_CLASS, "mt-1.5")}
            >
              <option value="credit">افزودن به اعتبار</option>
              <option value="debit">کم‌کردن از اعتبار</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor={reasonId} className={LABEL_CLASS}>
            دلیل (در ردِ ممیزی ثبت می‌شود)
          </label>
          <input
            id={reasonId}
            name="reason"
            type="text"
            required
            minLength={3}
            maxLength={200}
            placeholder="مثلاً: جبرانِ اپلایِ ناموفق"
            className={cn(INPUT_CLASS, "mt-1.5")}
          />
        </div>

        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "در حالِ ثبت…" : "ثبتِ تغییرِ اعتبار"}
        </Button>
      </form>

      <Notice result={result} />
    </Card>
  );
}

/* ────────────────────────────────  دسترسی  ─────────────────────────────── */

export function AccessControl({
  userId,
  isActive,
}: {
  userId: string;
  isActive: boolean;
}) {
  const [result, action, pending] = useActionState(
    async (_prev: AdminActionResult | null, formData: FormData) =>
      setUserAccessAction(formData),
    IDLE,
  );
  const reasonId = useId();

  return (
    <Card padded className="space-y-4">
      <div>
        <h3 className="text-base font-bold">دسترسی</h3>
        <p className="mt-1 text-sm text-muted">
          {isActive
            ? "این کاربر می‌تواند وارد شود و از سرویس استفاده کند."
            : "دسترسیِ این کاربر بسته است؛ نه وارد می‌شود و نه اپلایی برایش انجام می‌شود."}
        </p>
      </div>

      <form
        action={action}
        className="space-y-3"
        onSubmit={(event) => {
          if (
            isActive &&
            !confirm("دسترسیِ این کاربر بسته شود و همه‌ی نشست‌هایش خارج شوند؟")
          ) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="active" value={isActive ? "false" : "true"} />

        {isActive ? (
          <div>
            <label htmlFor={reasonId} className={LABEL_CLASS}>
              دلیلِ بستن (اختیاری)
            </label>
            <input
              id={reasonId}
              name="reason"
              type="text"
              maxLength={200}
              placeholder="مثلاً: گزارشِ سوءاستفاده"
              className={cn(INPUT_CLASS, "mt-1.5")}
            />
          </div>
        ) : null}

        <Button
          type="submit"
          size="sm"
          variant={isActive ? "danger" : "primary"}
          disabled={pending}
        >
          {pending
            ? "در حالِ ثبت…"
            : isActive
              ? "بستنِ دسترسی"
              : "بازکردنِ دسترسی"}
        </Button>
      </form>

      <Notice result={result} />
    </Card>
  );
}
