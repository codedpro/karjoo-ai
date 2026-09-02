/**
 * تست‌های گیتِ زنده‌بودنِ سایت‌ها (registry.ts) — تنها منبعِ حقیقتِ اتصال.
 *
 * این‌ها منطقِ خالص‌اند (بدون DB/شبکه): فقط جدولِ وضعیت و کمک‌کننده‌ها را می‌سنجند.
 */
import { describe, expect, it } from "vitest";

import {
  BOARD_STATUS,
  PROVIDER_CAPABILITIES,
  isBoardConnectable,
  isBoardLive,
  liveBoardIds,
  publicProviderCapabilities,
} from "@/lib/apply/registry";
import type { JobBoardId } from "@/lib/apply/types";

// همه‌ی مقادیرِ یونیونِ JobBoardId (types.ts:74-80) — منبعِ حقیقتِ کلیدها.
const ALL_BOARDS: JobBoardId[] = [
  "jobvision",
  "jobinja",
  "e-estekhdam",
  "irantalent",
  "karboom",
  "linkedin",
  "iranestekhdam",
  "divar",
  "quera",
  "remoteok",
  "weworkremotely",
  "ponisha",
  "parscoders",
  "bankestekhdam",
];
const PLANNED_BOARDS = [
  "linkedin",
  "iranestekhdam",
  "divar",
  "quera",
  "remoteok",
  "weworkremotely",
  "ponisha",
  "parscoders",
  "bankestekhdam",
] as const;

describe("BOARD_STATUS — جامعیت روی JobBoardId", () => {
  it("برای هر مقدارِ یونیونِ JobBoardId دقیقاً یک وضعیت دارد", () => {
    // بدونِ کلیدِ اضافه/گم‌شده — جدول باید کلِ یونیون را بپوشاند.
    expect(Object.keys(BOARD_STATUS).sort()).toEqual([...ALL_BOARDS].sort());
    for (const id of ALL_BOARDS) {
      expect(["live", "extension_only", "coming_soon"]).toContain(BOARD_STATUS[id]);
    }
  });

  it("جابینجا live، چهار ارائه‌دهنده‌ی فعالِ دیگر extension-only و بقیه داربست‌اند", () => {
    expect(BOARD_STATUS.jobinja).toBe("live");
    for (const id of ["jobvision", "e-estekhdam", "irantalent", "karboom"] as const) {
      expect(BOARD_STATUS[id], id).toBe("extension_only");
    }
    for (const id of PLANNED_BOARDS) {
      expect(BOARD_STATUS[id], id).toBe("coming_soon");
    }
  });
});

describe("PROVIDER_CAPABILITIES", () => {
  it("برای هر مقدار JobBoardId یک رکورد قابلیت دارد", () => {
    expect(Object.keys(PROVIDER_CAPABILITIES).sort()).toEqual([...ALL_BOARDS].sort());
  });

  it("فقط ارائه‌دهنده‌ی full-workflow را live می‌داند", () => {
    expect(PROVIDER_CAPABILITIES.jobinja.workflowState).toBe("live");
    for (const id of ["jobvision", "e-estekhdam", "irantalent"] as const) {
      expect(PROVIDER_CAPABILITIES[id].workflowState).toBe("in_progress");
    }
    for (const id of PLANNED_BOARDS) {
      expect(PROVIDER_CAPABILITIES[id].workflowState).toBe("planned");
    }
  });

  it("پروژکشن عمومی فقط providerهای قابل نمایش مارکتینگ را می‌دهد", () => {
    expect(publicProviderCapabilities().map((p) => p.id).sort()).toEqual([...ALL_BOARDS].sort());
  });
});

describe("isBoardConnectable", () => {
  it("هر چهار ارائه‌دهنده‌ی فعال قابلِ اتصال‌اند — وگرنه وضعیت هرگز connected نمی‌شود", () => {
    for (const id of ["jobinja", "jobvision", "e-estekhdam", "irantalent"] as const) {
      expect(isBoardConnectable(id), id).toBe(true);
    }
  });

  it("سایت‌های خارج از دامنه و شناسه‌ی ناشناخته قابلِ اتصال نیستند (fail-closed)", () => {
    for (const id of [...PLANNED_BOARDS, "bogus", ""]) {
      expect(isBoardConnectable(id), id).toBe(false);
    }
  });
});

describe("isBoardLive", () => {
  it("فقط برای جابینجا true است", () => {
    expect(isBoardLive("jobinja")).toBe(true);
  });

  it("برای هر سایتِ دیگر false است — extension_only یعنی سرور اجرا نمی‌کند", () => {
    for (const id of ["jobvision", "e-estekhdam", "irantalent", ...PLANNED_BOARDS]) {
      expect(isBoardLive(id), id).toBe(false);
    }
  });

  it("برای شناسه‌ی ناشناخته false است (fail-closed)", () => {
    expect(isBoardLive("bogus")).toBe(false);
    expect(isBoardLive("")).toBe(false);
    expect(isBoardLive("eestekhdam")).toBe(false); // بدونِ خط‌فاصله = نامعتبر
  });
});

describe("liveBoardIds", () => {
  it("دقیقاً [jobinja] را برمی‌گرداند", () => {
    expect(liveBoardIds()).toEqual(["jobinja"]);
  });

  it("با isBoardLive سازگار است", () => {
    for (const id of ALL_BOARDS) {
      expect(liveBoardIds().includes(id)).toBe(isBoardLive(id));
    }
  });
});
