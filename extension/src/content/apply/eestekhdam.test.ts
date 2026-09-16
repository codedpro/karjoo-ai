import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";

import {
  discoverFileDeleteActions,
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
    expect(result.proof).toEqual({ provider: "e-estekhdam", signal: "apply_api_accepted" });
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

  it("reconciles the provider's already-applied response as confirmed history", async () => {
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
      if (url.includes("/ats/positions/abc12")) {
        return new Response(JSON.stringify({ data: [{ id: 7, title: "Backend Developer" }] }));
      }
      return new Response(JSON.stringify({ message: "شما قبلاً برای این آگهی رزومه ارسال کرده‌اید" }), {
        status: 409,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(executeEEstekhdamApply(plan)).resolves.toMatchObject({
      ok: true,
      alreadyApplied: true,
      proof: { provider: "e-estekhdam", signal: "already_applied_api" },
    });
  });

  it("clears stored e-estekhdam files and retries the tailored PDF when the account file bucket is full", async () => {
    vi.stubGlobal("document", { body: { innerText: "Apply" } });
    vi.stubGlobal("location", new URL(plan.jobUrl));
    vi.stubGlobal("DOMParser", parseHTML("<html></html>").window.DOMParser);
    let applyAttempts = 0;
    const deleted = new Set<string>();
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
      if (url.endsWith("/ats/cvs")) {
        const files = [{ id: "f1" }, { file_id: 22 }].filter((file) =>
          !deleted.has(String("id" in file ? file.id : file.file_id)));
        return new Response(JSON.stringify({ data: { cvs: [{ id: 1 }], files } }));
      }
      if (url.endsWith("/panel/files/")) {
        return new Response(`
          <form method="post" action="/panel/files/remove">
            <input type="hidden" name="_token" value="csrf">
            <input type="hidden" name="id" value="f1">
            <button type="submit">حذف</button>
          </form>
          <form method="post" action="/panel/files/remove">
            <input type="hidden" name="_token" value="csrf">
            <input type="hidden" name="id" value="22">
            <button type="submit">حذف</button>
          </form>
        `);
      }
      if (url.endsWith("/panel/files/remove") && init?.method === "POST") {
        const body = init.body as URLSearchParams;
        deleted.add(body.get("id") ?? "");
        return new Response("ok");
      }
      if (url.includes("/ats/applicants/apply/42")) {
        applyAttempts += 1;
        return applyAttempts === 1
          ? new Response(JSON.stringify({ message: "خطا در زمان ذخیره فایل" }), { status: 400 })
          : new Response(JSON.stringify({ ok: true }), { status: 201 });
      }
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeEEstekhdamApply(plan);

    expect(result).toMatchObject({
      ok: true,
      ranSteps: ["session", "position", "cleanup_files", "upload", "confirmed"],
      proof: { provider: "e-estekhdam", signal: "apply_after_cleanup_api_accepted" },
    });
    expect(applyAttempts).toBe(2);
    expect([...deleted]).toEqual(["f1", "22"]);
  });

  it("extracts provider deletion forms without following unrelated or off-site controls", () => {
    const { document } = parseHTML(`
      <form method="post" action="/panel/files/delete">
        <input name="_token" value="csrf-token">
        <input name="file_id" value="target-1">
        <button name="action" value="delete">حذف</button>
      </form>
      <a href="https://attacker.example/delete/target-1">delete</a>
      <form action="/panel/profile"><input name="id" value="target-1"></form>
    `);

    const actions = discoverFileDeleteActions(document, "target-1");

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      url: "https://www.e-estekhdam.com/panel/files/delete",
      method: "POST",
    });
    expect(actions[0]?.body?.get("_token")).toBe("csrf-token");
    expect(actions[0]?.body?.get("file_id")).toBe("target-1");
  });

  it("extracts JavaScript-backed delete controls from their file row", () => {
    const { document } = parseHTML(`
      <article data-file-id="target-2">
        <span>old-resume.pdf</span>
        <button class="delete-link" data-url="/panel/files/target-2/remove" data-method="delete">حذف</button>
      </article>
      <button data-url="https://attacker.example/target-2/delete">حذف</button>
    `);

    expect(discoverFileDeleteActions(document, "target-2")).toEqual([expect.objectContaining({
      url: "https://www.e-estekhdam.com/panel/files/target-2/remove",
      method: "DELETE",
    })]);
  });

  it("submits a provider confirmation form before verifying deletion", async () => {
    vi.stubGlobal("document", { body: { innerText: "Apply" } });
    vi.stubGlobal("location", new URL(plan.jobUrl));
    vi.stubGlobal("DOMParser", parseHTML("<html></html>").window.DOMParser);
    let applyAttempts = 0;
    let deleted = false;
    const fallbackBodies: URLSearchParams[] = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return new Response(JSON.stringify({ data: { email: "candidate@example.com" } }));
      }
      if (url.includes("/jobs/kabc12")) {
        return new Response(JSON.stringify({ data: { id: 42, ats: true } }));
      }
      if (url.includes("/ats/positions/abc12")) {
        return new Response(JSON.stringify({ data: [{ id: 7 }] }));
      }
      if (url.endsWith("/ats/cvs")) {
        return new Response(JSON.stringify({ data: { files: deleted ? [] : [{ id: "old-7" }] } }));
      }
      if (url.endsWith("/panel/files/")) {
        if (init?.method === "DELETE") fallbackBodies.push(init.body as URLSearchParams);
        return new Response(`
          <meta name="csrf-token" content="manager-token">
          <a href="/panel/files/old-7/remove">حذف</a>
        `);
      }
      if (url.endsWith("/panel/files/old-7/remove") && init?.method === "GET") {
        return new Response(`
          <form method="post" action="/panel/files/old-7/remove">
            <input name="_token" value="confirm-token">
            <input name="file_id" value="old-7">
            <button type="submit">حذف</button>
          </form>
        `);
      }
      if (url.endsWith("/panel/files/old-7/remove") && init?.method === "POST") {
        expect((init.body as URLSearchParams).get("_token")).toBe("confirm-token");
        deleted = true;
        return new Response("deleted");
      }
      if (url.includes("/ats/applicants/apply/42")) {
        applyAttempts += 1;
        return applyAttempts === 1
          ? new Response(JSON.stringify({ message: "خطا در زمان ذخیره فایل" }), { status: 400 })
          : new Response(JSON.stringify({ ok: true }), { status: 201 });
      }
      throw new Error(`unexpected request ${url} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(executeEEstekhdamApply(plan)).resolves.toMatchObject({ ok: true });
    expect(deleted).toBe(true);
    expect(fallbackBodies).toHaveLength(0);
  });

  it("reports a cleanup failure when e-estekhdam lists files without deletable ids", async () => {
    vi.stubGlobal("document", { body: { innerText: "Apply" } });
    vi.stubGlobal("location", new URL(plan.jobUrl));
    const fetchMock = vi.fn(async (input: string | URL) => {
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
      if (url.endsWith("/ats/cvs")) {
        return new Response(JSON.stringify({ data: { files: [{ title: "old.pdf" }] } }));
      }
      return new Response(JSON.stringify({ message: "خطا در زمان ذخیره فایل" }), { status: 400 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeEEstekhdamApply(plan);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("eestekhdam_file_cleanup_failed: no file ids");
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

  it("keeps the no-submission path provider-specific when cleanup cannot recover", () => {
    const src = readFileSync("src/content/apply/eestekhdam.ts", "utf8");
    const block = src.slice(src.indexOf("eestekhdam_file_limit_reached") - 700);
    expect(block).toContain("ok: false");
    // The background runner owns the terminal skip decision; the content script
    // must still report that no application was submitted.
    expect(src).not.toMatch(/file_limit[^\n]*alreadyApplied/);
  });

  it("tells the user the one action that fixes it", () => {
    const src = readFileSync("src/content/apply/eestekhdam.ts", "utf8");
    expect(src).toContain("پاک‌سازی خودکار");
  });

  it("counts the collection that actually fills up", () => {
    const src = readFileSync("src/content/apply/eestekhdam.ts", "utf8");
    // Counting `cvs` reported 1 and made the theory look dead; `files` is the
    // list an application adds to.
    expect(src).toContain("data.files");
    expect(src).toContain("files=");
  });
});
