/**
 * Enrollment + credential-persistence tests.
 *
 * Covers: first-run enroll → credential persisted (0600 path) → set on the client;
 * second-run reuse of the persisted credential (no re-enroll); re-enroll when the
 * persisted credential is for a different node key; fatal when neither a credential
 * nor a token is available; and that the raw credential never enters a log line.
 */
import { describe, expect, it, vi } from "vitest";

import { KarjooFleetApi } from "./api-client.js";
import { ensureCredential, EnrollmentError } from "./enroll.js";
import { loadConfig } from "./config.js";
import type { CredentialFs } from "./credential-store.js";
import { Logger, type LogLevel } from "./logger.js";
import { callBody, callHeaders, mockFetch } from "../test/mock-fetch.js";

/** An in-memory credential FS. */
function memFs(initial: Record<string, string> = {}): CredentialFs & { files: Record<string, string> } {
  const files: Record<string, string> = { ...initial };
  return {
    files,
    async read(path) {
      if (!(path in files)) {
        const err = new Error("ENOENT") as Error & { code: string };
        err.code = "ENOENT";
        throw err;
      }
      return files[path]!;
    },
    async write(path, data) {
      files[path] = data;
    },
    async mkdirp() {
      /* no-op */
    },
  };
}

function captureLogger() {
  const lines: string[] = [];
  return {
    lines,
    logger: new Logger({ write: (_l: LogLevel, line: string) => void lines.push(line) }, () => "T"),
  };
}

const BASE_ENV = {
  KARJOO_API: "https://karjoo.test",
  KARJOO_NODE_KEY: "node-eu-1",
  KARJOO_FLEET_ENROLLMENT_TOKEN: "enroll-token-abcdef0123456789",
  KARJOO_CREDENTIAL_PATH: "/data/cred.json",
};

describe("ensureCredential — first run", () => {
  it("enrolls, persists the credential, and sets it on the client", async () => {
    const cfg = loadConfig(BASE_ENV);
    const fs = memFs();
    const fetchImpl = mockFetch((_url, init) => {
      // First call = enroll (has an enrollmentToken body); later = heartbeat.
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
      return "enrollmentToken" in body
        ? jsonResponse(201, { credential: "RAW-CREDENTIAL-XYZ", node: { id: "srv-node-1" } })
        : jsonResponse(200, { node: {} });
    });
    const api = new KarjooFleetApi({ apiBase: cfg.apiBase, fetchImpl });
    const { lines, logger } = captureLogger();

    const rec = await ensureCredential(api, cfg, { fs, logger, nowIso: () => "2026-06-30T00:00:00.000Z" });

    // Persisted with the right shape.
    expect(rec.credential).toBe("RAW-CREDENTIAL-XYZ");
    expect(rec.nodeId).toBe("srv-node-1");
    expect(rec.nodeKey).toBe("node-eu-1");
    expect(fs.files["/data/cred.json"]).toContain("RAW-CREDENTIAL-XYZ");

    // The enroll call sent the token + node key.
    const body = callBody(fetchImpl, 0);
    expect(body.enrollmentToken).toBe("enroll-token-abcdef0123456789");
    expect(body.nodeKey).toBe("node-eu-1");

    // The credential is now used as Bearer on the next call.
    await api.heartbeat({ health: "online" });
    expect(callHeaders(fetchImpl, 1).get("authorization")).toBe("Bearer RAW-CREDENTIAL-XYZ");

    // The raw credential never appears in a log line.
    expect(lines.join("\n")).not.toContain("RAW-CREDENTIAL-XYZ");
  });
});

describe("ensureCredential — subsequent runs", () => {
  it("reuses a persisted credential and does NOT re-enroll", async () => {
    const cfg = loadConfig(BASE_ENV);
    const fs = memFs({
      "/data/cred.json": JSON.stringify({
        credential: "PERSISTED-CRED",
        nodeId: "srv-node-1",
        nodeKey: "node-eu-1",
        enrolledAt: "2026-06-01T00:00:00.000Z",
      }),
    });
    const fetchImpl = mockFetch(() => jsonResponse(500, { error: "should not be called" }));
    const api = new KarjooFleetApi({ apiBase: cfg.apiBase, fetchImpl });

    const rec = await ensureCredential(api, cfg, { fs });
    expect(rec.credential).toBe("PERSISTED-CRED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("re-enrolls when the persisted credential is for a different node key", async () => {
    const cfg = loadConfig({ ...BASE_ENV, KARJOO_NODE_KEY: "node-eu-2" });
    const fs = memFs({
      "/data/cred.json": JSON.stringify({
        credential: "OLD-CRED",
        nodeId: "srv-node-1",
        nodeKey: "node-eu-1",
        enrolledAt: "2026-06-01T00:00:00.000Z",
      }),
    });
    const fetchImpl = mockFetch(() =>
      jsonResponse(201, { credential: "NEW-CRED", node: { id: "srv-node-2" } }),
    );
    const api = new KarjooFleetApi({ apiBase: cfg.apiBase, fetchImpl });

    const rec = await ensureCredential(api, cfg, { fs });
    expect(rec.credential).toBe("NEW-CRED");
    expect(rec.nodeKey).toBe("node-eu-2");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("ensureCredential — failure modes", () => {
  it("throws EnrollmentError when there is no credential and no token", async () => {
    const cfg = loadConfig({ ...BASE_ENV, KARJOO_FLEET_ENROLLMENT_TOKEN: "" });
    const fs = memFs(); // empty → no persisted credential
    const api = new KarjooFleetApi({ apiBase: cfg.apiBase, fetchImpl: vi.fn() });
    await expect(ensureCredential(api, cfg, { fs })).rejects.toBeInstanceOf(EnrollmentError);
  });
});

/** Build a fake Response with a JSON body. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
