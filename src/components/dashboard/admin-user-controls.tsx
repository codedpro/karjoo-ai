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
  type AdminActionResult,
} from "./admin-users-actions";
import { tomanFa } from "./admin-labels";
import { Button, Card, cn } from "./ui";

const IDLE: AdminActionResult | null = null;

const INPUT_CLASS =
  "focus-ring w-full border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted/70";
const LABEL_CLASS = "block text-xs font-semibold text-muted";

/* ─────────────────────────────  پیامِ نتیجه  ─────────────────────────────── */

function Notice({ result }: { result: AdminActionResult | null }) {
  if (!result) return null;
  return (
    <p
      role="status"
      className={cn(
        "text-pretty border px-3.5 py-2.5 text-sm",
        result.ok
          ? "border-jade/30 bg-jade/10 text-jade"
          : "border-rose/30 bg-rose/10 text-rose",
      )}
    >
      {result.message}
    </p>
  );
}

/* ────────────────────────────────  اشتراک  ─────────────────────────────── */

/**
 * اشتراک در 1xai مدیریت می‌شود (همان اشتراک مزایای کارجو را می‌دهد)؛ این کارت فقط وضعیت
 * را نشان می‌دهد و به صفحه‌ی همان کاربر در پنلِ مدیریتِ 1xai لینک می‌دهد.
 */
export function PlanControl({
  planName,
  onexaiUserId,
}: {
  planName: string;
  onexaiUserId: number | null;
}) {
  return (
    <Card padded className="space-y-4">
      <div>
        <h3 className="text-base font-bold">اشتراک</h3>
        <p className="mt-1 text-sm text-muted">
          اشتراکِ کارجو و 1xAi یکی است و در پنلِ مدیریتِ 1xAi تغییر می‌کند.
        </p>
      </div>
      <p className="text-sm">
        اشتراکِ فعلی: <span className="font-bold">{planName}</span>
      </p>
      {onexaiUserId === null ? (
        <p className="text-sm text-muted">این کاربر هنوز به حسابِ 1xAi متصل نشده است.</p>
      ) : (
        <a
          href={`https://1xai.ir/admin/users/${onexaiUserId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring inline-flex border border-border px-3 py-1.5 text-sm hover:border-brand/50"
        >
          مدیریتِ اشتراک در 1xAi ↗
        </a>
      )}
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
