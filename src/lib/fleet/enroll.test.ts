/**
 * تست‌های چرخه‌ی عمرِ نود (enroll.ts) — با db/random/pepper/token تزریقی (بدونِ DB/راز).
 *
 * تمرکز: قاعده‌ی ۱ — ثبت‌نام بدونِ env بسته است (۵۰۳)؛ توکنِ نادرست رد می‌شود (طول‌ثابت)؛
 * اعتبارنامه‌ی خام فقط یک‌بار برمی‌گردد و فقط hashش ذخیره می‌شود؛ راستی‌آزمایی با hash
 * compare است؛ heartbeat فیلدهای undefined را دست‌نخورده می‌گذارد.
 */
import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";

import {
  enrollNode,
  recordHeartbeat,
  verifyNodeCredential,
  FleetEnrollmentClosedError,
  FleetEnrollmentTokenError,
  type FleetEnrollDb,
} from "@/lib/fleet/enroll";
import { hashWithPepper } from "@/lib/auth/core";

const PEPPER = "test-pepper-0123456789abcdef";
const ENROLL_TOKEN = "enrollment-secret-token-0123456789";

/** بایتِ تصادفیِ قطعی برای تست — همیشه همان بایت‌ها. */
function fixedBytes(byte: number): (size: number) => Buffer {
  return (size: number) => Buffer.alloc(size, byte);
}

/** db جعلی که insert(...).onConflictDoUpdate(...).returning() را به یک ردیف نگاشت می‌کند. */
function makeInsertDb(returnedRow: unknown): {
  db: FleetEnrollDb;
  values: ReturnType<typeof vi.fn>;
} {
  const values = vi.fn().mockReturnValue({
    onConflictDoUpdate: () => ({ returning: async () => [returnedRow] }),
  });
  const db = { insert: () => ({ values }) } as unknown as FleetEnrollDb;
  return { db, values };
}

describe("enrollNode — گاردهای قاعده‌ی ۱", () => {
  it("env تنظیم نشده ⇒ FleetEnrollmentClosedError (هیچ‌چیز نوشته نمی‌شود)", async () => {
    const { db, values } = makeInsertDb({ id: "n1" });
    const err = await enrollNode(
      ENROLL_TOKEN,
      { nodeKey: "node-a" },
      { db, pepper: PEPPER, enrollmentTokenEnv: null },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(FleetEnrollmentClosedError);
    expect(values).not.toHaveBeenCalled();
  });

  it("توکنِ نادرست ⇒ FleetEnrollmentTokenError (هیچ‌چیز نوشته نمی‌شود)", async () => {
    const { db, values } = makeInsertDb({ id: "n1" });
    const err = await enrollNode(
      "wrong-token-xxxxxxxxxxxxxxxxxxxx",
      { nodeKey: "node-a" },
      { db, pepper: PEPPER, enrollmentTokenEnv: ENROLL_TOKEN },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(FleetEnrollmentTokenError);
    expect(values).not.toHaveBeenCalled();
  });

  it("توکنِ درست ⇒ اعتبارنامه‌ی خام یک‌بار برمی‌گردد و فقط hashش ذخیره می‌شود", async () => {
    const stored = {
      id: "n1",
      nodeKey: "node-a",
      credentialHash: "PLACEHOLDER",
      health: "online",
    };
    const { db, values } = makeInsertDb(stored);

    const out = await enrollNode(
      ENROLL_TOKEN,
      { nodeKey: "node-a", ipAddress: "5.5.5.5", region: "IR", agentVersion: "1.0.0" },
      { db, pepper: PEPPER, enrollmentTokenEnv: ENROLL_TOKEN, randomBytesImpl: fixedBytes(7) },
    );

    // اعتبارنامه‌ی خام برگشت داده شد (مات، غیرخالی).
    expect(typeof out.credential).toBe("string");
    expect(out.credential.length).toBeGreaterThan(0);

    // مقداری که در DB نوشته شد، *هشِ* اعتبارنامه است نه خودِ آن.
    const written = values.mock.calls[0][0] as {
      credentialHash: string;
      enrollmentTokenHash: string;
      health: string;
      ipAddress: string;
    };
    expect(written.credentialHash).toBe(hashWithPepper(out.credential, PEPPER));
    expect(written.credentialHash).not.toBe(out.credential); // خامِ اعتبارنامه ذخیره نشد.
    expect(written.enrollmentTokenHash).toBe(hashWithPepper(ENROLL_TOKEN, PEPPER));
    expect(written.health).toBe("online");
    expect(written.ipAddress).toBe("5.5.5.5");
  });
});

describe("verifyNodeCredential — hash compare", () => {
  function makeSelectDb(row: unknown): {
    db: FleetEnrollDb;
    capturedHashFromWhere: () => unknown;
  } {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => (row ? [row] : []) }),
        }),
      }),
    } as unknown as FleetEnrollDb;
    return { db, capturedHashFromWhere: () => undefined };
  }

  it("اعتبارنامه‌ی خالی ⇒ null (بدونِ کوئری)", async () => {
    const { db } = makeSelectDb({ id: "n1" });
    expect(await verifyNodeCredential("", { db, pepper: PEPPER })).toBeNull();
  });

  it("اعتبارنامه‌ی موجود ⇒ همان نود", async () => {
    const node = { id: "n1", nodeKey: "node-a", credentialHash: "h" };
    const { db } = makeSelectDb(node);
    expect(await verifyNodeCredential("raw-cred", { db, pepper: PEPPER })).toEqual(node);
  });

  it("اعتبارنامه‌ی ناموجود ⇒ null", async () => {
    const { db } = makeSelectDb(null);
    expect(await verifyNodeCredential("raw-cred", { db, pepper: PEPPER })).toBeNull();
  });
});

describe("recordHeartbeat — به‌روزرسانیِ وضعیت", () => {
  function makeUpdateDb(returnedRow: unknown): {
    db: FleetEnrollDb;
    set: ReturnType<typeof vi.fn>;
  } {
    const set = vi.fn().mockReturnValue({
      where: () => ({ returning: async () => (returnedRow ? [returnedRow] : []) }),
    });
    const db = { update: () => ({ set }) } as unknown as FleetEnrollDb;
    return { db, set };
  }

  it("فقط فیلدهای ارائه‌شده ست می‌شوند؛ undefined دست‌نخورده", async () => {
    const { db, set } = makeUpdateDb({ id: "n1", health: "online" });
    const fixedNow = () => 1_700_000_000_000;
    await recordHeartbeat("n1", { health: "online" }, { db, now: fixedNow });

    const patch = set.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.health).toBe("online");
    expect("agentVersion" in patch).toBe(false); // ارائه نشده ⇒ ست نشد.
    expect("ipAddress" in patch).toBe(false);
    expect(patch.lastHeartbeat).toEqual(new Date(fixedNow()));
    expect(patch.lastSeenAt).toEqual(new Date(fixedNow()));
  });

  it("نودِ ناموجود ⇒ null", async () => {
    const { db } = makeUpdateDb(null);
    expect(await recordHeartbeat("missing", { health: "offline" }, { db })).toBeNull();
  });
});
