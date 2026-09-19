/**
 * تست‌های جدولِ کانالِ اپلای.
 *
 * این جدول تصمیم می‌گیرد هر آگهی به کجا برود. اشتباهش بی‌صداست و گران: سایتِ
 * کنترل‌پلینی که به نودِ ورکر برود، سلکتورهای فرمی را روی سایتی می‌راند که اصلاً فرم
 * ندارد؛ و سایتِ ورکری که به کنترل‌پلین برود هیچ اجراکننده‌ای ندارد. پس جامعیت و
 * هم‌خوانیِ جدول با اجراکننده‌های واقعی این‌جا سنجیده می‌شود.
 */
import { describe, expect, it } from "vitest";

import {
  APPLY_CHANNELS,
  applyChannelOf,
  boardsForChannel,
  isHttpApplyBoard,
  isServerApplyBoard,
  isWorkerApplyBoard,
  serverApplyBoards,
} from "@/lib/apply/apply-channels";
import { isBoardApplyable } from "@/lib/apply/registry";
import type { JobBoardId } from "@/lib/apply/types";

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

describe("APPLY_CHANNELS", () => {
  it("برای هر مقدارِ یونیونِ JobBoardId دقیقاً یک کانال دارد", () => {
    expect(Object.keys(APPLY_CHANNELS).sort()).toEqual([...ALL_BOARDS].sort());
    for (const id of ALL_BOARDS) {
      expect(["worker_browser", "worker_http", "extension"]).toContain(APPLY_CHANNELS[id]);
    }
  });

  it("سایت‌های HTTP و سایت‌های DOM جدا هستند — ولی هر دو روی نود", () => {
    expect(boardsForChannel("worker_http").sort()).toEqual(
      ["e-estekhdam", "irantalent", "karboom"].sort(),
    );
    expect(boardsForChannel("worker_browser").sort()).toEqual(["jobinja", "jobvision"].sort());
  });

  it("هیچ سایتی روی کنترل‌پلین اجرا نمی‌شود — همه‌ی اپلای‌ها از IPِ نود می‌روند", () => {
    // این نکته‌ی اصلیِ کلِ این جدول است: سایت‌های پشتِ ArvanCloud از IPِ غیرِایرانی
    // پاسخ نمی‌دهند، پس هر سایتِ سرور-اجراشدنی باید به نود دیسپچ شود.
    for (const id of serverApplyBoards()) {
      expect(isWorkerApplyBoard(id), id).toBe(true);
    }
  });

  it("سایتِ HTTPی هم‌زمان سایتِ مرورگری نیست", () => {
    for (const id of ALL_BOARDS) {
      if (isHttpApplyBoard(id)) expect(applyChannelOf(id)).toBe("worker_http");
    }
  });

  it("پنج سایتِ فعال اپلایِ سمتِ سرور دارند و بقیه ندارند", () => {
    expect(serverApplyBoards().sort()).toEqual(
      ["e-estekhdam", "irantalent", "jobinja", "jobvision", "karboom"].sort(),
    );
    for (const id of ["linkedin", "divar", "quera"] as const) {
      expect(isServerApplyBoard(id), id).toBe(false);
    }
  });

  it("شناسه‌ی ناشناخته fail-closed است — سرور خودسرانه اجرا نمی‌کند", () => {
    expect(applyChannelOf("monster")).toBe("extension");
    expect(isServerApplyBoard("monster")).toBe(false);
    expect(isHttpApplyBoard("monster")).toBe(false);
    expect(isWorkerApplyBoard("monster")).toBe(false);
  });

  it("گیتِ اپلایِ رجیستری دقیقاً همین جدول را بازتاب می‌دهد", () => {
    for (const id of ALL_BOARDS) {
      expect(isBoardApplyable(id), id).toBe(isServerApplyBoard(id));
    }
  });
});
