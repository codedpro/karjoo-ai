/**
 * When may the server fleet take a user's queue from the extension?
 *
 * The case this exists for: the user closes Chrome without pressing Stop. The run
 * stays owned by an extension that no longer exists, and before this rule the
 * server — with sessions, a queue and an online node — refused to work forever.
 * The opposite failure matters just as much: the server must never override a
 * browser that is actually running, or a queue the user deliberately paused.
 */
import { describe, expect, it } from "vitest";

import {
  STALE_RUN_MS,
  serverMayTakeRun,
  type ExecutionRunView,
} from "@/lib/apply/execution-run";

const NOW = Date.parse("2026-09-23T06:00:00Z");

function run(overrides: Partial<ExecutionRunView>): ExecutionRunView {
  return {
    state: "running",
    owner: "extension",
    executorId: "browser-1",
    board: "jobinja",
    currentTaskId: null,
    progress: {},
    blockedReason: null,
    backgroundEnabled: true,
    heartbeatAt: new Date(NOW).toISOString(),
    startedAt: null,
    blockedAt: null,
    updatedAt: null,
    ...overrides,
  };
}

const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("serverMayTakeRun", () => {
  it("takes an unowned run or one it already owns", () => {
    expect(serverMayTakeRun(run({ owner: null, state: "paused" }), NOW)).toBe(true);
    expect(serverMayTakeRun(run({ owner: "server" }), NOW)).toBe(true);
  });

  it("never overrides a browser that is still heartbeating", () => {
    // The extension ticks at least once a minute while Chrome is open.
    expect(serverMayTakeRun(run({ heartbeatAt: ago(60_000) }), NOW)).toBe(false);
    expect(serverMayTakeRun(run({ heartbeatAt: ago(STALE_RUN_MS - 1_000) }), NOW)).toBe(false);
  });

  it("takes over once the browser has gone silent — Chrome was closed", () => {
    expect(serverMayTakeRun(run({ heartbeatAt: ago(STALE_RUN_MS + 1_000) }), NOW)).toBe(true);
    expect(serverMayTakeRun(run({ heartbeatAt: ago(6 * 60 * 60 * 1000) }), NOW)).toBe(true);
  });

  it("treats a running extension run with no heartbeat at all as gone", () => {
    expect(serverMayTakeRun(run({ heartbeatAt: null }), NOW)).toBe(true);
  });

  it("respects a queue the user deliberately paused, however old", () => {
    // Pause means "stop applying", not "I left". The server must not undo it.
    expect(serverMayTakeRun(run({ state: "paused", heartbeatAt: ago(7 * 86_400_000) }), NOW)).toBe(
      false,
    );
  });

  it("never touches a blocked run — only a person can clear that", () => {
    expect(serverMayTakeRun(run({ state: "blocked", owner: null }), NOW)).toBe(false);
    expect(serverMayTakeRun(run({ state: "blocked", owner: "server" }), NOW)).toBe(false);
    expect(
      serverMayTakeRun(run({ state: "blocked", heartbeatAt: ago(86_400_000) }), NOW),
    ).toBe(false);
  });
});
