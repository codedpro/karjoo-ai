/**
 * apply-result-payload — PROVES the auto-apply result report carries no secret.
 * Mirrors the connect/import chokepoint test posture (§10 / RULE 1).
 */
import { describe, it, expect } from "vitest";
import {
  buildApplyResultReport,
  assertNoSecrets,
  SecretLeakError,
} from "@ext/lib/apply-result-payload";

describe("buildApplyResultReport — only id/status/externalRef/reason leave", () => {
  it("builds the minimal submitted report", () => {
    const r = buildApplyResultReport({ id: "task-9", status: "submitted" });
    expect(r).toEqual({ id: "task-9", status: "submitted" });
  });

  it("keeps a non-secret externalRef and reason", () => {
    const r = buildApplyResultReport({
      id: "task-9",
      status: "failed",
      externalRef: "CONF-123",
      reason: "selector not found",
    });
    expect(r).toEqual({
      id: "task-9",
      status: "failed",
      externalRef: "CONF-123",
      reason: "selector not found",
    });
  });

  it("clamps an overly long reason and trims", () => {
    const long = "x".repeat(1000);
    const r = buildApplyResultReport({ id: "t", status: "failed", reason: `  ${long}  ` });
    expect(r.reason!.length).toBe(280);
  });

  it("throws when id is missing", () => {
    expect(() => buildApplyResultReport({ id: "", status: "submitted" })).toThrow(SecretLeakError);
  });

  it("the serialized report contains NO secret keywords", () => {
    const r = buildApplyResultReport({
      id: "task-9",
      status: "submitted",
      externalRef: "CONF-1",
      reason: "ok",
    });
    const s = JSON.stringify(r).toLowerCase();
    for (const bad of ["cookie", "token", "session", "password", "jwt", "bearer", "authorization"]) {
      expect(s).not.toContain(bad);
    }
  });
});

describe("assertNoSecrets — fail-closed on credential-shaped keys", () => {
  it.each([
    { cookie: "abc" },
    { sessionToken: "x" },
    { Authorization: "Bearer y" },
    { password: "p" },
    { nested: { jwt: "z" } },
    { arr: [{ csrfToken: "c" }] },
  ])("throws on %o", (obj) => {
    expect(() => assertNoSecrets(obj)).toThrow(SecretLeakError);
  });

  it("accepts a clean object", () => {
    expect(() => assertNoSecrets({ id: "1", status: "submitted", reason: "fine" })).not.toThrow();
  });

  it("throws on nesting that is too deep (DoS guard)", () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 20; i++) deep = { child: deep };
    expect(() => assertNoSecrets(deep)).toThrow(SecretLeakError);
  });
});
