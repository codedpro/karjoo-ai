/**
 * API-client tests — the control-plane contract, with fetch MOCKED (no network).
 *
 * Covers: Bearer credential on every authed call; enroll response parsing; the
 * tolerant claim/commands wrappers; result reporting that does NOT throw on 429/404
 * (so the agent can read the cap signal); and an unexpected non-2xx throwing.
 */
import { describe, expect, it } from "vitest";

import {
  ApiError,
  KarjooFleetApi,
  extractCommands,
  extractJobs,
} from "./api-client.js";
import { callBody, callHeaders, callUrl, mockFetch } from "../test/mock-fetch.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("KarjooFleetApi auth", () => {
  it("attaches the node credential as Bearer on authed calls", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(200, { node: {} }));
    const api = new KarjooFleetApi({ apiBase: "https://k.test", credential: "CRED-1", fetchImpl });
    await api.heartbeat({ health: "online" });
    expect(callHeaders(fetchImpl, 0).get("authorization")).toBe("Bearer CRED-1");
  });

  it("setCredential makes later calls authenticated", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(200, {}));
    const api = new KarjooFleetApi({ apiBase: "https://k.test", fetchImpl });
    api.setCredential("LATER");
    await api.heartbeat({});
    expect(callHeaders(fetchImpl, 0).get("authorization")).toBe("Bearer LATER");
  });
});

describe("enroll", () => {
  it("parses the credential + node id from a 201", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(201, { credential: "C", node: { id: "n1" } }));
    const api = new KarjooFleetApi({ apiBase: "https://k.test", fetchImpl });
    const res = await api.enroll({ enrollmentToken: "tok", nodeKey: "k" });
    expect(res).toEqual({ credential: "C", nodeId: "n1" });
  });

  it("throws ApiError(503) when enrollment is closed", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(503, { error: "fleet enrollment closed" }));
    const api = new KarjooFleetApi({ apiBase: "https://k.test", fetchImpl });
    await expect(api.enroll({ enrollmentToken: "tok", nodeKey: "k" })).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe("claim — tolerant wrapper", () => {
  it("reads { jobs: [...] }", async () => {
    const job = { taskId: "t", userId: "u", board: "jobinja", listingUrl: "x", coverLetter: null, session: "{}" };
    const fetchImpl = mockFetch(() => jsonResponse(200, { jobs: [job] }));
    const api = new KarjooFleetApi({ apiBase: "https://k.test", credential: "c", fetchImpl });
    const jobs = await api.claim(5);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.taskId).toBe("t");
    // The limit was sent.
    expect(callBody(fetchImpl, 0).limit).toBe(5);
  });

  it("reads a bare array and { items }", () => {
    expect(extractJobs([{ taskId: "a" }])).toHaveLength(1);
    expect(extractJobs({ items: [{ taskId: "b" }] })).toHaveLength(1);
    expect(extractJobs({})).toHaveLength(0);
    expect(extractJobs(null)).toHaveLength(0);
  });
});

describe("reportResult — cap + ownership signals do not throw", () => {
  it("returns status 429 (daily cap) without throwing", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(429, { error: "quota" }));
    const api = new KarjooFleetApi({ apiBase: "https://k.test", credential: "c", fetchImpl });
    const res = await api.reportResult({ taskId: "t", userId: "u", status: "submitted" });
    expect(res).toEqual({ ok: false, status: 429 });
  });

  it("returns status 404 (not this user's task) without throwing", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(404, { error: "not found" }));
    const api = new KarjooFleetApi({ apiBase: "https://k.test", credential: "c", fetchImpl });
    const res = await api.reportResult({ taskId: "t", userId: "u", status: "failed" });
    expect(res).toEqual({ ok: false, status: 404 });
  });

  it("throws on an unexpected 500", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(500, { error: "boom" }));
    const api = new KarjooFleetApi({ apiBase: "https://k.test", credential: "c", fetchImpl });
    await expect(
      api.reportResult({ taskId: "t", userId: "u", status: "submitted" }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("sends only the provided optional fields", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(200, {}));
    const api = new KarjooFleetApi({ apiBase: "https://k.test", credential: "c", fetchImpl });
    await api.reportResult({ taskId: "t", userId: "u", status: "skipped", reason: "scaffold" });
    expect(callBody(fetchImpl, 0)).toEqual({ taskId: "t", userId: "u", status: "skipped", reason: "scaffold" });
  });
});

describe("commands", () => {
  it("polls + extracts commands from tolerant wrappers", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse(200, { commands: [{ id: "c1", command: "update", payload: null }] }),
    );
    const api = new KarjooFleetApi({ apiBase: "https://k.test", credential: "c", fetchImpl });
    const cmds = await api.pollCommands();
    expect(cmds[0]!.id).toBe("c1");
    expect(extractCommands([{ id: "x", command: "restart" }])).toHaveLength(1);
    expect(extractCommands({ items: [{ id: "y", command: "update" }] })).toHaveLength(1);
  });

  it("acks a command with status + result", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(200, { command: {} }));
    const api = new KarjooFleetApi({ apiBase: "https://k.test", credential: "c", fetchImpl });
    await api.ackCommand("c1", "done", { code: 0 });
    expect(callUrl(fetchImpl, 0)).toContain("/api/fleet/commands/c1/ack");
    expect(callBody(fetchImpl, 0)).toEqual({ status: "done", result: { code: 0 } });
  });
});
