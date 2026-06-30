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
import {
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

/** کانال اجرای اپلای: افزونه‌ی مرورگر کاربر (استاندارد) یا نود کارگر ایرانی (پریمیوم). */
export const applyChannelEnum = pgEnum("apply_channel", ["extension", "worker"]);

/** وضعیت یک ردیف صف (Task). */
export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "leased", // توسط یک مصرف‌کننده قفل شده (FOR UPDATE SKIP LOCKED)
  "succeeded",
  "failed",
  "dead", // بیش از حد تلاش، رهاشده
]);

/** سلامت یک نود کارگر. */
export const workerHealthEnum = pgEnum("worker_health", [
  "online",
  "degraded",
  "offline",
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
]);

/** هدفِ یک کد OTP — ورود/ثبت‌نام یا اتصال یک حساب سایت کاریابی. */
export const otpPurposeEnum = pgEnum("otp_purpose", [
  "login", // ورود/ثبت‌نام با شماره موبایل
  "connect_board", // تأیید برای اتصال یک حساب سایت کاریابی (در صورت نیاز)
]);

/** نوعِ یک نشستِ احرازهویت: وب (داشبورد) یا افزونه‌ی مرورگر. */
export const authSessionKindEnum = pgEnum("auth_session_kind", ["web", "extension"]);

/** وضعیتِ یک هندآف اتصال دستگاه (SSO افزونه — بدون OTP دوم). */
export const deviceLinkStatusEnum = pgEnum("device_link_status", [
  "pending", // کد جفت‌سازی ساخته شده، هنوز مصرف نشده
  "linked", // افزونه با موفقیت جفت شد و نشست گرفت
  "expired", // منقضی/باطل‌شده
]);

/* ───────────────────────────────  Tables  ──────────────────────────────── */

/** کاربر — احراز هویت با OTP پیامکی (شماره موبایل ایران). */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(), // E.164، مثلاً +98912...
    fullName: text("full_name"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_phone_uq").on(t.phone)],
);

/* ───────────────────────────  Auth (احراز هویت)  ───────────────────────── */

/**
 * کدهای یک‌بارمصرفِ OTP (احراز هویت با شماره موبایل).
 *
 * قاعده‌ی ایمنی: هرگز کدِ خام ذخیره نمی‌شود — فقط hash آن (با pepper سرور). جدول
 * بر اساس شماره می‌تواند چند ردیفِ تاریخی داشته باشد؛ ردیفِ مصرف‌شده با consumedAt
 * علامت می‌خورد و دیگر معتبر نیست. attempts برای محدودسازی حدس متوالی است.
 */
export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(), // E.164 — همان قالبِ users.phone
    /** هشِ کدِ OTP (sha256 با pepper سرور) — هرگز متنِ خام. */
    codeHash: text("code_hash").notNull(),
    purpose: otpPurposeEnum("purpose").notNull().default("login"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** زمانِ مصرف موفق — پس از آن کد دیگر معتبر نیست (یک‌بارمصرف). */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    /** تعدادِ تلاشِ ناموفقِ راستی‌آزمایی روی این کد (برای سقف حدس). */
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("otp_codes_phone_idx").on(t.phone),
    index("otp_codes_expires_idx").on(t.expiresAt),
  ],
);

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

/** پروفایل کارجوی کاربر — معادل CandidateProfile. ترجیحات به‌صورت jsonb. */
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
    /** JobPreferences از types.ts (titles, cities, minSalary, employmentTypes). */
    preferences: jsonb("preferences").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("candidate_profiles_user_idx").on(t.userId)],
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

/** نود کارگر ایرانی — بی‌حالت و فناپذیر؛ فقط متادیتا/سلامت اینجاست. */
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
    lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("worker_nodes_key_uq").on(t.nodeKey),
    index("worker_nodes_health_idx").on(t.health),
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

/* ─────────────────────  Inferred types (برای پایین‌دست)  ────────────────── */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type OtpCode = typeof otpCodes.$inferSelect;
export type NewOtpCode = typeof otpCodes.$inferInsert;
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
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
