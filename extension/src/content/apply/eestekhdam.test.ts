import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeEEstekhdamApply,
  failureDetail,
  isFileLimitRefusal,
} from "@ext/content/apply/eestekhdam";
import type { ApplyPlan } from "@ext/lib/apply-runner";

const plan: ApplyPlan = {
  board: "e-estekhdam",
  jobUrl: "https://www.e-estekhdam.com/kabc12-backend",
  jobTitle: "Backend Developer",
  maturity: "best-effort",
  steps: [
    {
      kind: "upload",
      selector: "input[type=file]",
      valueKey: "resumeFile",
      value: "data:application/pdf;base64,JVBERi0=",
      fileName: "resume.pdf",
    },
    {
      kind: "fill",
      selector: "textarea",
      valueKey: "coverLetter",
      value: "Hello from Karjoo",
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("e-estekhdam apply", () => {
  it("uses the active session and submits the tailored PDF multipart form", async () => {
    vi.stubGlobal("document", { body: { innerText: "Apply" } });
    vi.stubGlobal("location", new URL(plan.jobUrl));
    let submitted: FormData | null = null;
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return new Response(JSON.stringify({ data: { user: { email: "candidate@example.com" } } }));
      }
      if (url.includes("/jobs/kabc12")) {
        return new Response(JSON.stringify({ data: { id: 42, uuid: "abc12", ats: true } }));
      }
      if (url.includes("/ats/positions/abc12")) {
        return new Response(JSON.stringify({ data: [{ id: 7, title: "Backend Developer" }] }));
      }
      submitted = init?.body as FormData;
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeEEstekhdamApply(plan);
    expect(result.ok).toBe(true);
    expect(submitted).not.toBeNull();
    expect(submitted!.get("jobId")).toBe("42");
    expect(submitted!.get("workId")).toBe("7");
    expect(submitted!.get("email")).toBe("candidate@example.com");
    expect(submitted!.get("description")).toBe("Hello from Karjoo");
    expect(submitted!.get("file")).toBeInstanceOf(File);
  });

  it("does not submit when the site marks a position as gender-incompatible", async () => {
    vi.stubGlobal("document", { body: { innerText: "Apply" } });
    vi.stubGlobal("location", new URL(plan.jobUrl));
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return new Response(JSON.stringify({ data: { email: "candidate@example.com" } }));
      }
      if (url.includes("/jobs/kabc12")) {
        return new Response(JSON.stringify({ data: { id: 42, ats: true } }));
      }
      return new Response(JSON.stringify({ data: [{ id: 7, invalidType: "gender" }] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeEEstekhdamApply(plan);
    expect(result).toMatchObject({ ok: false, reason: "eestekhdam_gender_mismatch" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("failureDetail — why a submission was refused", () => {
  it("keeps the board's own message so the failure is diagnosable", () => {
    expect(failureDetail(422, { message: "شما به سقف روزانه رسیده‌اید" }))
      .toBe("422 شما به سقف روزانه رسیده‌اید");
  });

  it("unpacks field validation errors", () => {
    expect(failureDetail(422, { errors: { workId: ["الزامی است"] } }))
      .toContain("workId: الزامی است");
  });

  it("redacts emails, because this string is stored and shown in the dashboard", () => {
    const detail = failureDetail(400, { message: "user someone@example.com is not allowed" });
    expect(detail).not.toContain("someone@example.com");
    expect(detail).toContain("[email]");
  });

  it("still says something useful when the body is a bare string or empty", () => {
    expect(failureDetail(500, "Internal Server Error")).toBe("500 Internal Server Error");
    expect(failureDetail(403, null)).toBe("403 {}");
  });

  it("stays short enough to store on a task row", () => {
    expect(failureDetail(422, { message: "x".repeat(500) }).length).toBeLessThan(220);
  });
});


describe("the account file limit", () => {
  it("recognises the board's own wording for it", () => {
    expect(isFileLimitRefusal("400 خطا در زمان ذخیره فایل")).toBe(true);
    expect(isFileLimitRefusal("شما به محدودیت تعداد فایل های ارسالی رسیده اید")).toBe(true);
    expect(isFileLimitRefusal("too many files")).toBe(true);
  });

  it("does not treat an unrelated refusal as a file limit", () => {
    expect(isFileLimitRefusal("422 workId الزامی است")).toBe(false);
    expect(isFileLimitRefusal("500 Internal Server Error")).toBe(false);
  });

  it("never sends a different résumé in place of the tailored one", () => {
    const src = readFileSync("src/content/apply/eestekhdam.ts", "utf8");
    // Applying with the account's own CV would mean the employer received a
    // résumé that was not written for their ad, recorded as an application.
    expect(src).not.toContain("eestekhdam_profile_resume_used");
    expect(src).toContain("eestekhdam_file_limit_reached");
  });

  it("fails rather than skips, so the ad is retried once space is freed", () => {
    const src = readFileSync("src/content/apply/eestekhdam.ts", "utf8");
    const block = src.slice(src.indexOf("eestekhdam_file_limit_reached") - 700);
    expect(block).toContain("ok: false");
    // A skip is terminal; this ad can succeed later, so it must stay queued.
    expect(src).not.toMatch(/file_limit[^\n]*alreadyApplied/);
  });

  it("tells the user the one action that fixes it", () => {
    const src = readFileSync("src/content/apply/eestekhdam.ts", "utf8");
    expect(src).toContain("حذف کنید");
  });

  it("counts the collection that actually fills up", () => {
    const src = readFileSync("src/content/apply/eestekhdam.ts", "utf8");
    // Counting `cvs` reported 1 and made the theory look dead; `files` is the
    // list an application adds to.
    expect(src).toContain("data.files");
    expect(src).toContain("files=");
  });
});
