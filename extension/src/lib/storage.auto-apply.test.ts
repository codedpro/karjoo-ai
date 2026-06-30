/**
 * Storage tests for the auto-apply caches + LOCAL session snapshots. Proves the
 * snapshots are device-local and that sign-out (clearSessionToken) wipes the raw
 * session snapshots and the auto-apply caches (no stale session lingers).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getAutoApplySettings,
  setAutoApplySettings,
  getAutoApplyStatus,
  setAutoApplyStatus,
  getSessionSnapshot,
  setSessionSnapshot,
  getSessionSnapshots,
  clearSessionSnapshots,
  setSessionToken,
  clearSessionToken,
  setIdentity,
  DEFAULT_AUTO_APPLY_SETTINGS,
  type StorageArea,
} from "@ext/lib/storage";
import type { SessionSnapshot } from "@ext/lib/session-snapshot";

function makeFakeArea(): StorageArea & { _data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    _data: data,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (k in data) out[k] = data[k];
      return out;
    },
    async set(items) {
      Object.assign(data, items);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete data[k];
    },
  };
}

describe("auto-apply settings cache", () => {
  let area: ReturnType<typeof makeFakeArea>;
  beforeEach(() => (area = makeFakeArea()));

  it("defaults to OFF when nothing is cached (fail-closed)", async () => {
    expect(await getAutoApplySettings(area)).toEqual(DEFAULT_AUTO_APPLY_SETTINGS);
    expect((await getAutoApplySettings(area)).enabled).toBe(false);
  });

  it("round-trips settings", async () => {
    await setAutoApplySettings({ enabled: true, minScore: 0.85 }, area);
    expect(await getAutoApplySettings(area)).toEqual({ enabled: true, minScore: 0.85 });
  });

  it("coerces a malformed cached value back to safe defaults", async () => {
    area._data["karjoo.autoApply.settings"] = { enabled: "yes" };
    const s = await getAutoApplySettings(area);
    expect(s.enabled).toBe(false);
    expect(s.minScore).toBe(0.7);
  });
});

describe("auto-apply status cache", () => {
  let area: ReturnType<typeof makeFakeArea>;
  beforeEach(() => (area = makeFakeArea()));

  it("starts null and round-trips", async () => {
    expect(await getAutoApplyStatus(area)).toBeNull();
    await setAutoApplyStatus({ ranAt: 1, outcome: "applied", submitted: 2, failed: 0 }, area);
    expect((await getAutoApplyStatus(area))?.submitted).toBe(2);
  });
});

describe("LOCAL session snapshots (device-only raw session)", () => {
  let area: ReturnType<typeof makeFakeArea>;
  beforeEach(() => (area = makeFakeArea()));

  const snap: SessionSnapshot = {
    board: "jobinja",
    shape: "cookie",
    cookies: [{ name: "jobinja_session", value: "SECRET" }],
    capturedAt: 123,
  };

  it("stores and reads back per board", async () => {
    await setSessionSnapshot(snap, area);
    expect(await getSessionSnapshot("jobinja", area)).toEqual(snap);
    expect(await getSessionSnapshot("jobvision", area)).toBeNull();
  });

  it("keeps multiple boards in the map", async () => {
    await setSessionSnapshot(snap, area);
    await setSessionSnapshot({ board: "jobvision", shape: "token", storage: { localStorage: { t: "x" } }, capturedAt: 1 }, area);
    const all = await getSessionSnapshots(area);
    expect(Object.keys(all).sort()).toEqual(["jobinja", "jobvision"]);
  });

  it("clearSessionSnapshots wipes them", async () => {
    await setSessionSnapshot(snap, area);
    await clearSessionSnapshots(area);
    expect(await getSessionSnapshots(area)).toEqual({});
  });
});

describe("sign-out wipes raw session + auto-apply caches", () => {
  it("clearSessionToken removes the session snapshots and auto-apply caches", async () => {
    const area = makeFakeArea();
    await setSessionToken("ext-token", area);
    await setIdentity({ userId: "u1" }, area);
    await setSessionSnapshot(
      { board: "jobinja", shape: "cookie", cookies: [{ name: "s", value: "SECRET" }], capturedAt: 1 },
      area,
    );
    await setAutoApplySettings({ enabled: true, minScore: 0.7 }, area);
    await setAutoApplyStatus({ ranAt: 1, outcome: "applied", submitted: 1, failed: 0 }, area);

    await clearSessionToken(area);

    expect(await getSessionSnapshots(area)).toEqual({});
    expect(await getAutoApplyStatus(area)).toBeNull();
    // No raw session value survives sign-out.
    expect(JSON.stringify(area._data)).not.toContain("SECRET");
  });
});
