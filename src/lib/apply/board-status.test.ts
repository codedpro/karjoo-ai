/**
 * تست‌های گیتِ زنده‌بودنِ سایت‌ها (registry.ts) — تنها منبعِ حقیقتِ اتصال.
 *
 * این‌ها منطقِ خالص‌اند (بدون DB/شبکه): فقط جدولِ وضعیت و کمک‌کننده‌ها را می‌سنجند.
 */
import { describe, expect, it } from "vitest";

import { BOARD_STATUS, isBoardLive, liveBoardIds } from "@/lib/apply/registry";
import type { JobBoardId } from "@/lib/apply/types";

// همه‌ی مقادیرِ یونیونِ JobBoardId (types.ts:74-80) — منبعِ حقیقتِ کلیدها.
const ALL_BOARDS: JobBoardId[] = [
  "jobvision",
  "jobinja",
  "e-estekhdam",
  "irantalent",
  "karboom",
  "linkedin",
];

describe("BOARD_STATUS — جامعیت روی JobBoardId", () => {
  it("برای هر مقدارِ یونیونِ JobBoardId دقیقاً یک وضعیت دارد", () => {
    // بدونِ کلیدِ اضافه/گم‌شده — جدول باید کلِ یونیون را بپوشاند.
    expect(Object.keys(BOARD_STATUS).sort()).toEqual([...ALL_BOARDS].sort());
    for (const id of ALL_BOARDS) {
      expect(["live", "coming_soon"]).toContain(BOARD_STATUS[id]);
    }
  });

  it("فقط جابینجا live است؛ بقیه coming_soon (داربست)", () => {
    expect(BOARD_STATUS.jobinja).toBe("live");
    for (const id of ALL_BOARDS.filter((b) => b !== "jobinja")) {
      expect(BOARD_STATUS[id], id).toBe("coming_soon");
    }
  });
});

describe("isBoardLive", () => {
  it("فقط برای جابینجا true است", () => {
    expect(isBoardLive("jobinja")).toBe(true);
  });

  it("برای داربست‌ها false است", () => {
    for (const id of ["jobvision", "e-estekhdam", "irantalent", "karboom", "linkedin"]) {
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
