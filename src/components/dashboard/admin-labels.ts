/**
 * برچسب‌ها و قالب‌بندی‌های بخشِ مدیریت — توابعِ *خالص* (بدونِ I/O، بدونِ React).
 *
 * چرا جدا؟ تا صفحه‌های ادمین فقط چیدمان باشند و هر تصمیمِ «این مقدار به فارسی چه
 * می‌شود؟» یک‌جا و قابلِ تست بماند. هیچ‌کدام throw نمی‌کنند: مقدارِ ناشناخته به یک
 * برچسبِ امن برمی‌گردد، چون یک enum جدید در دیتابیس نباید صفحه‌ی مدیریت را بشکند.
 */

/* ─────────────────────────────────  پلن  ────────────────────────────────── */

const PLAN_LABELS: Record<string, string> = {
  free: "رایگان",
  pro: "حرفه‌ای",
  max: "مکس",
  maxplus: "مکس پلاس",
  // مقادیرِ تاریخی که هنوز ممکن است در ردیف‌های قدیمی باشند.
  payg: "اعتباری (قدیمی)",
  premium: "ویژه (قدیمی)",
};

/** نامِ فارسیِ پلن — مقدارِ ناشناخته همان‌طور که هست برمی‌گردد. */
export function planLabel(plan: string): string {
  return PLAN_LABELS[plan] ?? plan;
}

/** پلن‌هایی که ادمین می‌تواند دستی ست کند (هم‌راستا با اسکیمای اکشن). */
export const ASSIGNABLE_PLANS = ["free", "pro", "max", "maxplus"] as const;

/* ───────────────────────────  وضعیتِ اپلای/پرداخت  ───────────────────────── */

const APPLICATION_STATUS_LABELS: Record<string, string> = {
  draft: "در انتظارِ ارسال",
  queued: "در صفِ ارسال",
  applying: "در حالِ ارسال",
  submitted: "ارسال شد",
  failed: "ناموفق",
  skipped: "رد شد",
  dead: "متوقف شد",
};

export function applicationStatusLabel(status: string): string {
  return APPLICATION_STATUS_LABELS[status] ?? status;
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "در انتظارِ بررسی",
  approved: "تأیید شد",
  rejected: "رد شد",
};

export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABELS[status] ?? status;
}

const PAYMENT_KIND_LABELS: Record<string, string> = {
  topup: "شارژِ اعتبار",
  plan: "خریدِ اشتراک",
};

export function paymentKindLabel(kind: string): string {
  return PAYMENT_KIND_LABELS[kind] ?? kind;
}

/* ────────────────────────────────  زمان  ───────────────────────────────── */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * فاصله‌ی زمانیِ خوانا («۳ روز پیش»). `null` ⇒ «هرگز».
 *
 * عمداً تقریبی است: در نمای مدیریت، «۳ روز پیش» از تاریخِ دقیق مفیدتر است. تاریخِ
 * دقیق را با `absoluteDateFa` کنارش (به‌صورتِ `title`) بگذار.
 */
export function relativeTimeFa(value: Date | null, now: Date = new Date()): string {
  if (!value) return "هرگز";
  const diff = now.getTime() - value.getTime();
  if (diff < MINUTE) return "همین حالا";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} دقیقه پیش`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} ساعت پیش`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} روز پیش`;
  if (diff < 365 * DAY) return `${Math.floor(diff / (30 * DAY))} ماه پیش`;
  return `${Math.floor(diff / (365 * DAY))} سال پیش`;
}

/** تاریخِ شمسیِ کامل — برای `title` کنارِ زمانِ نسبی. */
export function absoluteDateFa(value: Date | null): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value);
  } catch {
    return value.toISOString();
  }
}

/* ────────────────────────────────  مبلغ  ───────────────────────────────── */

/**
 * مبلغِ تومان با جداکننده‌ی هزارگان و ارقامِ فارسی. `null` ⇒ «نامشخص» (وقتی سرویسِ
 * کیف‌پول در دسترس نبوده) — عمداً «۰» نشان نمی‌دهیم تا «صفر» با «نمی‌دانیم» اشتباه نشود.
 */
export function tomanFa(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return "نامشخص";
  try {
    return `${new Intl.NumberFormat("fa-IR").format(Math.round(amount))} تومان`;
  } catch {
    return `${Math.round(amount)} تومان`;
  }
}

/** نامِ نمایشیِ کاربر — اولویت با نامِ پروفایل، بعد نامِ Google، بعد ایمیل. */
export function displayName(user: {
  fullName: string | null;
  name: string | null;
  email: string | null;
}): string {
  return user.fullName ?? user.name ?? user.email ?? "کاربرِ بی‌نام";
}
