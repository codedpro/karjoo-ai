/**
 * تست‌های توزیعِ امنِ کار (dispatch.ts) — با همه‌ی وابستگی‌ها تزریقی (بدونِ DB/رمز).
 *
 * تمرکز بر مرزِ امنیت (قاعده‌ی ۳):
 *   • نود فقط برای کاربرانِ تخصیص‌یافته به همان نود کار می‌گیرد.
 *   • کاربری که گیتِ اپلای خودکارش رد شود، بی‌سروصدا رد می‌شود (نودِ بقیه بلاک نمی‌شود).
 *   • فقط آیتم‌های بالای آستانه claim می‌شوند (minScore به claimItems پاس می‌شود).
 *   • نشست در سمتِ سرور رمزگشایی و فقط برای همان (کاربر، board) لود می‌شود؛ آیتمِ بدونِ
 *     نشست رد می‌شود.
 *   • recordFleetResult فقط با تعلقِ task ادامه می‌دهد؛ channel='worker' و ممیزی می‌نویسد.
 */
import { describe, expect, it, vi } from "vitest";

import {
  claimFleetJobs,
  recordFleetResult,
  type ClaimFleetDeps,
} from "@/lib/fleet/dispatch";
import type {
  ClaimedApplyItem,
  RecordResultOutput,
} from "@/lib/apply/extension-queue";
import type { ApplicationRow } from "@/db/schema";
import {
  ServerAutoApplyNotAllowedError,
  type AutoApplyAuditInput,
} from "@/lib/apply/auto-apply";

/** mockِ ممیزی با امضای صریح تا calls[0][0] نوعِ AutoApplyAuditInput بگیرد. */
function makeAuditMock() {
  const impl: (input: AutoApplyAuditInput) => Promise<void> = async () => undefined;
  return vi.fn(impl);
}

/** یک ApplicationRow کاملِ تستی می‌سازد (همه‌ی فیلدهای لازمِ نوع). */
function appRow(over: Partial<ApplicationRow> = {}): ApplicationRow {
  const now = new Date();
  return {
    id: "app1",
    userId: "u1",
    matchId: "m1",
    listingId: "l1",
    resumeId: null,
    status: "submitted",
    channel: "extension",
    matchScore: 0.9,
    coverLetter: null,
    reason: null,
    externalRef: null,
    proof: null,
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

/** نتیجه‌ی کاملِ recordResult برای تزریق به‌جای extension-queue.recordResult. */
function recordOutput(over: Partial<ApplicationRow> = {}): RecordResultOutput {
  return { application: appRow(over), taskStatus: "succeeded" };
}

function item(over: Partial<ClaimedApplyItem> = {}): ClaimedApplyItem {
  return {
    taskId: "t1",
    matchId: "m1",
    listingId: "l1",
    board: "jobinja",
    coverLetter: "سلام",
    matchScore: 0.9,
    listing: {
      title: "توسعه‌دهنده",
      company: "شرکت",
      city: "تهران",
      url: "https://jobinja.ir/jobs/abc",
    },
    ...over,
  };
}

describe("claimFleetJobs — مرزِ امنیتِ تخصیص + گیت + نشست", () => {
  it("نودِ بدونِ کاربرِ تخصیص‌یافته ⇒ هیچ کاری", async () => {
    const deps: ClaimFleetDeps = {
      readAssignedUserIds: async () => [],
      readPlan: async () => "max",
      assertAllowed: async () => ({ minScore: 0.7 }),
      claimItems: async () => [item()],
      loadSession: async () => "SESSION",
    };
    expect(await claimFleetJobs("n1", 5, deps)).toEqual([]);
  });

  it("کاربری که گیتش رد می‌شود بی‌سروصدا رد می‌شود (claim برایش صدا نمی‌خورد)", async () => {
    const claimItems = vi.fn(async () => [item()]);
    const deps: ClaimFleetDeps = {
      readAssignedUserIds: async () => ["uBlocked", "uOk"],
      readPlan: async () => "max",
      assertAllowed: async (userId) => {
        if (userId === "uBlocked") {
          // گیتِ سطحِ سرور: تاگلِ سرور خاموش/پلنِ بی‌ورکر → این کاربر بی‌سروصدا رد می‌شود.
          throw new ServerAutoApplyNotAllowedError({ code: "disabled" });
        }
        return { minScore: 0.8 };
      },
      claimItems,
      loadSession: async () => "SESSION-uOk",
    };

    const jobs = await claimFleetJobs("n1", 5, deps);
    // فقط uOk کار گرفت.
    expect(jobs).toHaveLength(1);
    expect(jobs[0].userId).toBe("uOk");
    expect(jobs[0].session).toBe("SESSION-uOk");
    // claim فقط برای uOk صدا خورد، نه uBlocked.
    expect(claimItems).toHaveBeenCalledTimes(1);
    expect(claimItems).toHaveBeenCalledWith("uOk", 5, 0.8);
  });

  it("آستانه‌ی مؤثر به claimItems پاس می‌شود (فقط بالای آستانه)", async () => {
    const claimItems = vi.fn(async () => [item()]);
    const deps: ClaimFleetDeps = {
      readAssignedUserIds: async () => ["u1"],
      readPlan: async () => "maxplus",
      assertAllowed: async () => ({ minScore: 0.75 }),
      claimItems,
      loadSession: async () => "S",
    };
    await claimFleetJobs("n1", 3, deps);
    expect(claimItems).toHaveBeenCalledWith("u1", 3, 0.75);
  });

  it("نشستِ همان (کاربر، board) لود می‌شود؛ آیتمِ بدونِ نشست رد می‌شود", async () => {
    const loadSession = vi.fn(async (_userId: string, board: string) =>
      board === "jobinja" ? "COOKIES" : null,
    );
    const deps: ClaimFleetDeps = {
      readAssignedUserIds: async () => ["u1"],
      readPlan: async () => "max",
      assertAllowed: async () => ({ minScore: 0.7 }),
      claimItems: async () => [
        item({ taskId: "tA", board: "jobinja" }),
        item({ taskId: "tB", board: "jobvision" }), // نشست ندارد → رد.
      ],
      loadSession,
    };

    const jobs = await claimFleetJobs("n1", 5, deps);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].taskId).toBe("tA");
    expect(jobs[0].session).toBe("COOKIES");
    expect(loadSession).toHaveBeenCalledWith("u1", "jobinja");
  });

  it("نبودِ پلنِ کاربر ⇒ آن کاربر رد می‌شود (گیت اصلاً صدا نمی‌خورد)", async () => {
    const assertAllowed = vi.fn(async () => ({ minScore: 0.7 }));
    const deps: ClaimFleetDeps = {
      readAssignedUserIds: async () => ["uGhost"],
      readPlan: async () => null,
      assertAllowed,
      claimItems: async () => [item()],
      loadSession: async () => "S",
    };
    expect(await claimFleetJobs("n1", 5, deps)).toEqual([]);
    expect(assertAllowed).not.toHaveBeenCalled();
  });

  it("limit کلِ کارها را بین کاربران محدود می‌کند", async () => {
    const deps: ClaimFleetDeps = {
      readAssignedUserIds: async () => ["u1", "u2"],
      readPlan: async () => "maxplus",
      assertAllowed: async () => ({ minScore: 0.7 }),
      // هر کاربر می‌تواند ۱ آیتم بدهد؛ ولی limit کل = ۱.
      claimItems: async (userId, lim) => (lim > 0 ? [item({ taskId: `t-${userId}` })] : []),
      loadSession: async () => "S",
    };
    const jobs = await claimFleetJobs("n1", 1, deps);
    expect(jobs).toHaveLength(1); // فقط ۱ کار، نه ۲.
  });

  it("limit صفر ⇒ هیچ کاری و بدونِ خواندنِ تخصیص", async () => {
    const readAssignedUserIds = vi.fn(async () => ["u1"]);
    const jobs = await claimFleetJobs("n1", 0, { readAssignedUserIds });
    expect(jobs).toEqual([]);
    expect(readAssignedUserIds).not.toHaveBeenCalled();
  });
});

describe("recordFleetResult — channel=worker + ممیزی", () => {
  function makeDbWithUpdate(): {
    db: unknown;
    updateSet: ReturnType<typeof vi.fn>;
  } {
    const updateSet = vi.fn().mockReturnValue({ where: async () => undefined });
    const db = { update: () => ({ set: updateSet }) };
    return { db, updateSet };
  }

  it("task متعلق به کاربر ⇒ نتیجه ثبت، channel='worker'، ممیزیِ worker", async () => {
    const { db, updateSet } = makeDbWithUpdate();
    const recordResultFn = vi.fn(async () => recordOutput({ channel: "extension" }));
    const auditFn = makeAuditMock();

    const out = await recordFleetResult(
      "node-1",
      { taskId: "t1", userId: "u1", status: "submitted", externalRef: "REF-9" },
      { db: db as never, recordResultFn, auditFn },
    );

    // نتیجه با همان userId ثبت شد (مقید به کاربر).
    expect(recordResultFn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t1", userId: "u1", status: "submitted" }),
      db,
    );
    // channel به worker اصلاح شد.
    expect(updateSet).toHaveBeenCalledWith({ channel: "worker" });
    // ممیزیِ اپلای خودکار با channel=worker و nodeId.
    expect(auditFn).toHaveBeenCalledTimes(1);
    const auditArg = auditFn.mock.calls[0][0] as {
      userId: string;
      eventType: string;
      metadata: Record<string, unknown>;
    };
    expect(auditArg.userId).toBe("u1");
    expect(auditArg.eventType).toBe("auto_apply_attempted");
    expect(auditArg.metadata.channel).toBe("worker");
    expect(auditArg.metadata.nodeId).toBe("node-1");
    // خروجی channel='worker'.
    expect(out?.application.channel).toBe("worker");
  });

  it("task متعلق به کاربر نیست ⇒ null، بدونِ ممیزی و بدونِ اصلاحِ channel", async () => {
    const { db, updateSet } = makeDbWithUpdate();
    const recordResultFn = vi.fn(async () => null); // عدمِ تعلق.
    const auditFn = makeAuditMock();

    const out = await recordFleetResult(
      "node-1",
      { taskId: "t1", userId: "u1", status: "submitted" },
      { db: db as never, recordResultFn, auditFn },
    );
    expect(out).toBeNull();
    expect(updateSet).not.toHaveBeenCalled();
    expect(auditFn).not.toHaveBeenCalled();
  });

  it("ممیزی هرگز نشست/راز را در متادیتا نمی‌نویسد", async () => {
    const { db } = makeDbWithUpdate();
    const recordResultFn = vi.fn(async () => recordOutput({ channel: "extension" }));
    const auditFn = makeAuditMock();
    await recordFleetResult(
      "node-1",
      { taskId: "t1", userId: "u1", status: "submitted", externalRef: "REF" },
      { db: db as never, recordResultFn, auditFn },
    );
    const meta = JSON.stringify(auditFn.mock.calls[0][0]);
    expect(meta).not.toMatch(/session|cookie|token|vault/i);
  });
});
