/**
 * تست‌های اپلایِ سمتِ سرورِ ای‌استخدام — همان تضمین‌های آداپتورِ افزونه، بدونِ مرورگر:
 *   • عنوانِ شغلیِ مبهم = توقف، نه حدس.
 *   • همیشه رزومه‌ی اختصاصیِ همان آگهی می‌رود؛ هرگز رزومه‌ی دیگری جایگزین نمی‌شود.
 *   • سقفِ فایلِ حساب → پاک‌سازی و **یک** تلاشِ دوباره، با راستی‌آزماییِ حذف.
 *   • کپچا = توقفِ صریح، نه دور زدن.
 */
import { describe, expect, it, vi } from "vitest";

import {
  applyToEEstekhdam,
  choosePosition,
  discoverFileDeleteActions,
  failureDetail,
  isFileLimitRefusal,
  uuidFromUrl,
} from "@/lib/apply/boards/eestekhdam-apply";

const SESSION = JSON.stringify({
  cookies: [{ name: "ee_session", value: "SECRET", domain: ".e-estekhdam.com" }],
  userAgent: "test-ua",
});
const JOB_URL = "https://www.e-estekhdam.com/kab12x-barnamenevis-back-end";

function input(overrides: Partial<Parameters<typeof applyToEEstekhdam>[0]> = {}) {
  return {
    session: SESSION,
    jobUrl: JOB_URL,
    jobTitle: "برنامه‌نویس بک‌اند",
    resumePdf: new Uint8Array([1, 2, 3]),
    resumeFileName: "Ali Karimi_Acme.pdf",
    coverLetter: "سلام",
    ...overrides,
  };
}

interface StubOptions {
  positions?: unknown[];
  ats?: boolean;
  sessionBody?: unknown;
  /** پاسخ‌های پیاپیِ endpointِ اپلای (اولی، دومی پس از پاک‌سازی…). */
  applyResponses?: Array<{ status: number; body: unknown }>;
  /** فایل‌های ذخیره‌شده‌ی حساب؛ پس از حذفِ موفق از این فهرست کم می‌شوند. */
  storedFiles?: string[];
  managerHtml?: string;
  /** حذف را عمداً بی‌اثر کن (برای مسیرِ شکستِ پاک‌سازی). */
  deleteWorks?: boolean;
}

function stub(options: StubOptions = {}) {
  const applyResponses = options.applyResponses ?? [{ status: 200, body: { ok: true } }];
  const stored = new Set(options.storedFiles ?? []);
  const calls: { url: string; method: string; body?: unknown }[] = [];
  let applyIndex = 0;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url: href, method, body: init?.body });

    if (href.includes("/search-api/auth/session")) {
      return json(options.sessionBody ?? { data: { user: { email: "a@b.com" } } });
    }
    if (href.includes("/search-api/jobs/k")) {
      return json({ data: { id: 5511, ats: options.ats ?? true } });
    }
    if (href.includes("/search-api/ats/positions/")) {
      return json({ data: options.positions ?? [{ id: 77, title: "برنامه‌نویس بک‌اند" }] });
    }
    if (href.includes("/search-api/ats/cvs")) {
      return json({ data: { files: [...stored].map((id) => ({ id })), cvs: [] } });
    }
    if (href.includes("/panel/files")) {
      if (method === "GET") {
        return new Response(
          options.managerHtml ??
            `<html><body><form action="/panel/files/delete" method="POST">
               <input type="hidden" name="_token" value="TOK">
               <input type="hidden" name="id" value="${[...stored][0] ?? ""}">
               <input type="submit" name="do" value="حذف">
             </form></body></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      if (options.deleteWorks !== false) {
        const body = String(init?.body ?? "");
        for (const id of [...stored]) if (body.includes(id)) stored.delete(id);
      }
      return new Response("ok", { status: 200 });
    }
    if (href.includes("/search-api/ats/applicants/apply/")) {
      const next = applyResponses[Math.min(applyIndex, applyResponses.length - 1)]!;
      applyIndex += 1;
      return json(next.body, next.status);
    }
    return json({}, 404);
  }) as unknown as typeof fetch;

  return { fetchImpl, calls, stored };
}

describe("توابعِ خالص", () => {
  it("شناسه‌ی آگهی را از نشانی می‌خواند", () => {
    expect(uuidFromUrl(JOB_URL)).toBe("ab12x");
    expect(uuidFromUrl("https://www.e-estekhdam.com/about")).toBeNull();
  });

  it("failureDetail ایمیل را پاک و خطاهای فیلدی را ضمیمه می‌کند", () => {
    const detail = failureDetail(400, {
      message: "تماس با a@b.com",
      errors: { file: ["خطا در زمان ذخیره فایل"] },
    });
    expect(detail).toContain("400");
    expect(detail).toContain("[email]");
    expect(detail).not.toContain("a@b.com");
    expect(isFileLimitRefusal(detail)).toBe(true);
  });

  it("عنوانِ مبهم را حدس نمی‌زند", () => {
    const ambiguous = choosePosition(
      [
        { id: 1, title: "کارشناس فروش" },
        { id: 2, title: "کارشناس بازاریابی" },
      ],
      "توسعه‌دهنده",
    );
    expect(ambiguous.outcome?.reason).toBe("eestekhdam_position_required");
    expect(ambiguous.position).toBeUndefined();
  });

  it("عنوانِ اپلای‌شده را already-applied می‌شمارد", () => {
    const chosen = choosePosition([{ id: 1, title: "برنامه‌نویس", applied: true }], "برنامه‌نویس");
    expect(chosen.outcome).toMatchObject({ status: "submitted", reason: "already_applied_on_board" });
  });

  it("ناسازگاریِ جنسیت را جدا گزارش می‌کند", () => {
    const chosen = choosePosition([{ id: 1, title: "x", invalidType: "gender" }], "x");
    expect(chosen.outcome?.reason).toBe("eestekhdam_gender_mismatch");
  });

  it("کنترلِ حذف را فقط وقتی می‌پذیرد که شناسه‌ی همان فایل در آن باشد", () => {
    const html = `
      <form action="/panel/files/delete" method="POST">
        <input type="hidden" name="id" value="F1"><input type="submit" value="حذف">
      </form>
      <form action="/panel/files/delete" method="POST">
        <input type="hidden" name="id" value="F2"><input type="submit" value="حذف">
      </form>`;
    const actions = discoverFileDeleteActions(html, "F1");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.body?.get("id")).toBe("F1");
  });

  it("کنترلی که به دامنه‌ی دیگری اشاره کند رد می‌شود", () => {
    const html = `<a href="https://evil.example/delete?id=F1">حذف</a>`;
    expect(discoverFileDeleteActions(html, "F1")).toHaveLength(0);
  });
});

describe("اپلای", () => {
  it("مسیرِ موفق: فایل و فیلدهای لازم را می‌فرستد", async () => {
    const { fetchImpl, calls } = stub();
    const outcome = await applyToEEstekhdam(input(), { fetchImpl });
    expect(outcome.status).toBe("submitted");
    expect(outcome.proof).toEqual({ provider: "e-estekhdam", signal: "apply_api_accepted" });

    const applyCall = calls.find((call) => call.url.includes("/applicants/apply/"));
    const form = applyCall!.body as FormData;
    expect(form.get("jobId")).toBe("5511");
    expect(form.get("workId")).toBe("77");
    expect(form.get("email")).toBe("a@b.com");
    expect(form.get("description")).toBe("سلام");
    expect((form.get("file") as File).name).toBe("Ali Karimi_Acme.pdf");
  });

  it("آگهیِ بدونِ ATS اصلاً اپلای نمی‌شود (فرمِ بیرونی)", async () => {
    const { fetchImpl } = stub({ ats: false });
    const outcome = await applyToEEstekhdam(input(), { fetchImpl });
    expect(outcome).toMatchObject({ status: "skipped", reason: "eestekhdam_external_apply_only" });
  });

  it("نشستِ رد‌شده = login_required", async () => {
    const { fetchImpl } = stub({ sessionBody: {} });
    const outcome = await applyToEEstekhdam(input(), { fetchImpl });
    expect(outcome).toMatchObject({ status: "failed", reason: "eestekhdam_login_required" });
  });

  it("کپچا دور زده نمی‌شود — و با «نشست منقضی» اشتباه گرفته نمی‌شود", async () => {
    // صفحه‌ی تأییدِ امنیتی خودش ۴۰۳ می‌دهد؛ گزارشِ «دوباره وصل شو» کاربر را دنبالِ
    // نخودسیاه می‌فرستاد، چون نشستش سالم است و فقط باید کپچا را رد کند.
    const { fetchImpl } = stub({
      applyResponses: [{ status: 403, body: { message: "بررسی امنیتی mosparo" } }],
    });
    const outcome = await applyToEEstekhdam(input(), { fetchImpl });
    expect(outcome).toMatchObject({ status: "failed", reason: "eestekhdam_captcha_required" });
  });

  it("سقفِ فایل: پاک‌سازی، سپس یک تلاشِ دوباره با همان PDF", async () => {
    const { fetchImpl, calls, stored } = stub({
      storedFiles: ["F1"],
      applyResponses: [
        { status: 400, body: { message: "خطا در زمان ذخیره فایل" } },
        { status: 200, body: { ok: true } },
      ],
    });
    const outcome = await applyToEEstekhdam(input(), { fetchImpl });
    expect(outcome.status).toBe("submitted");
    expect(outcome.ranSteps).toContain("cleanup_files");
    expect(stored.size).toBe(0);

    // هر دو تلاش باید همان رزومه‌ی اختصاصی را برده باشند — نه رزومه‌ی دیگری.
    const applyCalls = calls.filter((call) => call.url.includes("/applicants/apply/"));
    expect(applyCalls).toHaveLength(2);
    for (const call of applyCalls) {
      expect(((call.body as FormData).get("file") as File).name).toBe("Ali Karimi_Acme.pdf");
    }
  });

  it("پاک‌سازیِ ناموفق = شکستِ صریح، نه ارسالِ رزومه‌ی دیگر", async () => {
    const { fetchImpl, calls } = stub({
      storedFiles: ["F1"],
      deleteWorks: false,
      applyResponses: [{ status: 400, body: { message: "خطا در زمان ذخیره فایل" } }],
    });
    const outcome = await applyToEEstekhdam(input(), { fetchImpl });
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toContain("eestekhdam_file_limit_reached");
    // فقط یک تلاشِ ارسال — بدونِ پاک‌سازیِ موفق دوباره نمی‌فرستیم.
    expect(calls.filter((call) => call.url.includes("/applicants/apply/"))).toHaveLength(1);
  });

  it("«قبلاً درخواست داده‌اید» از پیامِ سایت = submitted", async () => {
    const { fetchImpl } = stub({
      applyResponses: [{ status: 400, body: { message: "شما قبلا برای این آگهی رزومه ارسال کرده‌اید" } }],
    });
    const outcome = await applyToEEstekhdam(input(), { fetchImpl });
    expect(outcome).toMatchObject({ status: "submitted", reason: "already_applied_on_board" });
  });

  it("نشستِ بدونِ کوکی اصلاً شبکه را لمس نمی‌کند", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const outcome = await applyToEEstekhdam(
      input({ session: JSON.stringify({ localStorage: { a: "b" } }) }),
      { fetchImpl },
    );
    expect(outcome).toMatchObject({ status: "failed", reason: "eestekhdam_login_required" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
