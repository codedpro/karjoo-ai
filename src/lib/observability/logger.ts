import "server-only";

/**
 * لاگرِ ساخت‌یافته‌ی سرور — کارجو (karjoo). Push به Loki (هاب مشاهده‌پذیری).
 *
 * قرارداد (contract):
 *   • فقط سرور (server-only) — هرگز به باندلِ کلاینت نشت نمی‌کند.
 *   • هرگز throw نمی‌کند و هرگز درخواست را بلاک نمی‌کند: ارسال «fire-and-forget»
 *     با تایم‌اوتِ کوتاه است و همه‌ی خطاها بلعیده می‌شوند (نهایتاً به console).
 *   • بچِ درون‌حافظه‌ای کوچک که روی interval و روی `beforeExit`/سیگنال‌ها flush می‌شود.
 *   • به console هم mirror می‌کند تا حتی اگر Loki در دسترس نبود، لاگ گم نشود.
 *   • API: logger.info/warn/error(msg, fields?).
 *
 * مدلِ Loki push:
 *   POST {LOKI_PUSH_URL}
 *   Header: X-Scope-OrgID: {OBS_TENANT}                (multi-tenant Loki)
 *   Body:   { streams: [ { stream: {service, level, env}, values: [[ns, line]] } ] }
 *   هر خط، JSONِ فشرده‌ی { msg, ...fields, ts } است؛ لِیبل‌ها low-cardinality می‌مانند
 *   (service/level/env) تا سری‌های Loki منفجر نشوند.
 *
 * پیکربندی از process.env (رازها در .env.local؛ اینجا hardcode نمی‌شود):
 *   LOKI_PUSH_URL، OBS_TENANT، OBS_SERVICE_NAME، SENTRY_ENVIRONMENT/NODE_ENV (env label).
 */

type LogLevel = "info" | "warn" | "error";

/** فیلدهای ساخت‌یافته‌ی اختیاری برای هر خط لاگ (باید serializable باشند). */
export type LogFields = Record<string, unknown>;

interface BufferedLine {
  level: LogLevel;
  /** timestamp به نانوثانیه (رشته) — فرمتِ موردِ انتظارِ Loki. */
  tsNs: string;
  /** خطِ لاگِ سریال‌شده (JSON فشرده). */
  line: string;
}

/* ─────────────────────────────  پیکربندی  ───────────────────────────────── */

const LOKI_PUSH_URL = process.env.LOKI_PUSH_URL;
const OBS_TENANT = process.env.OBS_TENANT || "karjoo";
const SERVICE = process.env.OBS_SERVICE_NAME || "karjoo-app";
const ENV = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production";

/** اندازه‌ی بچ که با رسیدن به آن، بلافاصله flush می‌شود. */
const MAX_BATCH = 100;
/** سقفِ صفِ درون‌حافظه‌ای؛ فراتر از آن، قدیمی‌ترین‌ها دور ریخته می‌شوند (بدون رشدِ نامحدود). */
const MAX_BUFFER = 1000;
/** فاصله‌ی flushِ دوره‌ای (میلی‌ثانیه). */
const FLUSH_INTERVAL_MS = 5000;
/** تایم‌اوتِ کوتاهِ هر POST به Loki (میلی‌ثانیه) — هرگز نباید طولانی بلاک کند. */
const PUSH_TIMEOUT_MS = 3000;

/** آیا ارسال به Loki فعال است؟ فقط وقتی URL ست شده باشد. بدونِ آن، فقط console. */
const LOKI_ENABLED = typeof LOKI_PUSH_URL === "string" && LOKI_PUSH_URL.length > 0;

/* ─────────────────────────────  حالتِ ماژول  ────────────────────────────── */

const buffer: BufferedLine[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let lifecycleHooksInstalled = false;

/** timestampِ نانوثانیه‌ی یکتا و صعودی (Loki خطوطِ هم‌زمان را رد می‌کند). */
// از سازنده‌ی BigInt استفاده می‌کنیم (نه literalِ `n`) تا با هدفِ ES2017 tsconfig سازگار بماند.
const NS_PER_MS = BigInt(1_000_000);
const ONE = BigInt(1);
let lastNs = BigInt(0);
function nowNs(): string {
  let ns = BigInt(Date.now()) * NS_PER_MS;
  if (ns <= lastNs) ns = lastNs + ONE;
  lastNs = ns;
  return ns.toString();
}

/* ─────────────────────────────  ارسال به Loki  ──────────────────────────── */

/**
 * ساختِ payloadِ Loki از یک بچ. خطوطِ هم‌سطح در یک stream گروه می‌شوند تا لِیبل‌ها
 * low-cardinality بمانند (فقط service/level/env). Loki `values` را per-stream
 * می‌خواهد؛ ترتیبِ زمانی درون هر stream باید صعودی باشد (nowNs آن را تضمین می‌کند).
 */
function buildPayload(lines: BufferedLine[]): string {
  const byLevel = new Map<LogLevel, Array<[string, string]>>();
  for (const l of lines) {
    let arr = byLevel.get(l.level);
    if (!arr) {
      arr = [];
      byLevel.set(l.level, arr);
    }
    arr.push([l.tsNs, l.line]);
  }
  const streams = [...byLevel.entries()].map(([level, values]) => ({
    stream: { service: SERVICE, level, env: ENV },
    values,
  }));
  return JSON.stringify({ streams });
}

/**
 * POSTِ یک بچ به Loki. هرگز throw نمی‌کند. تایم‌اوتِ کوتاه دارد. در صورتِ شکست،
 * فقط یک هشدارِ خلاصه به console می‌زند (بدونِ نشتِ محتوا) و رد می‌شود — لاگِ اصلی
 * از قبل به console mirror شده، پس چیزی گم نمی‌شود.
 */
async function pushToLoki(lines: BufferedLine[]): Promise<void> {
  if (!LOKI_ENABLED || lines.length === 0) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const res = await fetch(LOKI_PUSH_URL as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Scope-OrgID": OBS_TENANT,
      },
      body: buildPayload(lines),
      signal: controller.signal,
      // نگذار fetch در کش/کانکشن‌پول گیر کند؛ این یک تله‌متریِ آتش‌کن‌وفراموش‌کن است.
      keepalive: true,
    });
    if (!res.ok) {
      // بدنه را نمی‌خوانیم تا بلاک نشویم؛ فقط کدِ وضعیت.
      console.warn(`[obs-logger] Loki push failed: HTTP ${res.status}`);
    }
  } catch (err) {
    // شبکه/تایم‌اوت/abort — بلعیده می‌شود؛ هرگز به مسیرِ درخواست نشت نمی‌کند.
    const reason = err instanceof Error ? err.name || err.message : "unknown";
    console.warn(`[obs-logger] Loki push error: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * تخلیه‌ی بچ. غیرمسدودکننده: بچ را برمی‌دارد و pushToLoki را بدونِ await رها می‌کند
 * (fire-and-forget). خودش هرگز throw نمی‌کند. `void` پرامیس را عمداً نادیده می‌گیرد.
 */
function flush(): void {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  void pushToLoki(batch);
}

/** تخلیه‌ی همگام‌گونه هنگامِ خروجِ فرآیند (await می‌شود تا آخرین بچ بره). */
async function flushOnExit(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  await pushToLoki(batch);
}

function ensureTimer(): void {
  if (flushTimer || !LOKI_ENABLED) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  // نگذار interval فرآیند را زنده نگه دارد (اجازه‌ی خروجِ تمیزِ اسکریپت‌ها/تست‌ها).
  if (typeof flushTimer.unref === "function") flushTimer.unref();
}

function ensureLifecycleHooks(): void {
  if (lifecycleHooksInstalled || typeof process === "undefined") return;
  lifecycleHooksInstalled = true;
  const drain = (): void => {
    void flushOnExit();
  };
  // beforeExit تنها جایی است که می‌توانیم async flush را کامل کنیم.
  process.on("beforeExit", drain);
  process.on("SIGTERM", drain);
  process.on("SIGINT", drain);
}

/* ─────────────────────────────  console mirror  ─────────────────────────── */

function mirrorToConsole(level: LogLevel, msg: string, fields?: LogFields): void {
  const payload = fields && Object.keys(fields).length > 0 ? fields : undefined;
  // یک خطِ ساخت‌یافته؛ در prod این‌ها را stdout/pod-log هم می‌گیرد.
  const prefix = `[${SERVICE}] ${msg}`;
  try {
    if (level === "error") {
      if (payload) console.error(prefix, payload);
      else console.error(prefix);
    } else if (level === "warn") {
      if (payload) console.warn(prefix, payload);
      else console.warn(prefix);
    } else {
      if (payload) console.log(prefix, payload);
      else console.log(prefix);
    }
  } catch {
    /* اگر خودِ console خطا داد، بی‌صدا رد شو — هرگز نباید throw کنیم. */
  }
}

/* ─────────────────────────────  هسته  ──────────────────────────────────── */

/**
 * تبدیلِ امنِ fields به یک آبجکتِ serializable. اگر JSON.stringify روی چرخه/BigInt/
 * Error شکست، نسخه‌ی امن می‌سازیم تا خطِ لاگ همیشه معتبر بماند (هرگز throw).
 */
function safeSerializeLine(level: LogLevel, msg: string, fields?: LogFields): string {
  const base: Record<string, unknown> = {
    msg,
    level,
    service: SERVICE,
    env: ENV,
    ts: new Date().toISOString(),
  };
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      base[k] = v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v;
    }
  }
  try {
    return JSON.stringify(base);
  } catch {
    // fallback: فیلدهای غیرقابلِ‌سریال را دور بریز، پیام را نگه دار.
    try {
      return JSON.stringify({ msg, level, service: SERVICE, env: ENV, ts: base.ts });
    } catch {
      return `{"msg":${JSON.stringify(msg)},"level":"${level}"}`;
    }
  }
}

/**
 * هسته‌ی لاگ: mirror به console + صف‌کردن برای Loki. هرگز throw نمی‌کند و هرگز
 * منتظرِ شبکه نمی‌ماند (فقط push به بافر؛ ارسالِ واقعی در background/interval).
 */
function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  // ۱) همیشه به console mirror کن (حتی اگر Loki خاموش باشد).
  mirrorToConsole(level, msg, fields);

  // ۲) اگر Loki فعال نیست، همین‌جا تمام.
  if (!LOKI_ENABLED) return;

  try {
    const line = safeSerializeLine(level, msg, fields);
    buffer.push({ level, tsNs: nowNs(), line });

    // محافظت از رشدِ نامحدودِ حافظه: قدیمی‌ترین‌ها را دور بریز.
    if (buffer.length > MAX_BUFFER) {
      buffer.splice(0, buffer.length - MAX_BUFFER);
    }

    ensureTimer();
    ensureLifecycleHooks();

    // بچِ پر ⇒ flushِ فوری (غیرمسدودکننده).
    if (buffer.length >= MAX_BATCH) {
      flush();
    }
  } catch {
    /* هیچ مسیرِ خطایی نباید به فراخواننده برسد. */
  }
}

/* ─────────────────────────────  API عمومی  ─────────────────────────────── */

export const logger = {
  info(msg: string, fields?: LogFields): void {
    emit("info", msg, fields);
  },
  warn(msg: string, fields?: LogFields): void {
    emit("warn", msg, fields);
  },
  error(msg: string, fields?: LogFields): void {
    emit("error", msg, fields);
  },
  /**
   * flushِ دستیِ فوری (اختیاری). برای مسیرهایی مثل endpointِ smoke که می‌خواهند
   * مطمئن شوند خط پیش از پاسخ به Loki رفته. `await` می‌کند اما هرگز throw نمی‌کند.
   */
  async flush(): Promise<void> {
    await flushOnExit();
  },
};

export type Logger = typeof logger;
