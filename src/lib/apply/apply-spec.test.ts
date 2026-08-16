/**
 * تست‌های APPLY_SPEC (apply-spec.ts) — صرفاً صحتِ ساختارِ داده‌ی خالص و match با URL.
 */
import { describe, expect, it } from "vitest";

import {
  APPLY_SPEC,
  getApplySpec,
  isApplySpecReady,
  matchApplySpecByUrl,
  type ApplyBoardId,
} from "@/lib/apply/apply-spec";

const BOARDS: ApplyBoardId[] = ["jobinja", "jobvision", "e-estekhdam", "irantalent"];

describe("APPLY_SPEC — ساختار", () => {
  it("برای هر سایتِ هدف یک spec با فیلدهای الزامی دارد", () => {
    for (const board of BOARDS) {
      const spec = APPLY_SPEC[board];
      expect(spec, board).toBeDefined();
      expect(spec.board).toBe(board);
      expect(spec.applyButtonSelector.length).toBeGreaterThan(0);
      expect(spec.submitSelector.length).toBeGreaterThan(0);
      expect(spec.steps.length).toBeGreaterThan(0);
      expect(spec.urlPattern).toBeInstanceOf(RegExp);
    }
  });

  it("jobinja و e-estekhdam آماده‌اند؛ jobvision و irantalent داربست", () => {
    expect(APPLY_SPEC.jobinja.maturity).toBe("best-effort");
    expect(isApplySpecReady("jobinja")).toBe(true);
    expect(APPLY_SPEC["e-estekhdam"].maturity).toBe("best-effort");
    expect(isApplySpecReady("e-estekhdam")).toBe(true);
    for (const board of ["jobvision", "irantalent"] as const) {
      expect(APPLY_SPEC[board].maturity).toBe("scaffold");
      expect(isApplySpecReady(board)).toBe(false);
    }
  });

  it("داربست‌ها TODO(real-account) را در note/notes دارند", () => {
    for (const board of ["jobvision", "irantalent"] as const) {
      const spec = APPLY_SPEC[board];
      const blob = JSON.stringify({ steps: spec.steps, notes: spec.notes });
      expect(blob, board).toContain("TODO(real-account)");
    }
  });

  it("هر گامِ fill/select/upload یک valueKey دارد", () => {
    for (const board of BOARDS) {
      for (const step of APPLY_SPEC[board].steps) {
        if (["fill", "select", "upload"].includes(step.kind)) {
          expect(step.valueKey, `${board}:${step.kind}`).toBeDefined();
        }
      }
    }
  });
});

describe("getApplySpec / matchApplySpecByUrl", () => {
  it("سایتِ ناشناخته ⇒ undefined", () => {
    expect(getApplySpec("linkedin")).toBeUndefined();
    expect(getApplySpec("")).toBeUndefined();
  });

  it("URLِ صفحه‌ی آگهیِ jobinja با spec تطبیق می‌خورد", () => {
    const url = "https://jobinja.ir/companies/acme/jobs/tO4x/some-title";
    const spec = matchApplySpecByUrl(url);
    expect(spec?.board).toBe("jobinja");
  });

  it("URLِ jobvision با spec تطبیق می‌خورد", () => {
    const spec = matchApplySpecByUrl("https://jobvision.ir/jobs/123456");
    expect(spec?.board).toBe("jobvision");
  });

  it("URLِ نامرتبط ⇒ undefined", () => {
    expect(matchApplySpecByUrl("https://example.com/x")).toBeUndefined();
  });
});
