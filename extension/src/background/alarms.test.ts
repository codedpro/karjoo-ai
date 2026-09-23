/**
 * Background alarm scheduling.
 *
 * setupAutoApplyAlarms runs on EVERY service-worker wake, and Chrome's
 * alarms.create cancels and reschedules an existing alarm of the same name. So
 * recreating unconditionally kept pushing the 30-minute session push another 30
 * minutes out every time the worker woke — roughly every minute — and sessions
 * rarely reached the vault. These tests pin the fix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AlarmInfo = { delayInMinutes?: number; periodInMinutes?: number };

function fakeAlarms(existing: string[] = []) {
  const alarms = new Map<string, AlarmInfo>(existing.map((name) => [name, { periodInMinutes: 1 }]));
  const created: Array<{ name: string; info: AlarmInfo }> = [];
  return {
    alarms,
    created,
    api: {
      get: (name: string, cb: (alarm?: { name: string }) => void) =>
        cb(alarms.has(name) ? { name } : undefined),
      create: (name: string, info: AlarmInfo) => {
        created.push({ name, info });
        alarms.set(name, info);
      },
    },
  };
}

async function loadSetup() {
  vi.resetModules();
  return (await import("@ext/background/auto-apply")).setupAutoApplyAlarms;
}

describe("setupAutoApplyAlarms", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("creates both alarms on a fresh install", async () => {
    const fake = fakeAlarms();
    vi.stubGlobal("chrome", { alarms: fake.api });
    (await loadSetup())();
    expect(fake.created.map((c) => c.name).sort()).toHaveLength(2);
  });

  it("does NOT reschedule alarms that already exist — the bug", async () => {
    const fake = fakeAlarms();
    vi.stubGlobal("chrome", { alarms: fake.api });
    const setup = await loadSetup();
    setup();
    const firstCount = fake.created.length;
    // Simulate the worker waking up again, many times.
    for (let wake = 0; wake < 10; wake += 1) setup();
    expect(fake.created).toHaveLength(firstCount);
  });

  it("schedules the first session push a minute out, not a full period", async () => {
    const fake = fakeAlarms();
    vi.stubGlobal("chrome", { alarms: fake.api });
    (await loadSetup())();
    const session = fake.created.find((c) => c.info.delayInMinutes !== undefined);
    expect(session?.info.delayInMinutes).toBe(1);
    expect(session?.info.periodInMinutes).toBeGreaterThan(1);
  });

  it("is a no-op without the alarms API", async () => {
    vi.stubGlobal("chrome", {});
    expect(() => {
      void loadSetup().then((setup) => setup());
    }).not.toThrow();
  });
});
