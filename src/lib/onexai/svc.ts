import "server-only";

/**
 * کلاینتِ /svcِ 1xai — درزِ «استخرِ مشترکِ کاربر + کیف‌پولِ واحد» (server-only).
 *
 * کارجو عضوِ خانواده‌ی 1xAi است: هویت (users) و پول (wallet) در 1xai زندگی می‌کنند و
 * کارجو از طریقِ این کلاینت آن‌ها را می‌خواند/حرکت می‌دهد. قراردادِ امضا دقیقاً همان
 * pay-worker است (سمتِ 1xai در internal/handlers/svc.go راستی‌آزمایی می‌شود):
 *
 *   canonical = timestamp \n METHOD \n path \n hex(sha256(body))
 *   X-1xai-Timestamp: <unix seconds>   X-1xai-Signature: <hex HMAC-SHA256>
 *
 * قواعد:
 *   • fail-closed: بدونِ ONEXAI_SVC_URL/SECRET هر فراخوانی OnexaiSvcUnavailableError
 *     می‌دهد — هیچ مسیرِ پولی بی‌سروصدا به مسیرِ محلی برنمی‌گردد.
 *   • پول: مبالغ اینجا «تومانِ صحیح» هستند؛ 1xai اعشار (NUMERIC) نگه می‌دارد — تبدیل
 *     فقط در همین مرز (Math.round هنگامِ خواندن) انجام می‌شود.
 *   • idempotency: reference هر debit/credit باید با 'karjoo:' شروع شود؛ ایندکسِ یکتای
 *     سمتِ 1xai تکرارِ آن را ساختاری ناممکن می‌کند (retry امن).
 */
import { createHash, createHmac } from "node:crypto";

import { onexaiSvcConfig } from "@/lib/env";
import { InsufficientBalanceError } from "@/lib/billing/errors";
import type { Plan } from "@/db/schema";

/** خطای typedِ سرویس — status برای تصمیمِ فراخواننده. */
export class OnexaiSvcError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OnexaiSvcError";
  }
}

/** سرویس پیکربندی نشده یا در دسترس نیست (شبکه/تایم‌اوت). */
export class OnexaiSvcUnavailableError extends Error {
  constructor(message = "سرویسِ 1xai در دسترس نیست.") {
    super(message);
    this.name = "OnexaiSvcUnavailableError";
  }
}

/** کاربرِ حل‌شده‌ی استخرِ مشترک. */
export interface OnexaiUser {
  id: number;
  email: string;
  /** تومانِ صحیح (گِردشده از NUMERICِ 1xai). */
  balanceToman: number;
  isActive: boolean;
  created: boolean;
}

/** موجودیِ کیف‌پولِ واحد. */
export interface OnexaiBalance {
  balanceToman: number;
  heldToman: number;
  /** balance − held — مبنای گیتِ استحقاق و نمایش. */
  availableToman: number;
  isActive: boolean;
  unlimited: boolean;
}

/** نتیجه‌ی حرکتِ پول (debit/credit) — `already` یعنی reference قبلاً اعمال شده. */
export interface OnexaiMoveResult {
  balanceToman: number;
  already: boolean;
}

/** تایم‌اوتِ هر فراخوانی — لوپ‌بکِ همین میزبان است؛ کوتاه ولی نه بی‌رحم. */
const SVC_TIMEOUT_MS = 8_000;

/**
 * فراخوانیِ امضاشده‌ی /svc. بدنه‌ی خطا (اگر JSON با error باشد) به پیام تبدیل می‌شود.
 * 402 با error=insufficient_balance به InsufficientBalanceError نگاشت می‌شود تا
 * فراخواننده‌های موجودِ بیلینگ (isInsufficientBalance) بدونِ تغییر کار کنند.
 */
async function svcFetch<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const cfg = onexaiSvcConfig();
  if (!cfg) {
    throw new OnexaiSvcUnavailableError(
      "درگاهِ سرویسِ 1xai پیکربندی نشده است (ONEXAI_SVC_URL/ONEXAI_SVC_SECRET).",
    );
  }

  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const bodyHash = createHash("sha256").update(raw).digest("hex");
  const canonical = `${ts}\n${method}\n${path}\n${bodyHash}`;
  const sig = createHmac("sha256", Buffer.from(cfg.secretHex, "hex"))
    .update(canonical)
    .digest("hex");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SVC_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(cfg.baseUrl + path, {
      method,
      headers: {
        "content-type": "application/json",
        "x-1xai-timestamp": ts,
        "x-1xai-signature": sig,
      },
      ...(body === undefined ? {} : { body: raw }),
      signal: controller.signal,
    });
  } catch {
    throw new OnexaiSvcUnavailableError();
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* بدنه‌ی غیرJSON — با status تصمیم می‌گیریم */
  }

  if (!res.ok) {
    // شکلِ خطای APIِ 1xai دوگانه است: /svc خودش {"error":"..."} می‌دهد ولی helperهای
    // مشترکِ handlers (writeAPIError) {"error":{"message":"..."}} — هر دو را می‌خوانیم
    // (تشخیصِ ۴۰۱ِ «invalid credentials» در verifyPoolPassword به همین متن تکیه دارد).
    const rawErr = data.error;
    const msg =
      typeof rawErr === "string"
        ? rawErr
        : typeof (rawErr as { message?: unknown })?.message === "string"
          ? ((rawErr as { message: string }).message)
          : `svc ${res.status}`;
    if (res.status === 402) {
      // گیتِ موجودیِ واحد — همان خطای typedِ بیلینگِ کارجو تا مصرف‌کننده‌ها یکسان بمانند.
      throw new InsufficientBalanceError({
        balanceToman: Math.round(Number(data.balance_toman ?? 0)),
        plan: "free" as Plan, // پلن این‌جا معنای گیت ندارد؛ صرفاً برای شکلِ خطا.
        message:
          "موجودیِ کیف‌پولِ 1xai شما کافی نیست. از داشبوردِ 1xai شارژ کنید.",
      });
    }
    throw new OnexaiSvcError(res.status, msg);
  }
  return data as T;
}

/* ────────────────────────────────  هویت  ─────────────────────────────────── */

/** find-or-create کاربرِ استخرِ مشترک با ایمیل (+ گره‌زدنِ google_sub اگر باشد). */
export async function resolveUser(input: {
  email: string;
  googleSub?: string;
}): Promise<OnexaiUser> {
  const r = await svcFetch<{
    id: number;
    email: string;
    balance_toman: number;
    is_active: boolean;
    created?: boolean;
  }>("POST", "/svc/users/resolve", {
    email: input.email,
    ...(input.googleSub ? { google_sub: input.googleSub } : {}),
  });
  return {
    id: r.id,
    email: r.email,
    balanceToman: Math.round(r.balance_toman),
    isActive: r.is_active,
    created: r.created === true,
  };
}

/**
 * راستی‌آزماییِ ایمیل/گذرواژه در برابرِ استخرِ مشترک (bcrypt سمتِ 1xai می‌ماند؛
 * کارجو هرگز هش نمی‌بیند). اعتبارِ نادرست → null (نه throw) تا مسیرِ login تمیز بماند.
 *
 * نکته‌ی حیاتی: گیتِ HMACِ /svc هم ۴۰۱ می‌دهد («invalid signature» — رازِ چرخیده/کجیِ
 * ساعت). آن ۴۰۱ *خطای زیرساخت* است، نه گذرواژه‌ی غلط — فقط بدنه‌ی «invalid credentials»
 * به null نگاشت می‌شود؛ هر ۴۰۱ِ دیگر OnexaiSvcUnavailableError است تا مسیرِ ورود ۵۰۳
 * بدهد (وگرنه در چرخشِ راز، به همه‌ی کاربران «گذرواژه نادرست است» گفته می‌شد).
 */
export async function verifyPoolPassword(
  email: string,
  password: string,
): Promise<{ id: number; email: string } | null> {
  try {
    return await svcFetch<{ id: number; email: string }>(
      "POST",
      "/svc/auth/verify-password",
      { email, password },
    );
  } catch (err) {
    if (err instanceof OnexaiSvcError && err.status === 401) {
      if (err.message.includes("invalid credentials")) return null;
      // ۴۰۱ِ لایه‌ی امضا/پیکربندی — زیرساخت، نه اعتبارنامه.
      throw new OnexaiSvcUnavailableError(
        "درگاهِ سرویسِ 1xai درخواست را نپذیرفت (راز/ساعت را بررسی کنید).",
      );
    }
    throw err;
  }
}

/* ────────────────────────────────  کیف‌پول  ───────────────────────────────── */

/** موجودیِ کیف‌پولِ واحدِ یک کاربرِ استخر (تومانِ صحیح). */
export async function getPoolBalance(onexaiUserId: number): Promise<OnexaiBalance> {
  const r = await svcFetch<{
    balance_toman: number;
    held_toman: number;
    available_toman: number;
    is_active: boolean;
    unlimited: boolean;
  }>("GET", `/svc/users/${onexaiUserId}/balance`);
  return {
    balanceToman: Math.round(r.balance_toman),
    heldToman: Math.round(r.held_toman),
    availableToman: Math.floor(r.available_toman),
    isActive: r.is_active,
    unlimited: r.unlimited,
  };
}

/**
 * کسرِ idempotent از کیف‌پولِ واحد. reference باید 'karjoo:'-پیشوند و برای «همین
 * رویداد» یکتا/پایدار باشد (retry با همان reference = بدونِ حرکتِ دوباره).
 * موجودیِ ناکافی → InsufficientBalanceError (از svcFetch).
 */
export async function debitPool(input: {
  onexaiUserId: number;
  amountToman: number;
  reference: `karjoo:${string}`;
}): Promise<OnexaiMoveResult> {
  const r = await svcFetch<{ ok: boolean; already: boolean; balance_toman: number }>(
    "POST",
    "/svc/wallet/debit",
    {
      user_id: input.onexaiUserId,
      amount_toman: input.amountToman,
      reference: input.reference,
    },
  );
  return { balanceToman: Math.round(r.balance_toman), already: r.already };
}

/** واریزِ idempotent (topup/refund/adjustment) — برای مهاجرت/بازگشتِ وجه. */
export async function creditPool(input: {
  onexaiUserId: number;
  amountToman: number;
  kind: "topup" | "refund" | "adjustment";
  reference: `karjoo:${string}`;
}): Promise<OnexaiMoveResult> {
  const r = await svcFetch<{ ok: boolean; already: boolean; balance_toman: number }>(
    "POST",
    "/svc/wallet/credit",
    {
      user_id: input.onexaiUserId,
      amount_toman: input.amountToman,
      kind: input.kind,
      reference: input.reference,
    },
  );
  return { balanceToman: Math.round(r.balance_toman), already: r.already };
}

/* ────────────────────────────────  کلیدِ API  ─────────────────────────────── */

/**
 * صدورِ یک کلیدِ 1xai برای کاربرِ استخر — تا فراخوانی‌های AIِ کارجو «با هویت و نرخِ
 * خودِ کاربر» متر شوند (بدونِ مارجینِ کارجو). کلیدِ خام فقط همین یک‌بار برمی‌گردد؛
 * فراخواننده آن را در ردیفِ کاربرِ کارجو ذخیره می‌کند.
 */
export async function issuePoolApiKey(
  onexaiUserId: number,
  name = "karjoo",
): Promise<string> {
  const r = await svcFetch<{ key: string }>(
    "POST",
    `/svc/users/${onexaiUserId}/keys`,
    { name },
  );
  if (!r.key) throw new OnexaiSvcError(500, "کلیدِ صادرشده خالی بود");
  return r.key;
}
