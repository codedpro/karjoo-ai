/**
 * API-client tests with an injected fetch — no network. Verifies the Bearer
 * header carries KARJOO's token (never a board secret), correct paths/methods,
 * and that the connect call sends exactly the metadata payload.
 */
import { describe, it, expect, vi } from "vitest";
import { KarjooApi, ApiError, type FetchImpl } from "@ext/lib/api-client";
import { buildConnectPayload } from "@ext/lib/connect-payload";
import { buildImportPayload } from "@ext/lib/import-payload";

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body?: unknown;
}

function fakeFetch(
  responder: (req: Captured) => { status: number; body: unknown },
): { fetchImpl: FetchImpl; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl: FetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const captured: Captured = { url, method: init?.method ?? "GET", headers, body };
    calls.push(captured);
    const { status, body: resBody } = responder(captured);
    return new Response(JSON.stringify(resBody), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as FetchImpl;
  return { fetchImpl, calls };
}

describe("KarjooApi.link", () => {
  it("POSTs the pairing code (server field `pairingCode`) and returns the token", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 201,
      body: { token: "ext-token-1", kind: "extension", userId: "u1", expiresAt: "2026-01-01T00:00:00Z" },
    }));
    const api = new KarjooApi({ origin: "http://localhost:3000", token: null, fetchImpl });
    const res = await api.link("paircode123");

    expect(res.token).toBe("ext-token-1");
    expect(calls[0]!.url).toBe("http://localhost:3000/api/extension/link");
    expect(calls[0]!.method).toBe("POST");
    // Server schema is `.strict()` and reads `pairingCode`, not `code`.
    expect(calls[0]!.body).toEqual({ pairingCode: "paircode123" });
    expect(calls[0]!.headers.get("authorization")).toBeNull();
  });
});

describe("KarjooApi authed calls", () => {
  it("attaches KARJOO's own token as Bearer (not a board credential)", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: {
        user: {
          id: "u1",
          email: "ali@gmail.com",
          name: "علی",
          avatarUrl: null,
          fullName: null,
          isActive: true,
        },
        boards: [],
      },
    }));
    const api = new KarjooApi({ origin: "http://localhost:3000", token: "ext-token-1", fetchImpl });
    const identity = await api.me();
    expect(calls[0]!.url).toBe("http://localhost:3000/api/extension/me");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer ext-token-1");
    // Maps the server `{ user, boards }` shape onto the extension Identity.
    expect(identity).toEqual({ userId: "u1", email: "ali@gmail.com", displayName: "علی" });
  });

  it("connectBoard sends EXACTLY { board, accountLabel } — no `status` (server is .strict)", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { account: {} } }));
    const api = new KarjooApi({ origin: "http://localhost:3000", token: "t", fetchImpl });
    const payload = buildConnectPayload({ board: "jobinja", accountLabel: "main" });
    await api.connectBoard(payload);

    expect(calls[0]!.url).toBe("http://localhost:3000/api/board-accounts/connect");
    // The local `status:'connected'` is stripped — server's strict schema rejects it.
    expect(calls[0]!.body).toEqual({ board: "jobinja", accountLabel: "main" });
    // No secret-shaped keys made it onto the wire.
    const wire = JSON.stringify(calls[0]!.body).toLowerCase();
    for (const bad of ["cookie", "token", "password", "secret", "jwt", "session"]) {
      expect(wire).not.toContain(bad);
    }
  });

  it("disconnectBoard removes only Karjoo's board connection metadata", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { ok: true } }));
    const api = new KarjooApi({ origin: "http://localhost:3000", token: "t", fetchImpl });
    await api.disconnectBoard("jobvision");

    expect(calls[0]!.url).toBe("http://localhost:3000/api/board-accounts/disconnect");
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.body).toEqual({ board: "jobvision" });
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer t");
  });

  it("claimQueue maps the server ClaimedApplyItem shape onto ApplyQueueItem", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: {
        count: 1,
        items: [
          {
            taskId: "task-1",
            matchId: "m1",
            listingId: "l1",
            board: "jobinja",
            coverLetter: "سلام",
            matchScore: 0.91,
            listing: { title: "مهندس", company: "اسنپ", city: "تهران", url: "https://jobinja.ir/j/1" },
          },
        ],
      },
    }));
    const api = new KarjooApi({ origin: "http://localhost:3000", token: "t", fetchImpl });
    const { items } = await api.claimQueue();
    expect(calls[0]!.url).toBe("http://localhost:3000/api/apply-queue/claim");
    expect(items).toEqual([
      {
        id: "task-1",
        board: "jobinja",
        jobTitle: "مهندس",
        company: "اسنپ",
        city: "تهران",
        jobUrl: "https://jobinja.ir/j/1",
        coverLetter: "سلام",
        matchScore: 0.91,
        resumeStrategy: "tailored_pdf",
      },
    ]);
  });

  it("reportResult posts to the :id/result path with NO id in the body (id is in the path)", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: { application: {}, taskStatus: "succeeded" },
    }));
    const api = new KarjooApi({ origin: "http://localhost:3000", token: "t", fetchImpl });
    await api.reportResult({ id: "app 1/x", status: "submitted" });
    expect(calls[0]!.url).toBe("http://localhost:3000/api/apply-queue/app%201%2Fx/result");
    // Server schema is `.strict()`: the id lives in the URL, never the body.
    expect(calls[0]!.body).toEqual({ status: "submitted" });
  });

  it("importProfile POSTs exactly { board, payload } and parses the FLAT server summary", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      // Server returns the flat ApplyImportSummary (src/lib/apply/import-service.ts).
      status: 201,
      body: {
        importId: "imp-1",
        board: "jobinja",
        status: "applied",
        appliedFields: ["skills", "city"],
        addedSkills: ["TypeScript"],
        importedApplicationCount: 0,
      },
    }));
    const api = new KarjooApi({ origin: "http://localhost:3000", token: "t", fetchImpl });
    const body = buildImportPayload("jobinja", {
      fullName: "علی رضایی",
      skills: ["TypeScript", "React"],
      city: "تهران",
    });
    const res = await api.importProfile(body);

    expect(calls[0]!.url).toBe("http://localhost:3000/api/profile/import");
    expect(calls[0]!.method).toBe("POST");
    // The body matches the server's profileImportBodySchema EXACTLY: { board, payload }.
    expect(Object.keys(calls[0]!.body as object).sort()).toEqual(["board", "payload"]);
    expect((calls[0]!.body as { board: string }).board).toBe("jobinja");
    // Reads the flat appliedFields array → "2 مورد به‌روزرسانی شد".
    expect(res.ok).toBe(true);
    expect(res.summary).toBe("2 مورد به‌روزرسانی شد");
    // No credential-shaped key on the wire (the §10 DATA-only invariant).
    const wire = JSON.stringify(calls[0]!.body).toLowerCase();
    for (const bad of ["cookie", "token", "password", "secret", "jwt", "session", "authorization"]) {
      expect(wire).not.toContain(bad);
    }
  });

  it("importProfile falls back to the server status when nothing was merged (received)", async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 201,
      body: { importId: "imp-2", board: "jobinja", status: "received", appliedFields: [], addedSkills: [] },
    }));
    const api = new KarjooApi({ origin: "http://localhost:3000", token: "t", fetchImpl });
    const body = buildImportPayload("jobinja", { fullName: "علی" });
    const res = await api.importProfile(body);
    expect(res.summary).toBe("received");
  });

  it("throws ApiError with the server message on non-2xx", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 401, body: { error: "unauthorized" } }));
    const api = new KarjooApi({ origin: "http://localhost:3000", token: "t", fetchImpl });
    await expect(api.me()).rejects.toThrow(ApiError);
    await expect(api.me()).rejects.toThrow("unauthorized");
  });
});

describe("transient gateway errors (a control-plane deploy)", () => {
  function flaky(statuses: number[], body = '{"ok":true}') {
    let call = 0;
    return vi.fn(async () => {
      const status = statuses[Math.min(call++, statuses.length - 1)]!;
      return new Response(status === 200 ? body : "bad gateway", { status });
    });
  }

  it("retries a READ through a 502 and returns the eventual success", async () => {
    const fetchImpl = flaky([502, 502, 200], '{"version":"0.8.2"}');
    const api = new KarjooApi({ origin: "https://x.test", token: "t", fetchImpl, retryBackoffMs: 0 });
    await expect(api.getExecutionRun()).resolves.toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("gives up after the retry budget instead of hanging the tick", async () => {
    const fetchImpl = flaky([502]);
    const api = new KarjooApi({ origin: "https://x.test", token: "t", fetchImpl, retryBackoffMs: 0 });
    await expect(api.getExecutionRun()).rejects.toThrow(/502/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("never retries a WRITE — replaying a claim could apply to a job twice", async () => {
    const fetchImpl = flaky([502]);
    const api = new KarjooApi({ origin: "https://x.test", token: "t", fetchImpl, retryBackoffMs: 0 });
    await expect(api.claimQueue(1, "11111111-1111-4111-8111-111111111111")).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a real client error — a 401 must surface at once", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"nope"}', { status: 401 }));
    const api = new KarjooApi({ origin: "https://x.test", token: "t", fetchImpl, retryBackoffMs: 0 });
    await expect(api.getExecutionRun()).rejects.toThrow(/nope/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a dropped connection the same way", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      if (call++ === 0) throw new TypeError("Failed to fetch");
      return new Response('{"ok":true}', { status: 200 });
    });
    const api = new KarjooApi({ origin: "https://x.test", token: "t", fetchImpl, retryBackoffMs: 0 });
    await expect(api.getExecutionRun()).resolves.toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("build identification", () => {
  it("tells the server which build is calling, so a stale copy is visible", async () => {
    const seen: Headers[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response("{}", { status: 200 });
    });
    // Stand in for the extension runtime the client reads its version from.
    vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "9.9.9" }) } });
    try {
      const api = new KarjooApi({ origin: "https://x.test", token: "t", fetchImpl });
      await api.getExecutionRun();
      expect(seen[0]!.get("x-karjoo-extension-version")).toBe("9.9.9");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("omits the header rather than failing when there is no extension runtime", async () => {
    const seen: Headers[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response("{}", { status: 200 });
    });
    const api = new KarjooApi({ origin: "https://x.test", token: "t", fetchImpl });
    await api.getExecutionRun();
    expect(seen[0]!.get("x-karjoo-extension-version")).toBeNull();
  });
});
