/**
 * Server-side IranTalent apply tests — the same guarantees the extension adapter
 * has, now without a browser: IranTalent applies with the user's provider
 * profile CV, never uploads a per-job PDF, and never infers `submitted` from the
 * POST alone.
 */
import { describe, expect, it, vi } from "vitest";

import {
  applyToIranTalent,
  authorizationFromSession,
  positionIdFromUrl,
} from "@/lib/apply/boards/irantalent-apply";

const ENVELOPE = encodeURIComponent(JSON.stringify({ token_type: "Bearer", access_token: "AT" }));
const SESSION = JSON.stringify({
  cookies: [{ name: "auth_token_irantalent_new", value: ENVELOPE, domain: ".irantalent.com" }],
  userAgent: "test",
});
const JOB_URL = "https://www.irantalent.com/job/backend-developer/182341";

function input(overrides: Partial<Parameters<typeof applyToIranTalent>[0]> = {}) {
  return {
    session: SESSION,
    jobUrl: JOB_URL,
    coverLetter: "سلام",
    ...overrides,
  };
}

interface StubOptions {
  position?: Record<string, unknown>;
  conditions?: Record<string, unknown>;
  apply?: { status?: number; body?: unknown };
  appliedAfter?: boolean;
  appliedJobs?: unknown;
  profile?: unknown;
}

function stub(options: StubOptions = {}) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  let submitted = false;
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? "GET";
    calls.push({ url: href, method, body: init?.body });
    if (href.endsWith("/candidate/profile")) {
      return new Response(JSON.stringify(options.profile ?? { id: 5, cv: { id: 77 } }));
    }
    if (/\/employer\/position\/182341$/.test(href)) {
      return new Response(JSON.stringify({
        data: {
          id: 182341,
          status: { id: 170 },
          is_applied: submitted && (options.appliedAfter ?? true),
          is_crawler: false,
          screening_questions: [],
          ...options.position,
        },
      }));
    }
    if (href.includes("check-apply-conditions")) {
      return new Response(JSON.stringify({ is_email_verified: true, ...options.conditions }));
    }
    if (/\/position\/182341\/apply$/.test(href)) {
      submitted = true;
      const { status = 200, body = { ok: true } } = options.apply ?? {};
      return new Response(JSON.stringify(body), { status });
    }
    if (href.includes("application/applied-jobs")) {
      return new Response(JSON.stringify(options.appliedJobs ?? { data: [] }));
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchMock, calls };
}

describe("authorizationFromSession", () => {
  it("rebuilds the header from the vaulted cookie bundle", () => {
    expect(authorizationFromSession(SESSION)).toBe("Bearer AT");
  });
  it("returns null for a bundle without the auth cookie", () => {
    expect(authorizationFromSession(JSON.stringify({ cookies: [] }))).toBeNull();
    expect(authorizationFromSession("not json")).toBeNull();
  });
});

describe("positionIdFromUrl", () => {
  it("reads the id from canonical IranTalent job URLs", () => {
    expect(positionIdFromUrl(JOB_URL)).toBe("182341");
    expect(positionIdFromUrl("https://www.irantalent.com/jobs")).toBeNull();
  });
});

describe("applyToIranTalent", () => {
  it("submits with the provider profile CV and optional cover letter", async () => {
    const { fetchMock, calls } = stub();
    const result = await applyToIranTalent(input(), fetchMock);
    expect(result.status).toBe("submitted");

    expect(calls.some((c) => c.url.endsWith("/file"))).toBe(false);
    const submit = calls.find((c) => c.url.endsWith("/apply"))!;
    expect(JSON.parse(String(submit.body))).toEqual({ cover_letter: "سلام" });
  });

  it("sends an empty submit body when there is no cover letter", async () => {
    const { fetchMock, calls } = stub();
    expect(await applyToIranTalent(input({ coverLetter: "" }), fetchMock)).toMatchObject({ status: "submitted" });
    const submit = calls.find((c) => c.url.endsWith("/apply"))!;
    expect(JSON.parse(String(submit.body))).toEqual({});
  });

  it("never reports submitted without durable proof", async () => {
    const { fetchMock } = stub({ appliedAfter: false });
    expect(await applyToIranTalent(input(), fetchMock)).toMatchObject({
      status: "failed",
      reason: "irantalent_submission_unconfirmed",
    });
  });

  it("accepts the application history as proof", async () => {
    const { fetchMock } = stub({
      appliedAfter: false,
      appliedJobs: { data: [{ position: { id: 182341 } }] },
    });
    expect(await applyToIranTalent(input(), fetchMock)).toMatchObject({ status: "submitted" });
  });

  it("skips closed, already-applied, redirected, and screening-question jobs", async () => {
    for (const [position, reason] of [
      [{ status: { id: 171 } }, "irantalent_job_unavailable"],
      [{ is_applied: true }, "irantalent_already_applied"],
      [{ redirection_url: "https://elsewhere.example" }, "irantalent_job_unavailable"],
      [{ screening_questions: [{ id: 1 }] }, "irantalent_screening_questions_required"],
    ] as const) {
      const { fetchMock, calls } = stub({ position });
      const result = await applyToIranTalent(input(), fetchMock);
      expect(result, reason).toMatchObject({ status: "skipped", reason });
      expect(calls.some((c) => c.url.endsWith("/file"))).toBe(false);
    }
  });

  it("reports a login problem when the session is missing or rejected", async () => {
    const { fetchMock } = stub();
    expect(await applyToIranTalent(input({ session: "{}" }), fetchMock)).toMatchObject({
      status: "failed",
      reason: "irantalent_login_required",
    });
  });

  it("distinguishes a contract change from a logged-out session", async () => {
    const { fetchMock } = stub({ profile: { id: 5 } });
    expect(await applyToIranTalent(input(), fetchMock)).toMatchObject({
      status: "failed",
      reason: "irantalent_provider_changed",
    });
  });
});
