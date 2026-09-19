/**
 * تست‌های اپلایِ سمتِ سرورِ کاربوم — همان تضمین‌هایی که آداپتورِ افزونه داشت، حالا
 * بدونِ مرورگر:
 *   • ترتیبِ مرحله‌ها را **سرور** تعیین می‌کند، نه ما.
 *   • در `select_resume` رزومه‌ی اختصاصیِ همین آگهی آپلود می‌شود و `resume`ِ حسابِ
 *     کاربر هم‌زمان فرستاده نمی‌شود.
 *   • فقط `done` یعنی «ثبت شد» — هیچ مرحله‌ی دیگری submitted تلقی نمی‌شود.
 *   • مرحله‌ای که جلو نمی‌رود (اعتبارسنجیِ رد‌شده) به‌جای حلقه‌ی بی‌پایان شکست می‌دهد.
 */
import { describe, expect, it, vi } from "vitest";

import {
  applyToKarboom,
  karboomCodeFromUrl,
  karboomJobIdFromHtml,
  looksAlreadyApplied,
} from "@/lib/apply/boards/karboom-apply";

const SESSION = JSON.stringify({
  cookies: [{ name: "karboom_session", value: "SECRET", domain: ".karboom.io" }],
  userAgent: "test-ua",
});
const JOB_URL = "https://karboom.io/jobs/AB12cd/senior-backend";
const DETAILS_HTML = `<html><head><meta name="csrf-token" content="TOK"></head>
  <body><button data-job="99123">ارسال رزومه</button></body></html>`;

interface Call {
  url: string;
  method: string;
  body?: unknown;
  headers: Record<string, string>;
}

/**
 * یک کاربومِ ساختگی که مثلِ خودِ سایت رفتار می‌کند: هر مرحله قالبِ HTML می‌دهد و هر POST
 * می‌گوید مرحله‌ی بعد چیست.
 */
function stub(options: {
  /** ترتیبِ مرحله‌ها؛ هر POST مرحله‌ی بعدی را برمی‌گرداند. */
  steps?: string[];
  /** قالبِ هر مرحله (پیش‌فرض یک فرمِ ساده). */
  templates?: Record<string, string>;
  startStatus?: number;
  startBody?: unknown;
  detailsStatus?: number;
  detailsBody?: string;
  /** مرحله‌ای که سرور دوباره همان را برمی‌گرداند (اعتبارسنجیِ رد‌شده). */
  stallAt?: string;
} = {}) {
  const steps = options.steps ?? ["job_status", "select_resume", "final"];
  const calls: Call[] = [];
  let index = -1;

  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url: href, method, body: init?.body, headers });

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (href.includes("/jobs/details/")) {
      return new Response(options.detailsBody ?? DETAILS_HTML, {
        status: options.detailsStatus ?? 200,
        headers: { "content-type": "text/html" },
      });
    }

    // شروعِ ویزارد: POST بدونِ مسیرِ مرحله.
    if (/\/jobs\/apply\/\d+$/.test(href) && method === "POST" && index === -1) {
      if (options.startStatus && options.startStatus >= 400) {
        return json(options.startBody ?? {}, options.startStatus);
      }
      if (options.startBody !== undefined) return json(options.startBody);
      index = 0;
      return json({ currentStep: steps[0] });
    }

    const current = steps[index] ?? "done";
    if (method === "GET") {
      const template =
        options.templates?.[current] ??
        (current === "select_resume"
          ? `<form><input type="hidden" name="token" value="t"><input type="hidden" name="resume" value="9"><input type="file" name="file"></form>`
          : `<form><input type="text" name="field_${current}" value="v"></form>`);
      return json({ content: template });
    }

    // POSTِ یک مرحله → مرحله‌ی بعد (یا همان مرحله، اگر stall خواسته شده).
    if (options.stallAt === current) return json({ currentStep: current });
    index += 1;
    return json({ currentStep: steps[index] ?? "done" });
  });

  return { fetchImpl: fetchMock as unknown as typeof fetch, calls };
}

function input(overrides: Partial<Parameters<typeof applyToKarboom>[0]> = {}) {
  return {
    session: SESSION,
    jobUrl: JOB_URL,
    resumePdf: new Uint8Array([1, 2, 3]),
    resumeFileName: "Ali Karimi_Acme.pdf",
    coverLetter: "سلام",
    ...overrides,
  };
}

describe("توابعِ خالص", () => {
  it("کدِ آگهی را از هر دو شکلِ نشانی می‌خواند", () => {
    expect(karboomCodeFromUrl(JOB_URL)).toBe("AB12cd");
    expect(karboomCodeFromUrl("https://karboom.io/jobs/details/AB12cd")).toBe("AB12cd");
    expect(karboomCodeFromUrl("https://karboom.io/about")).toBeNull();
  });

  it("شناسه‌ی عددی را از HTML می‌خواند", () => {
    expect(karboomJobIdFromHtml(DETAILS_HTML)).toBe("99123");
    expect(karboomJobIdFromHtml("<div></div>")).toBeNull();
  });

  it("«قبلاً درخواست داده‌اید» را می‌شناسد", () => {
    expect(looksAlreadyApplied({ message: "شما قبلا برای این آگهی درخواست داده‌اید" })).toBe(true);
    expect(looksAlreadyApplied({ message: "خطای نامشخص" })).toBe(false);
  });
});

describe("ویزاردِ اپلای", () => {
  it("مرحله‌ها را تا done دنبال می‌کند و submitted می‌دهد", async () => {
    const { fetchImpl } = stub();
    const outcome = await applyToKarboom(input(), { fetchImpl });
    expect(outcome.status).toBe("submitted");
    expect(outcome.proof).toEqual({ provider: "karboom", signal: "wizard_done" });
    expect(outcome.ranSteps).toContain("select_resume");
    expect(outcome.ranSteps.at(-1)).toBe("confirmed");
  });

  it("در select_resume فایل را می‌فرستد و `resume`ِ حساب را هم‌زمان نمی‌فرستد", async () => {
    const { fetchImpl, calls } = stub();
    await applyToKarboom(input(), { fetchImpl });

    const upload = calls.find((call) => call.method === "POST" && call.body instanceof FormData);
    expect(upload).toBeDefined();
    const form = upload!.body as FormData;
    // رزومه‌ی ذخیره‌شده‌ی حساب نباید همراه آپلودِ اختصاصی برود، وگرنه کاربوم آن را برمی‌دارد.
    expect(form.get("resume")).toBeNull();
    expect(form.get("token")).toBe("t");
    const file = form.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("Ali Karimi_Acme.pdf");
  });

  it("انگیزه‌نامه فقط وقتی می‌نشیند که خودِ فرم فیلدِ description داشته باشد", async () => {
    const { fetchImpl, calls } = stub({
      steps: ["job_status", "final"],
      templates: { job_status: `<form><textarea name="description">قبلی</textarea></form>` },
    });
    await applyToKarboom(input({ coverLetter: "متنِ من" }), { fetchImpl });
    const posted = calls.find(
      (call) => call.method === "POST" && typeof call.body === "string" && call.body.includes("description"),
    );
    // URLSearchParams فاصله را `+` می‌کند؛ پس بدنه را parse می‌کنیم نه رشته‌مقایسه.
    expect(new URLSearchParams(String(posted!.body)).get("description")).toBe("متنِ من");
  });

  it("توکنِ CSRFِ صفحه روی همه‌ی درخواست‌های ویزارد می‌رود", async () => {
    const { fetchImpl, calls } = stub();
    await applyToKarboom(input(), { fetchImpl });
    const wizardCalls = calls.filter((call) => call.url.includes("/jobs/apply/"));
    expect(wizardCalls.length).toBeGreaterThan(0);
    for (const call of wizardCalls) expect(call.headers["x-csrf-token"]).toBe("TOK");
  });

  it("کوکیِ نشستِ کاربر و UAِ خودش روی درخواست‌ها می‌رود", async () => {
    const { fetchImpl, calls } = stub();
    await applyToKarboom(input(), { fetchImpl });
    expect(calls[0]!.headers.cookie).toContain("karboom_session=SECRET");
    expect(calls[0]!.headers["user-agent"]).toBe("test-ua");
  });

  it("«قبلاً درخواست داده‌اید» در شروع = submitted (نه شکست)", async () => {
    const { fetchImpl } = stub({ startBody: { message: "شما قبلا برای این آگهی درخواست داده‌اید" } });
    const outcome = await applyToKarboom(input(), { fetchImpl });
    expect(outcome.status).toBe("submitted");
    expect(outcome.reason).toBe("already_applied_on_board");
  });

  it("۴۰۱ یعنی نشست رفته", async () => {
    const { fetchImpl } = stub({ startStatus: 401 });
    const outcome = await applyToKarboom(input(), { fetchImpl });
    expect(outcome).toMatchObject({ status: "failed", reason: "karboom_login_required" });
  });

  it("۴۲۲ در یک مرحله یعنی پروفایل ناقص است — چیزی ساخته نمی‌شود", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      calls.push(href);
      if (href.includes("/jobs/details/")) return new Response(DETAILS_HTML, { status: 200 });
      if ((init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ content: `<form><input name="a" value="1"></form>` }), { status: 200 });
      }
      if (/\/jobs\/apply\/\d+$/.test(href)) {
        return new Response(JSON.stringify({ currentStep: "personal_info" }), { status: 200 });
      }
      return new Response(JSON.stringify({ errors: { nationalCode: ["الزامی"] } }), { status: 422 });
    }) as unknown as typeof fetch;

    const outcome = await applyToKarboom(input(), { fetchImpl });
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toContain("karboom_profile_incomplete");
  });

  it("مرحله‌ای که جلو نمی‌رود شکست می‌دهد، نه حلقه‌ی بی‌پایان", async () => {
    const { fetchImpl } = stub({ steps: ["job_status", "final"], stallAt: "job_status" });
    const outcome = await applyToKarboom(input(), { fetchImpl });
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toContain("karboom_step_stalled");
  });

  it("آگهیِ بی‌شناسه skip است، نه failed (آگهی دیگر نیست)", async () => {
    const { fetchImpl } = stub({ detailsBody: "<html><body>این آگهی منقضی شده است</body></html>" });
    const outcome = await applyToKarboom(input(), { fetchImpl });
    expect(outcome.status).toBe("skipped");
    expect(outcome.reason).toBe("karboom_job_closed");
  });

  it("نشستِ بدونِ کوکی اصلاً شبکه را لمس نمی‌کند", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const outcome = await applyToKarboom(
      input({ session: JSON.stringify({ localStorage: { a: "b" } }) }),
      { fetchImpl },
    );
    expect(outcome).toMatchObject({ status: "failed", reason: "karboom_login_required" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
