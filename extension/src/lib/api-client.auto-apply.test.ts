/**
 * API-client tests for the auto-apply / session-refresh endpoints (injected
 * fetch, no network). Verifies the gated claim `reason`, the 429 daily-cap signal
 * on result (no throw), the settings GET/PUT, the 404 fail-closed default, and
 * that the vault refresh hits /api/session/refresh.
 */
import { describe, it, expect } from "vitest";
import { KarjooApi, type FetchImpl } from "@ext/lib/api-client";

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
    return new Response(resBody === undefined ? "" : JSON.stringify(resBody), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as FetchImpl;
  return { fetchImpl, calls };
}

const api = (fetchImpl: FetchImpl) =>
  new KarjooApi({ origin: "http://localhost:3000", token: "t", fetchImpl });

describe("claimQueue — surfaces the gated reason", () => {
  it("returns reason 'disabled' on an empty gated queue", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: { count: 0, items: [], reason: "disabled" } }));
    const res = await api(fetchImpl).claimQueue(5);
    expect(res.items).toEqual([]);
    expect(res.reason).toBe("disabled");
  });

  it("returns reason 'quota_exceeded' when the cap is reached", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: { count: 0, items: [], reason: "quota_exceeded" } }));
    const res = await api(fetchImpl).claimQueue(5);
    expect(res.reason).toBe("quota_exceeded");
  });

  it("passes the limit in the body", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { count: 0, items: [] } }));
    await api(fetchImpl).claimQueue(3);
    expect(calls[0]!.body).toEqual({ limit: 3 });
  });
});

describe("reportResult — 429 daily-cap does NOT throw", () => {
  it("returns { ok:false, status:429 } on cap reached", async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 429,
      body: { error: "سقف روزانه پر شد", code: "apply_quota", usedToday: 100, limit: 100 },
    }));
    const res = await api(fetchImpl).reportResult({ id: "t1", status: "submitted" });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(429);
  });

  it("returns { ok:true, status:200 } on success", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: { application: {}, taskStatus: "succeeded" } }));
    const res = await api(fetchImpl).reportResult({ id: "t1", status: "submitted" });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });

  it("still throws on other errors (e.g. 404 task not found)", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 404, body: { error: "apply task not found" } }));
    await expect(api(fetchImpl).reportResult({ id: "t1", status: "submitted" })).rejects.toThrow(
      "apply task not found",
    );
  });

  it("the wire body never carries a secret", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: {} }));
    await api(fetchImpl).reportResult({ id: "t1", status: "failed", reason: "selector not found" });
    const wire = JSON.stringify(calls[0]!.body).toLowerCase();
    for (const bad of ["cookie", "token", "password", "secret", "jwt", "session", "authorization"]) {
      expect(wire).not.toContain(bad);
    }
  });
});

describe("getAutoApplySettings", () => {
  it("reads the server settings from /api/auto-apply", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: { enabled: true, minScore: 0.8 },
    }));
    const s = await api(fetchImpl).getAutoApplySettings();
    expect(calls[0]!.url).toBe("http://localhost:3000/api/auto-apply");
    expect(calls[0]!.method).toBe("GET");
    expect(s).toEqual({ enabled: true, minScore: 0.8 });
  });

  it("fails CLOSED to OFF when the web cookie is absent (401)", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 401, body: { error: "auth required" } }));
    expect(await api(fetchImpl).getAutoApplySettings()).toEqual({ enabled: false, minScore: 0.7 });
  });

  it("fails CLOSED to OFF when the route is missing (404)", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 404, body: { error: "not found" } }));
    expect(await api(fetchImpl).getAutoApplySettings()).toEqual({ enabled: false, minScore: 0.7 });
  });
});

describe("setAutoApplySettings", () => {
  it("PUTs the toggle + threshold to /api/auto-apply", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, body: { enabled: true, minScore: 0.75 } }));
    const s = await api(fetchImpl).setAutoApplySettings({ enabled: true, minScore: 0.75 });
    expect(calls[0]!.url).toBe("http://localhost:3000/api/auto-apply");
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.body).toEqual({ enabled: true, minScore: 0.75 });
    expect(s).toEqual({ enabled: true, minScore: 0.75 });
  });
});

describe("getPlan — vault eligibility, fails closed to free", () => {
  it("returns the server plan", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: { plan: "max" } }));
    expect(await api(fetchImpl).getPlan()).toBe("max");
  });
  it("fails closed to free on 401 (no web cookie)", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 401, body: { error: "auth" } }));
    expect(await api(fetchImpl).getPlan()).toBe("free");
  });
});

describe("refreshSession — the ONE sanctioned session transmission", () => {
  const body = () => ({
    board: "jobinja" as const,
    session: { cookies: [{ name: "jobinja_session", value: "SECRET" }] },
  });

  it("POSTs to /api/session/refresh and returns ok on 200", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: { board: "jobinja", sessionShape: "cookie", lastRefreshed: "now", expiresAt: "later" },
    }));
    const res = await api(fetchImpl).refreshSession(body());
    expect(calls[0]!.url).toBe("http://localhost:3000/api/session/refresh");
    expect(res.ok).toBe(true);
  });

  it("does not throw on tolerated non-2xx (404 missing / 409 not-connected / 503 no-vault)", async () => {
    for (const status of [404, 409, 503]) {
      const { fetchImpl } = fakeFetch(() => ({ status, body: { error: "x" } }));
      const res = await api(fetchImpl).refreshSession(body());
      expect(res.ok).toBe(false);
      expect(res.status).toBe(status);
    }
  });

  it("throws on an unexpected error (e.g. 500)", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 500, body: { error: "boom" } }));
    await expect(api(fetchImpl).refreshSession(body())).rejects.toThrow("boom");
  });
});
