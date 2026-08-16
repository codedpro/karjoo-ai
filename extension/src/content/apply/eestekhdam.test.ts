import { afterEach, describe, expect, it, vi } from "vitest";

import { executeEEstekhdamApply } from "@ext/content/apply/eestekhdam";
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
