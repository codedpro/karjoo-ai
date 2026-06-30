/**
 * API-client tests with an injected fetch — no network. Verifies the Bearer
 * header carries KARJOO's token (never a board secret), correct paths/methods,
 * and that the connect call sends exactly the metadata payload.
 */
import { describe, it, expect } from "vitest";
import { KarjooApi, ApiError, type FetchImpl } from "@ext/lib/api-client";
import { buildConnectPayload } from "@ext/lib/connect-payload";

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
      body: { user: { id: "u1", phone: "+989120000000", fullName: "علی", isActive: true }, boards: [] },
    }));
    const api = new KarjooApi({ origin: "http://localhost:3000", token: "ext-token-1", fetchImpl });
    const identity = await api.me();
    expect(calls[0]!.url).toBe("http://localhost:3000/api/extension/me");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer ext-token-1");
    // Maps the server `{ user, boards }` shape onto the extension Identity.
    expect(identity).toEqual({ userId: "u1", phone: "+989120000000", displayName: "علی" });
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

  it("throws ApiError with the server message on non-2xx", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 401, body: { error: "unauthorized" } }));
    const api = new KarjooApi({ origin: "http://localhost:3000", token: "t", fetchImpl });
    await expect(api.me()).rejects.toThrow(ApiError);
    await expect(api.me()).rejects.toThrow("unauthorized");
  });
});
