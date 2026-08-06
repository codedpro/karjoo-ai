/**
 * اسکیمای پایگاه‌داده‌ی کنترل‌پلین کارجو (Drizzle / Postgres).
 *
 * این مدل، طرح بخش ۵ سند معماری (docs/ARCHITECTURE.md) را پیاده می‌کند و جدا از
 * موتور محتوای IT Master است. قرارداد دامنه در src/lib/apply/types.ts منبع حقیقت
 * نوع‌هاست؛ این جدول‌ها همان مفاهیم را پایدار (persist) می‌کنند:
 *   • candidate_profiles  ↔ CandidateProfile
 *   • job_listings        ↔ JobListing
 *   • applications        ↔ ApplicationResult
 *
 * قواعد ایمنی (از سند): نشست هر کاربر فقط برای همان کاربر؛ بلابِ نشست رمزنگاری‌شده
 * و فناپذیر (perishable)؛ هر اپلای dedupe + سقف روزانه + jitter دارد.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ─────────────────────────────  Enums (وضعیت‌ها)  ───────────────────────── */

/** سایت‌های کاریابی پشتیبانی‌شده — هم‌راستا با JobBoardId در types.ts. */
export const jobBoardEnum = pgEnum("job_board", [
  "jobvision",
  "jobinja",
  "e-estekhdam",
  "irantalent",
  "karboom",
  "linkedin",
]);

/** نوع اپلای هر سایت (ساختاریافته با فرم، یا تماس از طریق متن آگهی). */
export const applyTypeEnum = pgEnum("apply_type", ["structured", "contact"]);

/** شکل نشست هر سایت: کوکی (جابینجا) یا توکن در localStorage (جاب‌ویژن). */
export const sessionShapeEnum = pgEnum("session_shape", ["cookie", "token"]);

/** وضعیت اتصال حساب کاربر به یک سایت کاریابی. */
export const boardAccountStatusEnum = pgEnum("board_account_status", [
  "connected",
  "expired",
  "needs_reauth",
]);

/** وضعیت تطبیق یک آگهی با یک کاربر. */
export const matchStatusEnum = pgEnum("match_status", [
  "pending", // در صف امتیازدهی
  "scored", // امتیاز گرفته، زیر آستانه
  "drafted", // امتیاز بالای آستانه، انگیزه‌نامه آماده
  "queued", // وارد صف اپلای شده
  "dismissed", // کاربر رد کرده
]);

/** وضعیت یک تلاش اپلای — هم‌راستا با ApplicationResult.status. */
export const applicationStatusEnum = pgEnum("application_status", [
  "draft",
  "submitted",
  "skipped",
  "failed",
]);

/** کانال اجرای اپلای: افزونه‌ی مرورگر کاربر (استاندارد) یا نود ورکر ایرانی (پریمیوم). */
export const applyChannelEnum = pgEnum("apply_channel", ["extension", "worker"]);

/** وضعیت یک ردیف صف (Task). */
export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "leased", // توسط یک مصرف‌کننده قفل شده (FOR UPDATE SKIP LOCKED)
  "succeeded",
  "failed",
  "dead", // بیش از حد تلاش، رهاشده
]);

/** سلامت یک نود ورکر. */
export const workerHealthEnum = pgEnum("worker_health", [
  "online",
  "degraded",
  "offline",
]);

/**
 * فرمانِ سرور به نودِ ورکر (worker_commands) — قاعده‌ی ۴ (به‌روزرسانیِ خودکارِ
 * فرمان‌محورِ سرور). سرور 'update' (اجرای اسکریپتِ به‌روزرسانی: pull+restart) یا
 * 'restart' صادر می‌کند؛ نود poll می‌کند، اجرا و ack می‌دهد و agentVersion را گزارش
 * می‌کند تا سرور وضعیتِ ناوگان را ببیند.
 */
export const workerCommandEnum = pgEnum("worker_command", ["update", "restart"]);

/**
 * وضعیتِ یک فرمانِ ورکر در چرخه‌ی عمرش:
 *   • pending  — صادر شده، هنوز توسطِ نود برداشته نشده.
 *   • acked    — نود فرمان را دریافت و شروعِ اجرا را تأیید کرده (ackedAt).
 *   • done     — اجرا با موفقیت تمام شد (completedAt + result).
 *   • failed   — اجرا شکست خورد (completedAt + result با خطا).
 */
export const workerCommandStatusEnum = pgEnum("worker_command_status", [
  "pending",
  "acked",
  "done",
  "failed",
]);

/** نوع رویداد در لاگ ممیزی (append-only). */
export const auditEventTypeEnum = pgEnum("audit_event_type", [
  "session_captured",
  "session_refreshed",
  "session_used",
  "session_expired",
  "apply_queued",
  "apply_submitted",
  "apply_failed",
  // اپلای خودکار (WF auto-apply، قاعده‌ی ۱): هر تلاش/تصمیمِ اپلایِ خودکار یک ردیف می‌نویسد.
  //
  // دو سطحِ مستقل داریم (GOAL 3): تاگلِ «افزونه» (اپلای در مرورگرِ خودِ کاربر) و تاگلِ
  // «سرور» (اپلای پَسیو روی ناوگانِ سرور، پلن‌های Max/Max+). این چهار کدِ *بی‌پیشوند* اکنون
  // به‌طورِ خاص برای سطحِ «افزونه» می‌مانند (سازگاریِ عقب‌رو با ردیف‌های موجود)؛ کدهای
  // `server_auto_apply_*` برای سطحِ «سرور» جدا اضافه شده‌اند تا ممیزی دو مسیر تفکیک بماند.
  "auto_apply_enabled", // [افزونه] کاربر تاگلِ اپلای خودکارِ مرورگر را روشن کرد (رضایت).
  "auto_apply_disabled", // [افزونه] کاربر تاگلِ مرورگر را خاموش کرد (لغوِ رضایت).
  "auto_apply_attempted", // یک آیتمِ اپلایِ خودکار از صف برداشته شد (claim) — افزونه یا ورکر.
  "auto_apply_skipped", // آیتم به‌دلیلِ آستانه/سقف/خاموش‌بودنِ تاگل رد شد.
  // سطحِ «سرور» (پَسیو، ناوگانِ ۲۴/۷ — پلن‌های Max/Max+): تفکیکِ ممیزیِ تاگلِ سرور.
  "server_auto_apply_enabled", // [سرور] کاربر تاگلِ اپلای خودکارِ سرور را روشن کرد (رضایت).
  "server_auto_apply_disabled", // [سرور] کاربر تاگلِ سرور را خاموش کرد (لغوِ رضایت).
]);

/** نوعِ یک نشستِ احرازهویت: وب (داشبورد) یا افزونه‌ی مرورگر. */
export const authSessionKindEnum = pgEnum("auth_session_kind", ["web", "extension"]);

/** وضعیتِ یک هندآف اتصال دستگاه (SSO افزونه — بدون OTP دوم). */
export const deviceLinkStatusEnum = pgEnum("device_link_status", [
  "pending", // کد جفت‌سازی ساخته شده، هنوز مصرف نشده
  "linked", // افزونه با موفقیت جفت شد و نشست گرفت
  "expired", // منقضی/باطل‌شده
]);

/**
 * منشأِ یک فایلِ رزومه (WF1):
 *   • `upload`       — کاربر یک PDF آپلود کرده.
 *   • `board_import` — متن/فیلدهای رزومه از یک سایت کاریابی (با رضایت کاربر) ایمپورت شده.
 */
export const resumeSourceEnum = pgEnum("resume_source", ["upload", "board_import"]);

/**
 * وضعیتِ یک ایمپورتِ پروفایل از یک سایت کاریابی (WF1، قاعده‌ی §10):
 *   • `received` — DATAِ پروفایل از افزونه رسید و ذخیره شد (هرگز کوکی/توکن/رمز).
 *   • `applied`  — فیلدهای نرمال‌شده روی پروفایلِ کاربر merge شد.
 *   • `failed`   — نرمال‌سازی/merge ناموفق بود.
 */
export const profileImportStatusEnum = pgEnum("profile_import_status", [
  "received",
  "applied",
  "failed",
]);

/* ─────────────────────  Billing / metering (مدلِ کیف‌پول)  ───────────────── */

/**
 * ارائه‌دهنده‌ی مدلِ هوش مصنوعی — هم‌راستا با مسیریابیِ گیت‌وی 1xai بر اساسِ پیشوندِ
 * نامِ مدل: gpt-*→openai، claude-*→anthropic، gemini-*→google.
 */
export const aiProviderEnum = pgEnum("ai_provider", [
  "openai",
  "anthropic",
  "google",
]);

/**
 * پلنِ اشتراکِ کاربر (نسخه‌ی WF3 — لایه‌های قیمت‌گذاری):
 *   • free    — رایگان (بدونِ اعتبارِ هوش مصنوعی؛ ۱۰۰ اپلای در روز؛ همه‌ی قابلیت‌های غیر-AI).
 *   • pro/max/maxplus — پلن‌های پولی با اعتبارِ ماهانه‌ی هوش مصنوعی و اپلای نامحدود.
 *   • payg/premium — مقادیرِ تاریخی (legacy) که هنوز در enum می‌مانند تا داده‌ی موجود
 *     نشکند؛ مهاجرت به‌صورت دفاعی payg→free و premium→pro می‌کند. مرجعِ تعریفِ پلن‌ها
 *     src/lib/billing/plans.ts است (PLAN_DEFINITIONS).
 */
export const planEnum = pgEnum("plan", [
  "free",
  "payg",
  "premium",
  "pro",
  "max",
  "maxplus",
]);

/**
 * نوعِ رویدادِ دفترِ کیف‌پول (wallet_ledger):
 *   • topup  — شارژِ کیف‌پول توسطِ کاربر (مثبت).
 *   • charge — کسرِ بابتِ یک فراخوانیِ پولیِ هوش مصنوعی (منفی).
 *   • refund — بازگردانیِ هزینه (مثبت).
 *   • grant  — اعتبارِ هدیه/پلنِ پریمیوم (مثبت).
 */
export const ledgerKindEnum = pgEnum("ledger_kind", [
  "topup",
  "charge",
  "refund",
  "grant",
]);

/**
 * نوعِ مصرفِ پولیِ هوش مصنوعی (usage_records):
 *   • match        — امتیازدهی/تطبیقِ شغل (scoreAndDraft).
 *   • cover_letter — نگارشِ انگیزه‌نامه (در صورتِ فراخوانیِ جدا).
 *   • resume_parse — ساخت‌یافته‌سازیِ فیلدهای رزومه با هوش مصنوعی.
 */
export const usageKindEnum = pgEnum("usage_kind", [
  "match",
  "cover_letter",
  "resume_parse",
  "resume_tailor", // رزومه‌ی سفارشیِ هر شغل — بازنویسیِ محتوا مطابقِ شرحِ آگهی.
]);

/* ───────────────────────────────  Tables  ──────────────────────────────── */

/**
 * کاربر — احراز هویت با Google OAuth (هویتِ پایدارِ کاربر = حسابِ Googleِ او).
 *
 * هویتِ کاربر «Google sub» (شناسه‌ی پایدارِ Google، هرگز تغییر نمی‌کند) به‌علاوه‌ی
 * ایمیل است — نه شماره‌ی موبایل. `googleSub` و `email` هر دو یکتا هستند؛ هنگامِ ورود،
 * ابتدا با googleSub و سپس (fallback) با email جست‌وجو می‌شود. `name`/`avatarUrl` از
 * پروفایلِ Google در هر ورود به‌روزرسانی می‌شوند.
 *
 * ستونِ `phone` عمداً nullable و «بدونِ یکتایی» نگه داشته شده تا ردیف‌های موجودِ dev و
 * کدِ پایین‌دستی نشکند؛ اما دیگر مسیرِ ورود نیست (بعد از حذفِ OTP بلااستفاده است).
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** شناسه‌ی پایدارِ Google (claim `sub`) — هویتِ اصلیِ کاربر. یکتا. */
    googleSub: text("google_sub"),
    /** ایمیلِ کاربر از Google — یکتا. کلیدِ ثانویه‌ی هویت (fallback هنگامِ ورود). */
    email: text("email"),
    /** نامِ نمایشیِ کاربر از پروفایلِ Google (name claim). */
    name: text("name"),
    /** آدرسِ آواتارِ کاربر از پروفایلِ Google (picture claim). */
    avatarUrl: text("avatar_url"),
    /**
     * شماره‌ی موبایل — دیگر مسیرِ هویت نیست (میراثِ OTP). nullable و بدونِ یکتایی؛
     * صرفاً برای سازگاریِ عقب‌رو نگه داشته شده. E.164، مثلاً +98912...
     */
    phone: text("phone"),
    fullName: text("full_name"),
    /** پلنِ اشتراکِ کاربر — پیش‌فرض رایگان (free). */
    plan: planEnum("plan").notNull().default("free"),
    /**
     * پایانِ دوره‌ی پلنِ پولی (UTC). `null` یعنی بی‌انقضا — پلنِ رایگان، یا کاربرانی که
     * پیش از افزودنِ این ستون ارتقا داده‌اند (سازگاریِ عقب‌رو: قدیمی‌ها downgrade نمی‌شوند).
     *
     * چرا لازم است: پلن‌ها «ماهانه» قیمت‌گذاری و فروخته می‌شوند ولی هیچ انقضا/تمدیدی
     * وجود نداشت — یک پرداخت = آن رده برای همیشه (نشتِ مستقیمِ درآمد). خریدِ موفق این
     * را روی now+۳۰ روز می‌گذارد و کارِ روزانه‌ی `expireLapsedPlans` کاربرانِ گذشته از
     * مهلت را به free برمی‌گرداند.
     */
    planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
    /**
     * شناسه‌ی همین کاربر در استخرِ مشترکِ 1xai (users.id آن‌جا) — هویت و کیف‌پولِ
     * واحدِ خانواده. nullable: در اولین ورود/نیازِ پولی از طریقِ /svc resolve و
     * ذخیره می‌شود (ensureOnexaiLink).
     */
    onexaiUserId: bigint("onexai_user_id", { mode: "number" }),
    /**
     * کلیدِ APIِ 1xaiِ *خودِ کاربر* (خام؛ 1xai فقط هش نگه می‌دارد) — فراخوانی‌های AI
     * کارجو با این کلید انجام می‌شوند تا مصرف با نرخِ خودِ کاربر از کیف‌پولِ واحد
     * متر شود. server-only؛ هرگز به کلاینت نمی‌رود.
     */
    onexaiApiKey: text("onexai_api_key"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_google_sub_uq").on(t.googleSub),
    uniqueIndex("users_email_uq").on(t.email),
  ],
);

/* ───────────────────────────  Auth (احراز هویت)  ───────────────────────── */

/**
 * نشستِ احرازهویت‌شده (وب یا افزونه). توکنِ نشست یک رشته‌ی تصادفیِ مات (opaque)
 * است که فقط هشش اینجا ذخیره می‌شود؛ توکنِ خام تنها به کلاینت داده می‌شود و هرگز
 * در دیتابیس نیست. revokedAt برای خروج/ابطال؛ lastUsedAt برای تشخیص نشستِ مرده.
 */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** هشِ توکنِ نشست (sha256 با pepper). یکتا — جست‌وجوی نشست با همین هش. */
    tokenHash: text("token_hash").notNull(),
    kind: authSessionKindEnum("kind").notNull().default("web"),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("auth_sessions_token_uq").on(t.tokenHash),
    index("auth_sessions_user_idx").on(t.userId),
    index("auth_sessions_expires_idx").on(t.expiresAt),
  ],
);

/**
 * هندآفِ اتصالِ دستگاه برای SSO افزونه — «بدون OTP دوم» (بخش CONTEXT، قاعده‌ی ۵).
 * کاربر در وب (که قبلاً با OTP وارد شده) یک کدِ جفت‌سازیِ یک‌بارمصرف می‌سازد؛ افزونه
 * آن را redeem می‌کند و یک نشستِ 'extension' می‌گیرد. فقط هشِ کد ذخیره می‌شود.
 */
export const deviceLinks = pgTable(
  "device_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** هشِ کدِ جفت‌سازیِ یک‌بارمصرف (sha256 با pepper) — هرگز متنِ خام. */
    pairingCodeHash: text("pairing_code_hash").notNull(),
    status: deviceLinkStatusEnum("status").notNull().default("pending"),
    /** نشستی که پس از redeem موفق برای افزونه ساخته شد (در صورت linked). */
    linkedSessionId: uuid("linked_session_id").references(() => authSessions.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("device_links_code_uq").on(t.pairingCodeHash),
    index("device_links_user_idx").on(t.userId),
    index("device_links_status_idx").on(t.status),
  ],
);

/**
 * یک ردیفِ سابقه‌ی کاری در پروفایل (workExperience jsonb) — شکلِ پایدارِ ذخیره.
 * تاریخ‌ها متنِ آزادند (بازارِ ایران: شمسی/میلادی، بازه‌ی آزاد)؛ `current` یعنی «تا کنون».
 */
export interface ProfileWorkExperience {
  company?: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  current?: boolean;
  description?: string;
}

/** یک ردیفِ تحصیلات در پروفایل (education jsonb). */
export interface ProfileEducation {
  institution?: string;
  degree?: string;
  field?: string;
  startYear?: string;
  endYear?: string;
}

/** یک زبان + سطحِ تسلط در پروفایل (languages jsonb). */
export interface ProfileLanguage {
  name: string;
  level?: string;
}

/** یک لینک (وب‌سایت/لینکدین/گیت‌هاب/…) در پروفایل (links jsonb). */
export interface ProfileLink {
  label?: string;
  url: string;
}

/**
 * پروفایل کارجوی کاربر — معادل CandidateProfile. ترجیحات به‌صورت jsonb.
 *
 * WF2 (پروفایلِ جامع): علاوه بر فیلدهای پایه (نام/عنوان/شهر/مهارت‌ها/سابقه/ترجیحات)،
 * هرچه بردهای ایرانی می‌پرسند اینجا پایدار می‌شود: عکس (avatarUrl)، درباره‌ی من (summary)،
 * تلفن، سابقه‌ی کاری/تحصیلات/زبان‌ها (jsonb array)، حقوقِ درخواستی و لینک‌ها. این فیلدها
 * با هوش مصنوعی (از رزومه) یا دستی پر می‌شوند؛ merge محتاطانه است تا ویرایشِ کاربر پاک نشود.
 */
export const candidateProfiles = pgTable(
  "candidate_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    headline: text("headline"),
    skills: jsonb("skills").$type<string[]>().notNull().default([]),
    yearsExperience: integer("years_experience"),
    city: text("city"),
    resumeText: text("resume_text"),
    /** آدرسِ عکسِ پروفایل (آواتار). ممکن است از Google یا آپلودِ کاربر بیاید. */
    avatarUrl: text("avatar_url"),
    /** «درباره‌ی من» / خلاصه‌ی حرفه‌ای (متنِ آزاد). */
    summary: text("summary"),
    /** شماره‌ی تماسِ کاربر (نمایش در پروفایل/رزومه). */
    phone: text("phone"),
    /** سابقه‌ی کاری — آرایه‌ی jsonb. */
    workExperience: jsonb("work_experience")
      .$type<ProfileWorkExperience[]>()
      .notNull()
      .default([]),
    /** تحصیلات — آرایه‌ی jsonb. */
    education: jsonb("education").$type<ProfileEducation[]>().notNull().default([]),
    /** زبان‌ها + سطحِ تسلط — آرایه‌ی jsonb. */
    languages: jsonb("languages").$type<ProfileLanguage[]>().notNull().default([]),
    /** حقوقِ درخواستی (متنِ آزاد؛ بازارِ ایران اغلب بازه/توافقی می‌نویسد). */
    expectedSalary: text("expected_salary"),
    /** لینک‌ها (وب‌سایت/لینکدین/گیت‌هاب/…) — آرایه‌ی jsonb {label,url}. */
    links: jsonb("links").$type<ProfileLink[]>().notNull().default([]),
    /** JobPreferences از types.ts (titles, cities, minSalary, employmentTypes). */
    preferences: jsonb("preferences").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // یکتا روی userId: هر کاربر دقیقاً یک پروفایل. جلوی ردیف‌های تکراری (ریسِ نوشتنِ
  // هم‌زمان) را می‌گیرد که می‌توانست انتخاب‌های فیلترِ کاربر را بی‌صدا گم کند؛ همچنین
  // پیش‌نیازِ onConflictDoUpdate(target: userId) در مسیرهای نوشتن است.
  (t) => [uniqueIndex("candidate_profiles_user_uq").on(t.userId)],
);

/** رزومه‌ی پایه + گونه‌های تولیدشده توسط هوش مصنوعی برای هر آگهی. */
export const resumes = pgTable(
  "resumes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").references(() => candidateProfiles.id, {
      onDelete: "set null",
    }),
    /** اگر این یک گونه‌ی اختصاصی برای آگهی باشد، به رزومه‌ی پایه اشاره می‌کند. */
    baseResumeId: uuid("base_resume_id"),
    /** آگهی‌ای که این گونه برایش تنظیم شده (برای رزومه‌ی پایه null است). */
    listingId: uuid("listing_id").references(() => jobListings.id, {
      onDelete: "set null",
    }),
    isBase: boolean("is_base").notNull().default(true),
    title: text("title"),
    content: text("content").notNull(),
    /** فایل اصلی (PDF/DOCX) اگر آپلود شده باشد. */
    fileUrl: text("file_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("resumes_user_idx").on(t.userId),
    index("resumes_listing_idx").on(t.listingId),
  ],
);

/** حساب کاربر روی یک سایت کاریابی (کاربر × سایت). */
export const boardAccounts = pgTable(
  "board_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    board: jobBoardEnum("board").notNull(),
    status: boardAccountStatusEnum("status").notNull().default("needs_reauth"),
    /** نام/شناسه‌ی نمایشی حساب در آن سایت (در صورت در دسترس بودن). */
    accountLabel: text("account_label"),
    sessionShape: sessionShapeEnum("session_shape").notNull(),
    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // یک حساب فعال به‌ازای هر (کاربر، سایت).
    uniqueIndex("board_accounts_user_board_uq").on(t.userId, t.board),
    index("board_accounts_status_idx").on(t.status),
  ],
);

/**
 * بلابِ نشست رمزنگاری‌شده و «فناپذیر» — قلب خزانه‌ی نشست.
 * فقط داده‌ی رمزشده ذخیره می‌شود؛ کلید KMS صرفاً روی کنترل‌پلین است.
 * شامل کوکی‌ها و توکن‌های localStorage/IndexedDB (برای جاب‌ویژن SPA لازم است).
 */
export const sessionBlobs = pgTable(
  "session_blobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardAccountId: uuid("board_account_id")
      .notNull()
      .references(() => boardAccounts.id, { onDelete: "cascade" }),
    /** بدنه‌ی رمزنگاری‌شده (cookies + localStorage + headers/UA). base64/bytea به‌صورت متن. */
    ciphertext: text("ciphertext").notNull(),
    /** نانس/IV و شناسه‌ی نسخه‌ی کلید برای رمزگشایی. */
    iv: text("iv").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    sessionShape: sessionShapeEnum("session_shape").notNull(),
    lastRefreshed: timestamp("last_refreshed", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** زمان انقضای تخمینی نشست — بعد از آن باید refresh یا needs_reauth شود. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("session_blobs_account_idx").on(t.boardAccountId),
    index("session_blobs_expires_idx").on(t.expiresAt),
  ],
);

/** آگهی شغلی نرمال‌شده — معادل JobListing. id سامانه‌ای: `${board}:${externalId}`. */
export const jobListings = pgTable(
  "job_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    board: jobBoardEnum("board").notNull(),
    externalId: text("external_id").notNull(),
    /** شناسه‌ی یکتای سطح سیستم از types.ts: `${board}:${externalId}`. */
    canonicalId: text("canonical_id").notNull(),
    title: text("title").notNull(),
    company: text("company"),
    city: text("city"),
    url: text("url").notNull(),
    description: text("description"),
    salary: text("salary"),
    applyType: applyTypeEnum("apply_type").notNull().default("structured"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_listings_canonical_uq").on(t.canonicalId),
    uniqueIndex("job_listings_board_external_uq").on(t.board, t.externalId),
    index("job_listings_board_idx").on(t.board),
    index("job_listings_city_idx").on(t.city),
  ],
);

/** ضبط خام آگهی پیش از نرمال‌سازی — برای بازپخش/دیباگ ingestion. */
export const rawListings = pgTable(
  "raw_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    board: jobBoardEnum("board").notNull(),
    externalId: text("external_id").notNull(),
    /** بدنه‌ی خام (HTML/JSON) همان‌طور که از سایت گرفته شده. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** آگهی نرمال‌شده‌ی مرتبط، پس از پردازش. */
    listingId: uuid("listing_id").references(() => jobListings.id, {
      onDelete: "set null",
    }),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("raw_listings_board_external_idx").on(t.board, t.externalId),
    index("raw_listings_listing_idx").on(t.listingId),
  ],
);

/** تطبیق (کاربر × آگهی): امتیاز هوش مصنوعی، وضعیت، دلیل. */
export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => jobListings.id, { onDelete: "cascade" }),
    /** امتیاز تطبیق ۰ تا ۱ که موتور 1xai محاسبه کرده. */
    score: doublePrecision("score"),
    status: matchStatusEnum("status").notNull().default("pending"),
    /** توضیح هوش مصنوعی درباره‌ی دلیل تطبیق/عدم تطبیق. */
    reason: text("reason"),
    /** انگیزه‌نامه‌ی پیش‌نویس‌شده (اگر بالای آستانه باشد). */
    coverLetter: text("cover_letter"),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // یک تطبیق به‌ازای هر (کاربر، آگهی) — جلوگیری از امتیازدهی تکراری.
    uniqueIndex("matches_user_listing_uq").on(t.userId, t.listingId),
    index("matches_user_status_idx").on(t.userId, t.status),
    index("matches_score_idx").on(t.score),
  ],
);

/** تلاش اپلای — معادل ApplicationResult. proof/externalRef برای اثبات ارسال. */
export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => jobListings.id, { onDelete: "cascade" }),
    resumeId: uuid("resume_id").references(() => resumes.id, { onDelete: "set null" }),
    status: applicationStatusEnum("status").notNull().default("draft"),
    channel: applyChannelEnum("channel"),
    matchScore: doublePrecision("match_score"),
    coverLetter: text("cover_letter"),
    reason: text("reason"),
    /** ارجاع خارجی برگشتی از سایت (شناسه‌ی درخواست). */
    externalRef: text("external_ref"),
    /** اثبات ارسال: اسکرین‌شات/پاسخ API/… به‌صورت ساخت‌یافته. */
    proof: jsonb("proof").$type<Record<string, unknown>>(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // dedupe: حداکثر یک اپلای به‌ازای هر تطبیق.
    uniqueIndex("applications_match_uq").on(t.matchId),
    index("applications_user_status_idx").on(t.userId, t.status),
    index("applications_listing_idx").on(t.listingId),
  ],
);

/**
 * نود ورکر ایرانی — بی‌حالت و فناپذیر؛ فقط متادیتا/سلامت/اعتبارنامه اینجاست
 * (هرگز نشستِ کاربر؛ نشست فقط در لحظه‌ی dispatch، رمزگشایی‌شده، به نودِ مجاز می‌رود).
 *
 * چرخه‌ی عمرِ نود (WF worker-fleet، قاعده‌ی ۱): نود با یک ENROLLMENT TOKENِ یک‌بارمصرف
 * (از env) ثبت‌نام می‌کند → سرور توکن را راستی‌آزمایی و یک CREDENTIALِ هر-نودی صادر
 * می‌کند (فقط hashش ذخیره می‌شود، credentialHash) → نود هر فراخوانی را با همان اعتبارنامه
 * احراز می‌کند؛ heartbeat با health + agentVersion می‌زند. سرور نود را با اعتبارنامه +
 * IP/region گزارش‌شده «می‌شناسد».
 */
export const workerNodes = pgTable(
  "worker_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** شناسه‌ی پایدار نود (از پیکربندی خودِ نود). */
    nodeKey: text("node_key").notNull(),
    /** کلاس IP/منطقه — مثلاً «IR-residential». */
    region: text("region"),
    health: workerHealthEnum("health").notNull().default("offline"),
    /** ظرفیت همزمان (تعداد job همزمان). */
    capacity: integer("capacity").notNull().default(1),
    /**
     * هشِ اعتبارنامه‌ی هر-نودی (sha256/HMAC با pepperِ سرور) — هرگز اعتبارنامه‌ی خام.
     * یکتا؛ تا پیش از ثبت‌نام null است (نودِ هنوز ثبت‌نام‌نشده اعتبارنامه ندارد).
     */
    credentialHash: text("credential_hash"),
    /**
     * هشِ توکنِ ثبت‌نامی که برای صدورِ این اعتبارنامه استفاده شد (برای ممیزی/گردشِ
     * اعتبارنامه). هرگز توکنِ خام. nullable.
     */
    enrollmentTokenHash: text("enrollment_token_hash"),
    /** نسخه‌ی عاملِ گزارش‌شده در heartbeat (برای دیدِ وضعیتِ ناوگان). */
    agentVersion: text("agent_version"),
    /** آخرین IPِ گزارش‌شده‌ی نود (سرور با اعتبارنامه + IP/region نود را «می‌شناسد»). */
    ipAddress: text("ip_address"),
    lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
    /** آخرین زمانی که نود دیده شد (ثبت‌نام/heartbeat/poll) — برای تشخیصِ نودِ مرده. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("worker_nodes_key_uq").on(t.nodeKey),
    // اعتبارنامه یکتا — جست‌وجوی نود با هشِ اعتبارنامه (راستی‌آزماییِ هر فراخوانی).
    // partial: فقط ردیف‌هایی که اعتبارنامه دارند، تا چند نودِ ثبت‌نام‌نشده (NULL) برخورد نکنند.
    uniqueIndex("worker_nodes_credential_uq")
      .on(t.credentialHash)
      .where(sql`credential_hash IS NOT NULL`),
    index("worker_nodes_health_idx").on(t.health),
  ],
);

/**
 * تخصیصِ نودِ ورکر به کاربر (worker_assignments) — قاعده‌ی ۲ (سقفِ IP بر اساسِ پلن).
 *
 * «کدام نودها برای کدام کاربر اپلای می‌کنند». یک کاربر حداکثر workerIpLimitFor(plan)
 * نود می‌تواند داشته باشد (Max=۱، MaxPlus=۵؛ Free/Pro=۰). سقف هنگامِ تخصیص اعمال می‌شود
 * (src/lib/fleet/assign.ts). جفتِ (userId, nodeId) یکتاست.
 */
export const workerAssignments = pgTable(
  "worker_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => workerNodes.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // یک تخصیص به‌ازای هر (کاربر، نود) — جلوگیری از تخصیصِ تکراری.
    uniqueIndex("worker_assignments_user_node_uq").on(t.userId, t.nodeId),
    index("worker_assignments_node_idx").on(t.nodeId),
    index("worker_assignments_user_idx").on(t.userId),
  ],
);

/**
 * فرمانِ سرور به نودِ ورکر (worker_commands) — قاعده‌ی ۴ (به‌روزرسانیِ فرمان‌محور).
 *
 * سرور یک فرمانِ 'update'/'restart' صادر می‌کند؛ نود pollش می‌کند، اجرا و ack می‌دهد.
 * payload جزئیاتِ اختیاریِ فرمان (مثلاً نسخه‌ی هدف)؛ result خروجیِ اجرای نود (خروجی/خطا).
 */
export const workerCommands = pgTable(
  "worker_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => workerNodes.id, { onDelete: "cascade" }),
    command: workerCommandEnum("command").notNull(),
    /** جزئیاتِ اختیاریِ فرمان (مثلاً { targetVersion }). هرگز راز/نشست. */
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    status: workerCommandStatusEnum("status").notNull().default("pending"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** خروجیِ اجرای فرمان توسطِ نود (stdout/exitCode/error). */
    result: jsonb("result").$type<Record<string, unknown>>(),
  },
  (t) => [
    // فهرستِ poll: فرمان‌های pendingِ یک نود (status را هم در WHERE داریم).
    index("worker_commands_node_status_idx").on(t.nodeId, t.status),
  ],
);

/**
 * ردیف صف اپلای. مصرف با `SELECT … FOR UPDATE SKIP LOCKED` (بخش ۸ سند).
 * idempotencyKey یکتاست تا یک تطبیق دوبار وارد صف نشود.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** کلید ایدمپوتنسی — مثلاً `apply:${matchId}`. یکتا. */
    idempotencyKey: text("idempotency_key").notNull(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    /** اشاره به board_account که نشستش برای این اپلای استفاده می‌شود. */
    sessionRef: uuid("session_ref").references(() => boardAccounts.id, {
      onDelete: "set null",
    }),
    /** بار وظیفه (payload) — جزئیات لازم برای اجرای اپلای. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: taskStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    /** زودترین زمان مجاز اجرا (jitter/throttle/backoff). */
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    /** نود/مصرف‌کننده‌ای که این وظیفه را اجاره کرده. */
    leasedBy: uuid("leased_by").references(() => workerNodes.id, {
      onDelete: "set null",
    }),
    leasedAt: timestamp("leased_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tasks_idempotency_uq").on(t.idempotencyKey),
    // فهرست برداشت صف: ردیف‌های آماده بر اساس زمان اجرا.
    index("tasks_status_runafter_idx").on(t.status, t.runAfter),
    index("tasks_match_idx").on(t.matchId),
  ],
);

/**
 * لاگ ممیزی فقط-افزودنی (append-only) — هر نشست ضبط/استفاده/refresh‌شده و هر اپلای.
 * این جدول هرگز update/delete نمی‌شود (قاعده‌ی ایمنی سند).
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    boardAccountId: uuid("board_account_id").references(() => boardAccounts.id, {
      onDelete: "set null",
    }),
    applicationId: uuid("application_id").references(() => applications.id, {
      onDelete: "set null",
    }),
    eventType: auditEventTypeEnum("event_type").notNull(),
    /** متادیتای رویداد (IP نود، fingerprint نشست، نتیجه و …). */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_user_idx").on(t.userId),
    index("audit_events_type_idx").on(t.eventType),
    index("audit_events_created_idx").on(t.createdAt),
  ],
);

/* ─────────────────  WF1: پروفایل‌سازی و ایمپورت چندسایته  ───────────────── */

/**
 * فایلِ رزومه (PDF آپلودشده یا داده‌ی ایمپورت‌شده) — مسیرِ پردازشِ پروفایل‌سازی.
 *
 * مسیرِ رایگان: استخراجِ متنِ خام (extractedText) با کتابخانه‌ی unpdf. مسیرِ هوش‌مصنوعی:
 * ساخت‌یافته‌سازیِ فیلدها (parsedFields) از طریق گیت‌وی 1xai. هر دو nullable‌اند تا
 * رکورد بلافاصله پس از آپلود ساخته شود و پردازش به‌صورت تدریجی پر شود.
 *
 * فایلِ خام فعلاً به‌صورت محلی روی دیسک نگه‌داری می‌شود (storagePath)؛ راهبردِ پوشه‌ی
 * آپلود در src/lib/resume/storage.ts مستند است (./uploads یا KARJOO_UPLOADS_DIR).
 */
export const resumeFiles = pgTable(
  "resume_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    /** مسیرِ فایلِ خام روی دیسکِ محلی (نسبت به پوشه‌ی آپلود). */
    storagePath: text("storage_path").notNull(),
    /** متنِ خامِ استخراج‌شده از PDF (مسیرِ رایگان) — تا پردازش انجام نشده null است. */
    extractedText: text("extracted_text"),
    /** فیلدهای ساخت‌یافته‌ی استخراج‌شده با هوش مصنوعی (نام، مهارت‌ها، سابقه و …). */
    parsedFields: jsonb("parsed_fields").$type<Record<string, unknown>>(),
    source: resumeSourceEnum("source").notNull().default("upload"),
    /**
     * «رزومه‌ی اصلی» (WF2 — مسیرِ PDF-only): PDFی که کاربر مستقیم به اپلای‌ها می‌چسباند،
     * *بدونِ* استخراجِ هوش مصنوعی. حداکثر یک فایلِ اصلی به‌ازای هر کاربر — با ایندکسِ
     * partial unique زیر تضمین می‌شود. تنظیمش (setPrimaryResumeFile) اول همه را false و
     * سپس این یکی را true می‌کند (اتمیک، در یک تراکنش). پیش‌فرض false.
     */
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("resume_files_user_idx").on(t.userId),
    // حداکثر یک رزومه‌ی «اصلی» به‌ازای هر کاربر — partial: فقط ردیف‌های is_primary=true
    // در یکتایی شرکت می‌کنند (چند ردیفِ is_primary=false برخورد نمی‌کنند).
    uniqueIndex("resume_files_primary_uq")
      .on(t.userId)
      .where(sql`is_primary = true`),
  ],
);

/**
 * تاکسونومیِ دسته‌بندیِ مشاغلِ ایران — درختیِ تک‌سطحی/چندسطحی (parentId خود-ارجاع).
 * با ~۲۵ دسته‌ی متداولِ بازارِ کارِ ایران seed می‌شود (src/lib/taxonomy). slug یکتاست
 * و در URL/فیلتر استفاده می‌شود؛ برچسبِ فارسی و انگلیسی برای نمایشِ دوزبانه.
 */
export const jobCategories = pgTable(
  "job_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    labelFa: text("label_fa").notNull(),
    labelEn: text("label_en").notNull(),
    /** دسته‌ی والد (برای زیرشاخه‌ها) — برای دسته‌ی ریشه null است. خود-ارجاع. */
    parentId: uuid("parent_id").references((): AnyPgColumn => jobCategories.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("job_categories_slug_uq").on(t.slug)],
);

/**
 * علاقه‌مندی/انتخابِ دسته‌بندیِ کاربر (کاربر × دسته) — هر جفت یکتا. این انتخاب‌ها
 * JobPreferences (titles/categories) را تغذیه می‌کنند که در جست‌وجو/تطبیق به‌کار می‌رود.
 */
export const userInterests = pgTable(
  "user_interests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => jobCategories.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // یک علاقه‌مندی به‌ازای هر (کاربر، دسته) — جلوگیری از انتخابِ تکراری.
    uniqueIndex("user_interests_user_category_uq").on(t.userId, t.categoryId),
    index("user_interests_user_idx").on(t.userId),
  ],
);

/**
 * رکوردِ ایمپورتِ پروفایل از یک سایت کاریابی (قابلیتِ حملِ داده‌ی کاربر — §10).
 *
 * قاعده‌ی سختِ ایمنی: rawPayload فقط *داده‌ی* پروفایل/رزومه/سابقه‌ی اپلایِ کاربر است
 * که افزونه از صفحه‌ی خودِ کاربر خوانده — هرگز کوکی/توکن/رمزِ سایتِ مبدأ. اندپوینتِ
 * ایمپورت هر فیلدِ شبیهِ اعتبارنامه را رد می‌کند. appliedFields آن‌چیزی است که پس از
 * نرمال‌سازی روی CandidateProfile merge شد (برای شفافیت/آنچه تغییر کرد).
 */
export const profileImports = pgTable(
  "profile_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    board: jobBoardEnum("board").notNull(),
    status: profileImportStatusEnum("status").notNull().default("received"),
    /** DATAِ خامی که افزونه فرستاد (پروفایل/رزومه/سابقه) — هرگز اعتبارنامه. */
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull(),
    /** فیلدهایی که پس از نرمال‌سازی روی پروفایلِ کاربر اعمال شد. */
    appliedFields: jsonb("applied_fields").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("profile_imports_user_idx").on(t.userId),
    index("profile_imports_board_idx").on(t.board),
  ],
);

/* ───────────────────  Billing / metering tables (کیف‌پول)  ──────────────── */

/**
 * کاتالوگِ مدل‌های هوش مصنوعی — منبعِ حقیقتِ قیمت‌گذاری (به تومان) و قابلیت‌ها.
 *
 * با catalog-sync از گیت‌وی 1xai پر می‌شود؛ اگر اندپوینت در دسترس نباشد، با SEED
 * منحنیِ مدل‌های شناخته‌شده پر می‌شود تا هرگز خالی نماند. قیمت‌ها «به‌ازای هر ۱۰۰۰
 * توکن، به تومان» ذخیره می‌شوند (bigint — صحیح، بدونِ خطای ممیزِ شناور).
 */
export const aiModelCatalog = pgTable(
  "ai_model_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: aiProviderEnum("provider").notNull(),
    /** شناسه‌ی مدل در گیت‌وی (مثلاً gpt-4o-mini) — یکتا. */
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    /** قیمتِ ورودی به‌ازای هر ۱۰۰۰ توکن، به تومان. */
    inputPer1kToman: bigint("input_per_1k_toman", { mode: "number" }).notNull(),
    /** قیمتِ خروجی به‌ازای هر ۱۰۰۰ توکن، به تومان. */
    outputPer1kToman: bigint("output_per_1k_toman", { mode: "number" }).notNull(),
    /** پنجره‌ی متن (context window) — در صورتِ گزارشِ گیت‌وی. */
    contextWindow: integer("context_window"),
    /** برچسب‌ها: recommended | premium | cheap | fast | persian … (برای UI). */
    tags: text("tags").array().notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ai_model_catalog_model_uq").on(t.modelId),
    index("ai_model_catalog_provider_idx").on(t.provider),
    index("ai_model_catalog_enabled_idx").on(t.enabled),
  ],
);

/**
 * مدلِ انتخابیِ کاربر (کاربر × یک تنظیم). فراخوانی‌های پولیِ کاربر با این مدل اجرا
 * می‌شوند مگر اینکه درخواست صریحاً مدلِ دیگری بدهد. یکتا روی userId.
 */
export const userAiSettings = pgTable(
  "user_ai_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: aiProviderEnum("provider").notNull(),
    modelId: text("model_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_ai_settings_user_uq").on(t.userId)],
);

/**
 * کیف‌پولِ کاربر (کاربر × یک کیف‌پول). موجودی به تومان (bigint — صحیح).
 * یکتا روی userId؛ هر کاربر دقیقاً یک کیف‌پول دارد.
 */
export const wallets = pgTable(
  "wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    balanceToman: bigint("balance_toman", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("wallets_user_uq").on(t.userId)],
);

/**
 * دفترِ کیف‌پول (append-only) — هر تغییرِ موجودی یک ردیف. amountToman علامت‌دار
 * (+ شارژ/هدیه/بازگشت، − کسر)؛ balanceAfterToman موجودیِ پس از این رویداد را تثبیت
 * می‌کند تا تاریخچه‌ی حسابرسی‌پذیر بماند. refType/refId به منبعِ رویداد اشاره می‌کند.
 */
export const walletLedger = pgTable(
  "wallet_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: ledgerKindEnum("kind").notNull(),
    /** مبلغِ علامت‌دار به تومان (+ topup/grant/refund، − charge). */
    amountToman: bigint("amount_toman", { mode: "number" }).notNull(),
    /** موجودیِ پس از این رویداد — برای حسابرسیِ تاریخی. */
    balanceAfterToman: bigint("balance_after_toman", { mode: "number" }).notNull(),
    /** نوعِ منبعِ رویداد، مثلاً 'usage_record' | 'topup' | 'grant'. */
    refType: text("ref_type"),
    refId: text("ref_id"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wallet_ledger_user_created_idx").on(t.userId, t.createdAt),
    // ایدمپوتنسیِ گرنتِ ماهانه (WF3 بخش E): یکتاییِ (user, refId) *فقط* برای ردیف‌های
    // 'grant'. ایندکسِ partial (WHERE kind = 'grant') است تا با refIdهای nullable/تکراریِ
    // ردیف‌های topup/charge برخورد نکند. با این یکتایی، دو grantOnceِ همزمان برای یک
    // (کاربر، ماه) نمی‌توانند هر دو درج کنند: دومی روی unique-violation شکست می‌خورد و کلِ
    // تراکنشش (شاملِ credit) rollback می‌شود → گرنت واقعاً ایدمپوتنت می‌ماند.
    uniqueIndex("wallet_ledger_grant_ref_uq")
      .on(t.userId, t.refId)
      .where(sql`kind = 'grant'`),
  ],
);

/**
 * رکوردِ مصرفِ پولیِ هوش مصنوعی — یک ردیف به‌ازای هر فراخوانیِ مترشده. توکن‌های
 * مصرف‌شده + هزینه‌ی بالادست (1xai) + درصدِ حاشیه‌ی سود + هزینه‌ی نهاییِ کسرشده از کاربر.
 */
export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: usageKindEnum("kind").notNull(),
    provider: aiProviderEnum("provider").notNull(),
    modelId: text("model_id").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    /** هزینه‌ی خامِ بالادست (1xai) به تومان — پیش از حاشیه‌ی سود. */
    upstreamCostToman: bigint("upstream_cost_toman", { mode: "number" }).notNull(),
    /** درصدِ حاشیه‌ی سودِ کارجو که هنگامِ این فراخوانی اعمال شد. */
    marginPct: integer("margin_pct").notNull(),
    /** هزینه‌ی نهاییِ کسرشده از کیف‌پولِ کاربر به تومان (بالادست × (۱ + حاشیه)). */
    costToman: bigint("cost_toman", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_records_user_created_idx").on(t.userId, t.createdAt)],
);

/* ─────────────────  WF3: گاردریل‌های ایمنی (بودجه + تنظیمات)  ───────────── */

/**
 * شمارنده‌ی ماهانه‌ی هزینه‌ی *بالادستِ* هوش مصنوعیِ کلِ اپ — قلبِ گاردریلِ بودجه.
 *
 * به‌جای اسکنِ کاملِ usage_records در هر فراخوانی، این شمارنده داخلِ همان تراکنشِ
 * تسویه‌ی metering با مقدارِ upstreamCostToman هر فراخوانی افزایش می‌یابد (یک ردیف
 * به‌ازای هر ماهِ تقویمی). وقتی جمعِ ماه ≥ سقف شود، حالتِ نگه‌داریِ هوش مصنوعی فعال
 * می‌شود و هر فراخوانیِ پولی بلاک می‌گردد (assertAiAvailable).
 *
 * periodMonth قالبِ 'YYYY-MM' (مثلاً '2026-06') و یکتاست — یک ردیف برای هر ماه.
 */
export const appAiBudget = pgTable(
  "app_ai_budget",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** ماهِ تقویمی به قالبِ 'YYYY-MM' (UTC) — یکتا. */
    periodMonth: text("period_month").notNull(),
    /** جمعِ هزینه‌ی بالادستِ هوش مصنوعیِ این ماه به تومان (شمارنده‌ی فزاینده). */
    upstreamCostToman: bigint("upstream_cost_toman", { mode: "number" })
      .notNull()
      .default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("app_ai_budget_period_uq").on(t.periodMonth)],
);

/**
 * تنظیماتِ سراسریِ اپ — جدولِ تک‌ردیفیِ کلیددار (singleton).
 *
 * فعلاً فقط پرچمِ aiMaintenanceManual را نگه می‌دارد: اگر دستی true شود، حالتِ نگه‌داریِ
 * هوش مصنوعی صرف‌نظر از بودجه فعال می‌شود (برای خاموش/روشن‌کردنِ دستیِ سرویس). با کلیدِ
 * ثابتِ 'global' یکتا می‌ماند تا همیشه دقیقاً یک ردیفِ تنظیمات وجود داشته باشد.
 */
export const appSettings = pgTable(
  "app_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** کلیدِ ثابتِ singleton — همیشه 'global' (یکتا). */
    key: text("key").notNull().default("global"),
    /** خاموش/روشن‌کردنِ دستیِ حالتِ نگه‌داریِ هوش مصنوعی (force maintenance). */
    aiMaintenanceManual: boolean("ai_maintenance_manual").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("app_settings_key_uq").on(t.key)],
);

/* ────────  Auto-apply: دو سطحِ مستقل — افزونه (مرورگر) و سرور (پَسیو)  ──────── */

/**
 * تنظیماتِ «اپلای خودکار در مرورگر» (سطحِ افزونه) به‌ازای هر کاربر — یکتا روی userId.
 *
 * قاعده‌ی ۱ (CONTEXT/§۱۰): هیچ‌چیز به‌صورتِ خودکار اپلای نمی‌شود مگر کاربر این تاگل را
 * صریحاً روشن کند (رضایتِ یک‌باره، قابلِ لغو در هر زمان). پیش‌فرضِ `enabled` = false.
 *
 * دامنه (GOAL 3): این جدول اکنون *به‌طورِ خاص* تاگلِ سطحِ «افزونه» است — اپلای در مرورگرِ
 * خودِ کاربر (حلقه‌ی chrome.alarms). در دسترسِ *همه‌ی* پلن‌هاست. سطحِ «سرور» (ناوگانِ
 * پَسیوِ ۲۴/۷) تاگلِ جداگانه‌ی خود را در `user_server_auto_apply` دارد و پلن‌گِیت است.
 *
 * `minScore` آستانه‌ی امتیازِ تطبیق است که هر اپلایِ خودکار باید از آن بگذرد (پیش‌فرض
 * ۰٫۷). سقفِ روزانه جداگانه از طریقِ apply-quota (پلن) اعمال می‌شود؛ اینجا فقط تاگل و
 * آستانه نگه‌داری می‌شود. هر تغییرِ تاگل یک ردیفِ audit_events (auto_apply_*) می‌نویسد.
 */
export const userAutoApply = pgTable(
  "user_auto_apply",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** تاگلِ رضایتِ اپلای خودکارِ *مرورگر* — پیش‌فرض خاموش (بدونِ روشن‌کردنِ صریح، هیچ). */
    enabled: boolean("enabled").notNull().default(false),
    /** آستانه‌ی امتیازِ تطبیق (۰..۱) که هر اپلایِ خودکار باید از آن بگذرد. پیش‌فرض ۰٫۷. */
    minScore: doublePrecision("min_score").notNull().default(0.7),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // یک ردیفِ تنظیمات به‌ازای هر کاربر.
    uniqueIndex("user_auto_apply_user_uq").on(t.userId),
  ],
);

/**
 * تنظیماتِ «اپلای خودکار روی سرور» (سطحِ پَسیو/ناوگان) به‌ازای هر کاربر — یکتا روی userId.
 *
 * این تاگلِ *مستقلِ* دیگری است (GOAL 3): وقتی روشن باشد، ناوگانِ سرورِ کارجو (نودهای
 * ایرانی، ۲۴/۷، بدونِ نیاز به مرورگرِ باز) اپلای را برای کاربر انجام می‌دهد. برخلافِ
 * تاگلِ افزونه، این سطح *پلن‌گِیت* است: فقط پلن‌هایی با workerIpLimit > ۰ (Max/Max+)
 * می‌توانند آن را مؤثر روشن کنند؛ برای Free/Pro گِیتِ سرور (assertServerAutoApplyAllowed)
 * حتی با enabled=true هم رد می‌کند (پرامتِ ارتقا در UI).
 *
 * پیش‌فرضِ `enabled` = false (fail-closed). `minScore` آستانه‌ی سطحِ سرور است (پیش‌فرض
 * ۰٫۷)، جدا از آستانه‌ی افزونه تا هر مسیر تنظیمِ مستقل داشته باشد. هر تغییرِ تاگل یک
 * ردیفِ audit_events با kindِ server_auto_apply_* می‌نویسد.
 */
export const userServerAutoApply = pgTable(
  "user_server_auto_apply",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** تاگلِ رضایتِ اپلای خودکارِ *سرور* — پیش‌فرض خاموش. پلن‌گِیت هنگامِ اعمال. */
    enabled: boolean("enabled").notNull().default(false),
    /** آستانه‌ی امتیازِ تطبیقِ سطحِ سرور (۰..۱). پیش‌فرض ۰٫۷ (هم‌راستا با افزونه). */
    minScore: doublePrecision("min_score").notNull().default(0.7),
    /**
     * آخرین باری که زمان‌بندِ کشفِ سرور این کاربر را *تلاش* کرد (موفق یا ردشده). مبنای
     * چرخشِ منصفانه است: هر دور کاربرانِ دیرترین‌تلاش‌شده را می‌گیرد و این را به‌روز می‌کند،
     * پس کاربرانِ همیشه-ردشده (مثلاً بی‌موجودی) جلوی صف را قفل نمی‌کنند و کسی گرسنه نمی‌ماند.
     */
    lastDiscoveryAt: timestamp("last_discovery_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // یک ردیفِ تنظیماتِ سرور به‌ازای هر کاربر.
    uniqueIndex("user_server_auto_apply_user_uq").on(t.userId),
    // چرخشِ زمان‌بند: کاربرانِ دیرترین‌تلاش‌شده را سریع بیاب.
    index("user_server_auto_apply_last_discovery_idx").on(t.lastDiscoveryAt),
  ],
);

/**
 * مکان‌نمای صفحه‌بندیِ فیلترمود — به‌ازای (کاربر × سایت × امضای فیلتر).
 *
 * `runFilterApply` در هر اجرا از `nextPage` آغاز می‌کند و آن را جلو می‌برد تا اجراهای
 * پیاپیِ «جست‌وجوی مشاغل» (دستی یا زمان‌بندِ سرور) به‌جای اسکنِ همیشگیِ صفحاتِ نخست، در
 * عمقِ نتایج پیش بروند. با تغییرِ فیلترها `filter_sig` عوض می‌شود و مکان‌نمای تازه‌ای از
 * صفحه‌ی ۱ می‌سازد. رسیدن به انتهای نتایج → بازنشانی به ۱ (اسکنِ دوباره‌ی سرِ فهرست برای
 * آگهی‌های تازه؛ dedupe در لایه‌ی matches/tasks از اپلای تکراری جلوگیری می‌کند).
 */
export const filterCursors = pgTable(
  "filter_cursors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** سایتِ کاریابی (فعلاً فقط 'jobinja' زنده است). متن، نه enum — کلیدِ مکان‌نماست. */
    board: text("board").notNull(),
    /** امضای پایدارِ فیلترهای هدف‌گیری؛ تغییرِ فیلتر → امضای نو → مکان‌نمای نو. */
    filterSig: text("filter_sig").notNull(),
    /** صفحه‌ای که اجرای بعدی باید از آن آغاز کند (۱-مبنا). */
    nextPage: integer("next_page").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // یک مکان‌نما به‌ازای هر (کاربر، سایت، امضای فیلتر).
    uniqueIndex("filter_cursors_user_board_sig_uq").on(t.userId, t.board, t.filterSig),
  ],
);

/** دسته‌بندیِ نرمال‌شده‌ی وضعیتِ یک درخواستِ اپلای روی سایت (برای قیفِ تحلیل). */
export const boardApplicationStatusEnum = pgEnum("board_application_status", [
  "pending", // در انتظار / جدید
  "review", // بررسی / دیده‌شده
  "interview", // مصاحبه
  "rejected", // رد / بایگانی
  "other",
]);

/**
 * عکس‌برداریِ درخواست‌های اپلایِ کاربر روی یک سایت (منبعِ قیفِ تحلیلِ کاربر). با هر همگام‌سازی
 * (extension push یا واکشیِ سرور با نشستِ vault) به‌روز می‌شود. externalId = شناسه‌ی درخواست
 * در آن سایت (مثلِ /jobs/applied/{shortId} در جابینجا).
 */
export const boardApplications = pgTable(
  "board_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    board: text("board").notNull(),
    /** شناسه‌ی درخواست در خودِ سایت (کلیدِ dedupe). */
    externalId: text("external_id").notNull(),
    title: text("title"),
    company: text("company"),
    url: text("url"),
    /** متنِ خامِ وضعیت همان‌طور که سایت نشان می‌دهد (مثلِ «مصاحبه»). */
    statusRaw: text("status_raw"),
    /** دسته‌ی نرمال‌شده برای قیف. */
    statusCategory: boardApplicationStatusEnum("status_category").notNull().default("pending"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("board_applications_user_board_ext_uq").on(t.userId, t.board, t.externalId),
    index("board_applications_user_status_idx").on(t.userId, t.statusCategory),
  ],
);

/**
 * عکس‌برداریِ پروفایل/رزومه‌ی کاربر روی یک سایت (برای نمایشِ «پروفایلِ جابینجایِ شما» در
 * داشبورد). `data` نگاشتِ ساخت‌یافته‌ی پروفایل است (نام، عنوان، درباره، مهارت‌ها، سوابق…).
 */
export const boardProfileSnapshots = pgTable(
  "board_profile_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    board: text("board").notNull(),
    /** نگاشتِ پروفایل (JSON): fullName, headline, about, skills[], experience[], education[], contact… */
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    /** نشانیِ پروفایلِ عمومیِ سایت (اگر موجود؛ مثلِ jobinja.ir/profile/{slug}). */
    publicUrl: text("public_url"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("board_profile_snapshots_user_board_uq").on(t.userId, t.board)],
);

/* ─────────────────────  Inferred types (برای پایین‌دست)  ────────────────── */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;
export type DeviceLink = typeof deviceLinks.$inferSelect;
export type NewDeviceLink = typeof deviceLinks.$inferInsert;
export type CandidateProfileRow = typeof candidateProfiles.$inferSelect;
export type NewCandidateProfileRow = typeof candidateProfiles.$inferInsert;
export type ResumeRow = typeof resumes.$inferSelect;
export type NewResumeRow = typeof resumes.$inferInsert;
export type BoardAccount = typeof boardAccounts.$inferSelect;
export type NewBoardAccount = typeof boardAccounts.$inferInsert;
export type SessionBlob = typeof sessionBlobs.$inferSelect;
export type NewSessionBlob = typeof sessionBlobs.$inferInsert;
export type FilterCursor = typeof filterCursors.$inferSelect;
export type NewFilterCursor = typeof filterCursors.$inferInsert;
export type BoardApplication = typeof boardApplications.$inferSelect;
export type NewBoardApplication = typeof boardApplications.$inferInsert;
export type BoardProfileSnapshot = typeof boardProfileSnapshots.$inferSelect;
export type NewBoardProfileSnapshot = typeof boardProfileSnapshots.$inferInsert;
export type JobListingRow = typeof jobListings.$inferSelect;
export type NewJobListingRow = typeof jobListings.$inferInsert;
export type RawListing = typeof rawListings.$inferSelect;
export type NewRawListing = typeof rawListings.$inferInsert;
export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
export type ApplicationRow = typeof applications.$inferSelect;
export type NewApplicationRow = typeof applications.$inferInsert;
export type WorkerNode = typeof workerNodes.$inferSelect;
export type NewWorkerNode = typeof workerNodes.$inferInsert;
export type WorkerAssignment = typeof workerAssignments.$inferSelect;
export type NewWorkerAssignment = typeof workerAssignments.$inferInsert;
export type WorkerCommandRow = typeof workerCommands.$inferSelect;
export type NewWorkerCommandRow = typeof workerCommands.$inferInsert;
/** نوعِ فرمانِ ورکر به‌صورتِ unionِ نوع‌دار (update|restart). */
export type WorkerCommand = (typeof workerCommandEnum.enumValues)[number];
/** وضعیتِ فرمانِ ورکر به‌صورتِ unionِ نوع‌دار. */
export type WorkerCommandStatus = (typeof workerCommandStatusEnum.enumValues)[number];
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
export type ResumeFile = typeof resumeFiles.$inferSelect;
export type NewResumeFile = typeof resumeFiles.$inferInsert;
export type JobCategory = typeof jobCategories.$inferSelect;
export type NewJobCategory = typeof jobCategories.$inferInsert;
export type UserInterest = typeof userInterests.$inferSelect;
export type NewUserInterest = typeof userInterests.$inferInsert;
export type ProfileImport = typeof profileImports.$inferSelect;
export type NewProfileImport = typeof profileImports.$inferInsert;

/* ─────────────────────────  کارت‌به‌کارت (billing)  ──────────────────────── */

/** نوعِ درخواستِ پرداختِ کارت‌به‌کارت: شارژِ کیف‌پول یا ارتقای پلن. */
export const paymentKindEnum = pgEnum("payment_kind", ["topup", "plan"]);
/** وضعیتِ بررسیِ ادمین. */
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "approved", "rejected"]);

/**
 * درخواست‌های پرداختِ کارت‌به‌کارت. کاربر مبلغ را به کارتِ مقصد منتقل و کدِ پیگیری را
 * ثبت می‌کند؛ سپس ادمین *تأیید* می‌کند و تنها آن‌وقت کیف‌پول credit یا پلن ارتقا می‌یابد.
 * هیچ اعتباری بدونِ تأییدِ انسانی داده نمی‌شود (جایگزینِ استابِ خودشارژِ توسعه).
 */
export const paymentRequests = pgTable(
  "payment_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: paymentKindEnum("kind").notNull(),
    /** مبلغِ ادعاشده‌ی کارت‌به‌کارت به تومان. */
    amountToman: bigint("amount_toman", { mode: "number" }).notNull(),
    /** فقط برای kind='plan': پلنِ مقصد. */
    targetPlan: planEnum("target_plan"),
    /** کدِ پیگیری/رهگیریِ تراکنشِ کارت‌به‌کارت (از اپِ بانکِ کاربر). */
    referenceCode: text("reference_code"),
    /** ۴ رقمِ آخرِ کارتِ پرداخت‌کننده (اختیاری — برای تطبیق). */
    payerCardLast4: text("payer_card_last4"),
    /** یادداشتِ کاربر. */
    note: text("note"),
    status: paymentStatusEnum("status").notNull().default("pending"),
    /** برچسبِ ادمینی که بررسی کرد. */
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    /** ردیفِ دفترِ کیف‌پول که هنگامِ تأییدِ topup ساخته شد. */
    ledgerId: text("ledger_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payment_requests_user_created_idx").on(t.userId, t.createdAt),
    index("payment_requests_status_idx").on(t.status),
  ],
);

export type PaymentRequest = typeof paymentRequests.$inferSelect;
export type NewPaymentRequest = typeof paymentRequests.$inferInsert;
export type PaymentKind = (typeof paymentKindEnum.enumValues)[number];
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number];

/* ─────────────────────  خریدِ پلن (کیف‌پولِ واحدِ 1xai)  ─────────────────────── */

/**
 * وضعیتِ خریدِ پلن:
 *   pending   → ردیف ساخته شده؛ debit شاید هنوز/شاید در راه (ابهامِ کرش را reference حل می‌کند).
 *   debited   → debit قطعاً سمتِ 1xai نشسته؛ ثبتِ پلن مانده.
 *   completed → پول کسر و پلن ست شد.
 *   abandoned → بدونِ اثرِ مالیِ خالص کنار گذاشته شد (یا هرگز debit نشد یا refund شد).
 */
export const planPurchaseStatusEnum = pgEnum("plan_purchase_status", [
  "pending",
  "debited",
  "completed",
  "abandoned",
]);

/**
 * دفترِ خریدِ پلن — رفعِ ریشه‌ایِ لبه‌ی «رفتِ ماه» در ارتقا: referenceِ کسر (پسوندِ
 * `plan:<rowId>`) *یک‌بار با خودِ ردیف* ساخته می‌شود و هیچ مؤلفه‌ی زمانی ندارد؛ پس
 * retry پس از هر کرشی (حتی پس از رفتنِ ماهِ UTC) به همان reference می‌رسد و ایندکسِ
 * یکتای سمتِ 1xai دوباره‌کسر را ساختاری ناممکن می‌کند. ایندکسِ یکتایِ جزئی «یک خریدِ
 * بازِ هم‌زمان به‌ازای هر کاربر» دوکلیکِ هم‌زمان را هم سریالایز می‌کند.
 */
export const planPurchases = pgTable(
  "plan_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** پلنِ مقصدِ این خرید. */
    plan: planEnum("plan").notNull(),
    /** قیمتِ لحظه‌ی خرید (تومان). */
    amountToman: bigint("amount_toman", { mode: "number" }).notNull(),
    /** پسوندِ referenceِ کسر (بدونِ پیشوندِ karjoo:) — پایدار، بدونِ زمان. */
    reference: text("reference").notNull(),
    status: planPurchaseStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("plan_purchases_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("plan_purchases_reference_uq").on(t.reference),
    // حداکثر یک خریدِ باز (pending/debited) به‌ازای هر کاربر — دوکلیک سریالایز می‌شود.
    uniqueIndex("plan_purchases_open_user_uq")
      .on(t.userId)
      .where(sql`status IN ('pending', 'debited')`),
  ],
);

export type PlanPurchase = typeof planPurchases.$inferSelect;
export type NewPlanPurchase = typeof planPurchases.$inferInsert;
export type PlanPurchaseStatus = (typeof planPurchaseStatusEnum.enumValues)[number];

/** مقادیرِ enumهای بیلینگ به‌صورتِ unionِ نوع‌دار (برای امضای توابعِ لایه‌ی billing). */
export type AiProvider = (typeof aiProviderEnum.enumValues)[number];
export type Plan = (typeof planEnum.enumValues)[number];
export type LedgerKind = (typeof ledgerKindEnum.enumValues)[number];
export type UsageKind = (typeof usageKindEnum.enumValues)[number];

export type AiModelCatalogRow = typeof aiModelCatalog.$inferSelect;
export type NewAiModelCatalogRow = typeof aiModelCatalog.$inferInsert;
export type UserAiSettings = typeof userAiSettings.$inferSelect;
export type NewUserAiSettings = typeof userAiSettings.$inferInsert;
export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;
export type WalletLedgerRow = typeof walletLedger.$inferSelect;
export type NewWalletLedgerRow = typeof walletLedger.$inferInsert;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type NewUsageRecord = typeof usageRecords.$inferInsert;
export type AppAiBudgetRow = typeof appAiBudget.$inferSelect;
export type NewAppAiBudgetRow = typeof appAiBudget.$inferInsert;
export type AppSettingsRow = typeof appSettings.$inferSelect;
export type NewAppSettingsRow = typeof appSettings.$inferInsert;
export type UserAutoApplyRow = typeof userAutoApply.$inferSelect;
export type NewUserAutoApplyRow = typeof userAutoApply.$inferInsert;
export type UserServerAutoApplyRow = typeof userServerAutoApply.$inferSelect;
export type NewUserServerAutoApplyRow = typeof userServerAutoApply.$inferInsert;
