/**
 * Karboom apply-executor tests. کاربوم ویزارِد چندمرحله‌ایِ سرورگردان دارد، پس
 * این‌جا یک «سرورِ ساختگیِ کاربوم» می‌سازیم که مثل خودش مرحله‌به‌مرحله جلو می‌رود، و
 * بررسی می‌کنیم که فقط رزومه‌ی اختصاصی آپلود شود، هیچ داده‌ای ساخته نشود، و بدونِ
 * رسیدن به `done` هیچ‌وقت «ثبت شد» گزارش نشود.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectStepFields,
  executeKarboomApply,
  fileInputName,
  karboomCodeFromUrl,
  karboomJobIdFromHtml,
  looksAlreadyApplied,
} from "@ext/content/apply/karboom";
import type { ApplyPlan } from "@ext/lib/apply-runner";

const RESUME_DATA = `data:application/pdf;base64,${btoa("%PDF-1.4 tailored")}`;

function plan(withResume = true): ApplyPlan {
  return {
    board: "karboom",
    jobUrl: "https://karboom.io/jobs/wjadpo/%DA%A9%D8%A7%D8%B1",
    jobTitle: "کارشناس حقوقی",
    maturity: "best-effort",
    steps: withResume
      ? [{ kind: "upload", selector: ".js-upload-pdf", valueKey: "resumeFile", value: RESUME_DATA, fileName: "Ali_Rezaei_rasha_fn_1.pdf" } as never]
      : [],
  };
}

const DETAIL_HTML = '<div class="js-apply-job" data-job="48313">ارسال رزومه</div>';

/** قالبِ مرحله‌ای که کاربوم برمی‌گرداند — سرور فیلدها را از پروفایل پیش‌پر کرده. */
function stepContent(inner: string): string {
  return JSON.stringify({ content: `<form class="js-step-form">${inner}</form>` });
}

const SELECT_RESUME = stepContent(
  '<div class="js-my-resume" data-value="9">رزومه‌ی حساب</div>' +
  '<input class="js-my-resume-field" name="resume" value="">' +
  '<input type="file" class="js-upload-pdf" name="resume_file">' +
  '<input name="job" value="48313">',
);

const PERSONAL_INFO = stepContent(
  '<input name="first_name" value="علی"><input name="last_name" value="رضایی">' +
  '<input type="radio" name="gender" value="1" checked><input type="radio" name="gender" value="2">' +
  '<select name="city"><option value="87" selected>تهران</option><option value="130">مشهد</option></select>',
);

interface Call { url: string; init: RequestInit }

/** یک کاربومِ ساختگی که ویزارد را مثل سرورِ واقعی جلو می‌برد. */
function karboomServer(script: Record<string, string | number>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const method = (init.method ?? "GET").toUpperCase();
    if (url.includes("/jobs/details/")) return new Response(DETAIL_HTML, { status: 200 });
    const key = `${method} ${new URL(url).pathname.replace("/jobs/apply/48313", "")}`;
    const reply = script[key];
    if (reply === undefined) return new Response("{}", { status: 404 });
    if (typeof reply === "number") return new Response("{}", { status: reply });
    return new Response(reply, { status: 200 });
  });
  return { calls, deps: { fetchImpl: fetchImpl as unknown as typeof fetch, csrfToken: () => "tok123" } };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("pure helpers", () => {
  it("کدِ آگهی را از نشانی درمی‌آورد", () => {
    expect(karboomCodeFromUrl("https://karboom.io/jobs/wjadpo/x")).toBe("wjadpo");
    expect(karboomCodeFromUrl("https://karboom.io/jobs/details/wjadpo")).toBe("wjadpo");
    expect(karboomCodeFromUrl("https://example.com/x")).toBeNull();
  });

  it("شناسه‌ی عددی را از قطعه‌ی آگهی می‌خواند", () => {
    expect(karboomJobIdFromHtml(DETAIL_HTML)).toBe("48313");
    expect(karboomJobIdFromHtml("<div></div>")).toBeNull();
  });

  it("پیامِ «قبلاً درخواست داده‌اید» را می‌شناسد", () => {
    expect(looksAlreadyApplied({ message: "شما قبلا برای این آگهی رزومه فرستاده‌اید" })).toBe(true);
    expect(looksAlreadyApplied({ currentStep: "job_status" })).toBe(false);
  });
});

describe("collectStepFields", () => {
  it("مقادیرِ پیش‌پرشده‌ی سرور را برمی‌دارد و فایل/دکمه را کنار می‌گذارد", () => {
    const html =
      '<form><input name="a" value="۱"><input type="file" name="f">' +
      '<input type="submit" name="go" value="x">' +
      '<input type="radio" name="g" value="1" checked><input type="radio" name="g" value="2">' +
      '<textarea name="bio">  متن  </textarea>' +
      '<select name="c"><option value="87" selected>ت</option><option value="1">م</option></select>' +
      "</form>";
    expect(collectStepFields(html)).toEqual([["a", "۱"], ["g", "1"], ["bio", "متن"], ["c", "87"]]);
    expect(fileInputName(html)).toBe("f");
  });
});

describe("executeKarboomApply", () => {
  it("ویزارد را تا done دنبال می‌کند و رزومه‌ی اختصاصی را در select_resume آپلود می‌کند", async () => {
    const { calls, deps } = karboomServer({
      "POST ": JSON.stringify({ currentStep: "select_resume" }),
      "GET /select-resume": SELECT_RESUME,
      "POST /select-resume": JSON.stringify({ currentStep: "personal_info" }),
      "GET /personal-info": PERSONAL_INFO,
      "POST /personal-info": JSON.stringify({ currentStep: "done" }),
    });

    const result = await executeKarboomApply(plan(), deps);
    expect(result.ok).toBe(true);
    expect(result.ranSteps).toContain("confirmed");

    const upload = calls.find((c) => c.url.endsWith("/select-resume") && c.init.method === "POST")!;
    const body = upload.init.body as FormData;
    const file = body.get("resume_file") as File;
    expect(file.name).toBe("Ali_Rezaei_rasha_fn_1.pdf");
    expect(file.type).toBe("application/pdf");
    // رزومه‌ی ذخیره‌شده‌ی حساب نباید هم‌زمان فرستاده شود، وگرنه کاربوم آن را می‌گیرد.
    expect(body.get("resume")).toBeNull();
    expect(body.get("job")).toBe("48313");

    // مرحله‌ی بدونِ فایل باید urlencoded برود، با همان مقادیرِ پروفایل.
    const info = calls.find((c) => c.url.endsWith("/personal-info") && c.init.method === "POST")!;
    expect(String(info.init.body)).toContain("first_name=%D8%B9%D9%84%DB%8C");
    expect(String(info.init.body)).toContain("gender=1");

    // CSRF همان چیزی است که خودِ صفحه دارد.
    expect((upload.init.headers as Record<string, string>)["x-csrf-token"]).toBe("tok123");
  });

  it("وقتی نشست از دست رفته باشد login_required می‌دهد، نه موفقیت", async () => {
    const { deps } = karboomServer({ "POST ": JSON.stringify({ currentStep: "account" }) });
    const result = await executeKarboomApply(plan(), deps);
    expect(result).toMatchObject({ ok: false, reason: "karboom_login_required" });
  });

  it("رزومه‌ی اختصاصی که نباشد، رزومه‌ی دیگری جایگزین نمی‌کند", async () => {
    const { calls, deps } = karboomServer({
      "POST ": JSON.stringify({ currentStep: "select_resume" }),
      "GET /select-resume": SELECT_RESUME,
      "POST /select-resume": JSON.stringify({ currentStep: "done" }),
    });
    const result = await executeKarboomApply(plan(false), deps);
    expect(result).toMatchObject({ ok: false, reason: "karboom_tailored_resume_missing" });
    expect(calls.some((c) => c.url.endsWith("/select-resume") && c.init.method === "POST")).toBe(false);
  });

  it("۴۲۲ یعنی پروفایلِ کاربوم ناقص است — داده‌ای ساخته نمی‌شود", async () => {
    const { deps } = karboomServer({
      "POST ": JSON.stringify({ currentStep: "personal_info" }),
      "GET /personal-info": PERSONAL_INFO,
      "POST /personal-info": 422,
    });
    const result = await executeKarboomApply(plan(), deps);
    expect(result).toMatchObject({ ok: false, reason: "karboom_profile_incomplete: personal_info" });
  });

  it("اگر سرور روی یک مرحله گیر کند، حلقه‌ی بی‌پایان نمی‌سازد", async () => {
    const { deps } = karboomServer({
      "POST ": JSON.stringify({ currentStep: "personal_info" }),
      "GET /personal-info": PERSONAL_INFO,
      "POST /personal-info": JSON.stringify({ currentStep: "personal_info" }),
    });
    const result = await executeKarboomApply(plan(), deps);
    expect(result).toMatchObject({ ok: false, reason: "karboom_step_stalled: personal_info" });
  });

  it("آگهیِ قبلاً اپلای‌شده را موفق ولی تکراری گزارش می‌کند", async () => {
    const { deps } = karboomServer({ "POST ": JSON.stringify({ message: "شما قبلا برای این آگهی رزومه فرستاده‌اید" }) });
    const result = await executeKarboomApply(plan(), deps);
    expect(result).toMatchObject({ ok: true, alreadyApplied: true });
  });

  it("بدونِ شناسه‌ی عددی وارد ویزارد نمی‌شود", async () => {
    const deps = {
      fetchImpl: (async () => new Response("<div>بدونِ data-job</div>", { status: 200 })) as unknown as typeof fetch,
      csrfToken: () => "tok123",
    };
    const result = await executeKarboomApply(plan(), deps);
    expect(result).toMatchObject({ ok: false, reason: "karboom_job_id_missing" });
  });
});
