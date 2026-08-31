/**
 * IranTalent apply-executor tests. Covers the per-application attachment, the
 * serialized upload→submit window, attachment proof, already-applied handling,
 * captcha/login blocking, and the refusal to report `submitted` without proof.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachmentMatchesTask,
  authorizationFromCookie,
  executeIranTalentApply,
  positionIdFromUrl,
} from "@ext/content/apply/irantalent";
import type { ApplyPlan } from "@ext/lib/apply-runner";

const AUTH_COOKIE = `auth_token_irantalent_new=${encodeURIComponent(
  JSON.stringify({ token_type: "Bearer", access_token: "tok", token_user: "candidate" }),
)}`;

function plan(overrides: Partial<ApplyPlan> = {}): ApplyPlan {
  return {
    board: "irantalent",
    jobUrl: "https://www.irantalent.com/job/backend-developer/182341",
    jobTitle: "Backend Developer",
    maturity: "best-effort",
    steps: [
      {
        kind: "upload",
        selector: "input[type=file]",
        valueKey: "resumeFile",
        value: "data:application/pdf;base64,JVBERi0=",
        fileName: "karjoo-182341.pdf",
      },
      { kind: "fill", selector: "textarea", valueKey: "coverLetter", value: "سلام" },
    ],
    ...overrides,
  } as ApplyPlan;
}

interface StubOptions {
  cookie?: string;
  pageText?: string;
  position?: Record<string, unknown>;
  conditions?: Record<string, unknown>;
  upload?: { status?: number; body?: unknown };
  apply?: { status?: number; body?: unknown };
  appliedAfter?: boolean;
  appliedJobs?: unknown;
}

function stub(options: StubOptions = {}) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  let submitted = false;
  vi.stubGlobal("document", {
    body: { innerText: options.pageText ?? "Apply" },
    cookie: options.cookie ?? AUTH_COOKIE,
  });
  vi.stubGlobal("location", new URL("https://www.irantalent.com/job/backend-developer/182341"));
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.endsWith("/candidate/profile")) {
      return new Response(JSON.stringify({ id: 5, cv: { id: 77 }, user: { first_name: "سارا" } }));
    }
    if (/\/employer\/position\/182341$/.test(url)) {
      const applied = submitted && (options.appliedAfter ?? true);
      return new Response(JSON.stringify({
        data: {
          id: 182341,
          status: { id: 170 },
          is_applied: applied,
          is_crawler: false,
          screening_questions: [],
          ...options.position,
        },
      }));
    }
    if (url.includes("check-apply-conditions")) {
      return new Response(JSON.stringify({
        is_email_verified: true,
        is_stepper_completed: true,
        ...options.conditions,
      }));
    }
    if (url.endsWith("/file") && method === "POST") {
      const { status = 201, body = { id: 909, file_name: "karjoo-182341.pdf" } } = options.upload ?? {};
      return new Response(JSON.stringify(body), { status });
    }
    if (/\/position\/182341\/apply$/.test(url)) {
      submitted = true;
      const { status = 200, body = { ok: true } } = options.apply ?? {};
      return new Response(JSON.stringify(body), { status });
    }
    if (url.includes("application/applied-jobs")) {
      return new Response(JSON.stringify(options.appliedJobs ?? { data: [] }));
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe("authorizationFromCookie", () => {
  it("rebuilds the site's own Authorization header", () => {
    expect(authorizationFromCookie(`_ga=1; ${AUTH_COOKIE}`)).toBe("Bearer tok");
  });
  it("returns null when signed out or the envelope is unusable", () => {
    expect(authorizationFromCookie("_ga=1")).toBeNull();
    expect(authorizationFromCookie("auth_token_irantalent_new=not-json")).toBeNull();
    expect(authorizationFromCookie("auth_token_irantalent_new=%7B%7D")).toBeNull();
  });
});

describe("positionIdFromUrl", () => {
  it("reads the id out of /job/:slug/:position_id", () => {
    expect(positionIdFromUrl("https://www.irantalent.com/job/backend-developer/182341")).toBe("182341");
    expect(positionIdFromUrl("https://www.irantalent.com/en/job/backend-developer/9")).toBe("9");
  });
  it("returns null for anything else", () => {
    expect(positionIdFromUrl("https://www.irantalent.com/jobs")).toBeNull();
    expect(positionIdFromUrl("not a url")).toBeNull();
  });
});

describe("attachmentMatchesTask", () => {
  it("requires an attachment id", () => {
    expect(attachmentMatchesTask({ id: null, fileName: "a.pdf" }, "a.pdf")).toBe(false);
    expect(attachmentMatchesTask({ id: 12, fileName: "a.pdf" }, "a.pdf")).toBe(true);
  });
  it("tolerates the site's own renaming but rejects a different document", () => {
    expect(attachmentMatchesTask({ id: 1, fileName: "karjoo_182341.PDF" }, "karjoo-182341.pdf")).toBe(true);
    expect(attachmentMatchesTask({ id: 1, fileName: "someone-else.pdf" }, "karjoo-182341.pdf")).toBe(false);
  });
});

describe("IranTalent apply", () => {
  it("uploads the tailored pdf and submits pinned to that file id", async () => {
    const { calls } = stub();
    const result = await executeIranTalentApply(plan());
    expect(result).toMatchObject({ ok: true });
    expect(result.ranSteps).toContain("attachment-verified");
    expect(result.ranSteps).toContain("confirmed");

    const upload = calls.find((c) => c.url.endsWith("/file"))!;
    const form = upload.body as FormData;
    expect(form.get("attachable_id")).toBe("77");
    expect(form.get("attachable_type")).toBe("cv");
    expect(form.get("file_type_id")).toBe("41");
    expect(form.get("attach_file")).toBeInstanceOf(File);

    const submit = calls.find((c) => c.url.endsWith("/apply"))!;
    expect(submit.body).toEqual({ file_id: 909, cover_letter: "سلام" });
    // The upload must precede the submit, never the other way round.
    expect(calls.indexOf(upload)).toBeLessThan(calls.indexOf(submit));
  });

  it("refuses to apply without a tailored pdf — there is no base-resume fallback", async () => {
    stub();
    const result = await executeIranTalentApply(plan({ steps: [] }));
    expect(result).toMatchObject({ ok: false, reason: "irantalent_resume_missing" });
  });

  it("fails closed when the stored attachment cannot be tied to this task", async () => {
    const { calls } = stub({ upload: { body: { id: 909, file_name: "someone-else.pdf" } } });
    const result = await executeIranTalentApply(plan());
    expect(result).toMatchObject({ ok: false, reason: "irantalent_resume_verification_failed" });
    expect(calls.some((c) => c.url.endsWith("/apply"))).toBe(false);
  });

  it("fails closed when the upload itself is rejected", async () => {
    const { calls } = stub({ upload: { status: 422, body: { message: "bad" } } });
    const result = await executeIranTalentApply(plan());
    expect(result).toMatchObject({ ok: false, reason: "irantalent_resume_upload_failed" });
    expect(calls.some((c) => c.url.endsWith("/apply"))).toBe(false);
  });

  it("never infers success from the submit call alone", async () => {
    const { calls } = stub({ appliedAfter: false });
    const result = await executeIranTalentApply(plan());
    expect(result).toMatchObject({ ok: false, reason: "irantalent_submission_unconfirmed" });
    expect(calls.some((c) => c.url.includes("applied-jobs"))).toBe(true);
  });

  it("accepts the application history as proof when the position flag lags", async () => {
    stub({ appliedAfter: false, appliedJobs: { data: [{ position: { id: 182341 } }] } });
    const result = await executeIranTalentApply(plan());
    expect(result).toMatchObject({ ok: true });
  });

  it("skips a job the board already has an application for", async () => {
    const { calls } = stub({ position: { is_applied: true } });
    const result = await executeIranTalentApply(plan());
    expect(result).toMatchObject({ ok: true, alreadyApplied: true });
    expect(calls.some((c) => c.url.endsWith("/file"))).toBe(false);
  });

  it("skips a closed posting without touching the attachment", async () => {
    const { calls } = stub({ position: { status: { id: 171 } } });
    const result = await executeIranTalentApply(plan());
    expect(result).toMatchObject({ ok: false, reason: "irantalent_job_unavailable" });
    expect(calls.some((c) => c.url.endsWith("/file"))).toBe(false);
  });

  it("skips a posting that only redirects to another site's form", async () => {
    stub({ position: { redirection_url: "https://elsewhere.example/apply" } });
    const result = await executeIranTalentApply(plan());
    expect(result).toMatchObject({ ok: false, reason: "irantalent_job_unavailable" });
  });

  it("does not invent answers to screening questions", async () => {
    const { calls } = stub({ position: { screening_questions: [{ id: 1, title: "Why?" }] } });
    const result = await executeIranTalentApply(plan());
    expect(result).toMatchObject({ ok: false, reason: "irantalent_screening_questions_required" });
    expect(calls.some((c) => c.url.endsWith("/file"))).toBe(false);
  });

  it("reports a changed contract when a healthy profile no longer carries the cv id", async () => {
    vi.stubGlobal("document", { body: { innerText: "Apply" }, cookie: AUTH_COOKIE });
    vi.stubGlobal("location", new URL("https://www.irantalent.com/job/backend-developer/182341"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: 5 }), { status: 200 })));
    const result = await executeIranTalentApply(plan());
    expect(result).toMatchObject({ ok: false, reason: "irantalent_provider_changed" });
  });

  it("blocks on a logged-out session before doing anything", async () => {
    const { fetchMock } = stub({ cookie: "_ga=1" });
    const result = await executeIranTalentApply(plan());
    expect(result).toMatchObject({ ok: false, reason: "irantalent_login_required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks on a security challenge rendered in the page", async () => {
    const { fetchMock } = stub({ pageText: "لطفاً بررسی امنیتی را کامل کنید" });
    const result = await executeIranTalentApply(plan());
    expect(result).toMatchObject({ ok: false, reason: "irantalent_security_challenge" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serializes concurrent tasks so two attachments never interleave", async () => {
    // `appliedAfter: false` keeps the position flag from flipping, so both tasks
    // run the full upload→submit window and the ordering stays observable.
    const { calls } = stub({
      appliedAfter: false,
      appliedJobs: { data: [{ position: { id: 182341 } }] },
    });
    const results = await Promise.all([
      executeIranTalentApply(plan()),
      executeIranTalentApply(plan()),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    const order = calls
      .filter((c) => c.url.endsWith("/file") || c.url.endsWith("/apply"))
      .map((c) => (c.url.endsWith("/file") ? "upload" : "submit"));
    expect(order).toEqual(["upload", "submit", "upload", "submit"]);
  });

  it("lets the second task see the first one's result instead of re-applying", async () => {
    const { calls } = stub();
    const results = await Promise.all([
      executeIranTalentApply(plan()),
      executeIranTalentApply(plan()),
    ]);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toMatchObject({ ok: true, alreadyApplied: true });
    expect(calls.filter((c) => c.url.endsWith("/file"))).toHaveLength(1);
  });
});
