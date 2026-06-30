/**
 * Logger redaction tests — the §10 "session is NEVER logged" invariant.
 *
 * Even if a caller passes a session object straight into a log call, NOTHING
 * secret may reach the sink. We assert the captured output never contains cookie
 * values, tokens, or storage values, and that secret-named keys are redacted.
 */
import { describe, expect, it } from "vitest";

import { Logger, isSecretKey, redact, type LogLevel } from "./logger.js";

/** A sink that captures every emitted line. */
function captureSink() {
  const lines: string[] = [];
  return {
    lines,
    sink: { write: (_level: LogLevel, line: string) => void lines.push(line) },
  };
}

describe("isSecretKey", () => {
  it("flags secret-looking keys (case-insensitive)", () => {
    for (const k of [
      "session",
      "Session",
      "cookie",
      "cookies",
      "token",
      "authorization",
      "credential",
      "localStorage",
      "sessionStorage",
      "password",
      "value",
      "vaultKey",
    ]) {
      expect(isSecretKey(k)).toBe(true);
    }
  });

  it("does not flag safe keys", () => {
    for (const k of ["taskId", "userId", "board", "status", "finalUrl", "count", "nodeKey"]) {
      expect(isSecretKey(k)).toBe(false);
    }
  });
});

describe("redact", () => {
  it("strips secret-named keys from objects", () => {
    const out = redact({
      taskId: "t1",
      session: "SECRET-COOKIE-STRING",
      cookies: [{ name: "auth", value: "TOPSECRET" }],
      userAgent: "Mozilla/5.0",
    }) as Record<string, unknown>;
    expect(out.taskId).toBe("t1");
    expect(out.session).toBe("[redacted]");
    expect(out.cookies).toBe("[redacted]");
    // userAgent is not in the secret list (it is non-secret header parity), kept.
    expect(out.userAgent).toBe("Mozilla/5.0");
  });

  it("truncates long opaque strings", () => {
    const long = "x".repeat(500);
    const out = redact({ blob: long }) as Record<string, unknown>;
    expect(String(out.blob)).toContain("[500 chars]");
    expect(String(out.blob).length).toBeLessThan(260);
  });
});

describe("Logger never leaks a session", () => {
  it("redacts a full session bundle passed as meta", () => {
    const { lines, sink } = captureSink();
    const log = new Logger(sink, () => "2026-06-30T00:00:00.000Z");

    const session = {
      cookies: [{ name: "JOBINJA_SESSION", value: "DEADBEEF-COOKIE-VALUE" }],
      localStorage: { jwt: "HEADER.PAYLOAD.SIGNATURE-SECRET" },
      sessionStorage: { refresh: "REFRESH-TOKEN-SECRET" },
      userAgent: "Mozilla/5.0",
    };

    // A caller carelessly logs the whole session — the logger must scrub it.
    log.info("processing job", { taskId: "t1", board: "jobinja", session });

    const all = lines.join("\n");
    expect(all).not.toContain("DEADBEEF-COOKIE-VALUE");
    expect(all).not.toContain("HEADER.PAYLOAD.SIGNATURE-SECRET");
    expect(all).not.toContain("REFRESH-TOKEN-SECRET");
    expect(all).toContain("t1");
    expect(all).toContain("jobinja");
    expect(all).toContain("[redacted]");
  });
});
