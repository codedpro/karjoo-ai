/**
 * Redacting logger — the ONLY logging surface the worker uses.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * §10 INVARIANT (unit-tested): the decrypted session / cookies / tokens are
 * NEVER logged. The worker holds the user's OWN session in memory for one job and
 * then discards it. To make that hard to violate by accident, EVERY log line goes
 * through `redact()`, which:
 *   • drops any object key whose name looks secret (session/cookie/token/
 *     authorization/credential/localStorage/sessionStorage/value/password), and
 *   • truncates long opaque strings.
 * So even if a caller passes a session object, nothing secret reaches stdout.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * This is defense-in-depth, NOT a license to log secrets — call sites still pass
 * only non-secret descriptors. The logger is the last line of defense.
 */

/** Object keys that must never be emitted (case-insensitive, substring match). */
const SECRET_KEY_PATTERNS = [
  "session",
  "cookie",
  "token",
  "authorization",
  "credential",
  "localstorage",
  "sessionstorage",
  "password",
  "secret",
  "value", // cookie/storage values key on "value"
  "vault",
];

/** True when an object key name looks like it could carry secret material. */
export function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_KEY_PATTERNS.some((p) => k.includes(p));
}

const MAX_STRING = 200;

/**
 * Recursively redact a value for logging: strip secret-looking keys, truncate long
 * strings, and bound recursion depth so a hostile/large object can't blow the log.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limited]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[${value.length} chars]` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = redact(v, depth + 1);
    }
    return out;
  }

  return "[unloggable]";
}

/** Log levels. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** A minimal sink (defaults to console; injectable for tests). */
export interface LogSink {
  write(level: LogLevel, line: string): void;
}

const consoleSink: LogSink = {
  write(level, line) {
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  },
};

/** A tiny structured logger that redacts every payload before emitting it. */
export class Logger {
  constructor(
    private readonly sink: LogSink = consoleSink,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  private emit(level: LogLevel, msg: string, meta?: unknown): void {
    const safeMeta = meta === undefined ? "" : ` ${JSON.stringify(redact(meta))}`;
    this.sink.write(level, `${this.nowIso()} [${level}] ${msg}${safeMeta}`);
  }

  debug(msg: string, meta?: unknown): void {
    this.emit("debug", msg, meta);
  }
  info(msg: string, meta?: unknown): void {
    this.emit("info", msg, meta);
  }
  warn(msg: string, meta?: unknown): void {
    this.emit("warn", msg, meta);
  }
  error(msg: string, meta?: unknown): void {
    this.emit("error", msg, meta);
  }
}

/** The default process-wide logger. */
export const logger = new Logger();
