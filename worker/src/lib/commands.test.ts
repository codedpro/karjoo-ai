/**
 * Command-handling tests — server-commanded auto-update (rule 4), no real spawn.
 *
 * Covers: 'update' runs the configured script then acks done (and failed on a
 * non-zero exit / a throw); the payload.updateScript overrides the node default;
 * 'restart' acks done THEN requests a restart; the ack lifecycle is acked→done;
 * an ack failure does not crash handling; and processCommands stops at a restart.
 */
import { describe, expect, it, vi } from "vitest";

import {
  handleCommand,
  processCommands,
  resolveUpdateScript,
  type CommandDeps,
} from "./commands.js";
import { KarjooFleetApi } from "./api-client.js";
import type { WorkerCommand } from "./types.js";

/** An api whose ackCommand is a spy. */
function spyApi(): { api: KarjooFleetApi; acks: { id: string; status: string; result?: unknown }[] } {
  const acks: { id: string; status: string; result?: unknown }[] = [];
  const api = new KarjooFleetApi({ apiBase: "https://k.test", credential: "c", fetchImpl: vi.fn() });
  api.ackCommand = vi.fn(async (id: string, status: "acked" | "done" | "failed", result?: Record<string, unknown>) => {
    acks.push({ id, status, result });
  });
  return { api, acks };
}

const CFG = { updateScript: "./update.sh" };

describe("resolveUpdateScript", () => {
  it("prefers payload.updateScript over the node default", () => {
    const cmd: WorkerCommand = { id: "c", command: "update", payload: { updateScript: "/srv/u.sh" } };
    expect(resolveUpdateScript(cmd, CFG)).toBe("/srv/u.sh");
  });
  it("falls back to the node default", () => {
    const cmd: WorkerCommand = { id: "c", command: "update", payload: null };
    expect(resolveUpdateScript(cmd, CFG)).toBe("./update.sh");
  });
});

describe("handleCommand — update", () => {
  it("runs the script and acks acked→done on success", async () => {
    const { api, acks } = spyApi();
    const runScript = vi.fn(async () => ({ code: 0, output: "ok" }));
    const deps: CommandDeps = { runScript };
    const cmd: WorkerCommand = { id: "u1", command: "update", payload: { updateScript: "/x.sh" } };

    const res = await handleCommand(cmd, api, CFG, deps);
    expect(res.restarted).toBe(false);
    expect(runScript).toHaveBeenCalledWith("/x.sh");
    expect(acks.map((a) => a.status)).toEqual(["acked", "done"]);
  });

  it("acks failed on a non-zero exit code", async () => {
    const { api, acks } = spyApi();
    const runScript = vi.fn(async () => ({ code: 1, output: "boom" }));
    const cmd: WorkerCommand = { id: "u2", command: "update", payload: null };
    await handleCommand(cmd, api, CFG, { runScript });
    expect(acks.map((a) => a.status)).toEqual(["acked", "failed"]);
  });

  it("acks failed when the script throws", async () => {
    const { api, acks } = spyApi();
    const runScript = vi.fn(async () => {
      throw new Error("spawn EACCES");
    });
    const cmd: WorkerCommand = { id: "u3", command: "update", payload: null };
    await handleCommand(cmd, api, CFG, { runScript });
    expect(acks.at(-1)?.status).toBe("failed");
  });
});

describe("handleCommand — restart", () => {
  it("acks done then requests a restart", async () => {
    const { api, acks } = spyApi();
    const restart = vi.fn();
    const cmd: WorkerCommand = { id: "r1", command: "restart", payload: null };
    const res = await handleCommand(cmd, api, CFG, { runScript: vi.fn(), restart });
    expect(res.restarted).toBe(true);
    expect(restart).toHaveBeenCalledOnce();
    // acked, then done BEFORE exiting.
    expect(acks.map((a) => a.status)).toEqual(["acked", "done"]);
  });
});

describe("handleCommand — resilience", () => {
  it("does not crash when an ack fails", async () => {
    const api = new KarjooFleetApi({ apiBase: "https://k.test", credential: "c", fetchImpl: vi.fn() });
    api.ackCommand = vi.fn(async () => {
      throw new Error("network down");
    });
    const cmd: WorkerCommand = { id: "u", command: "update", payload: null };
    await expect(
      handleCommand(cmd, api, CFG, { runScript: vi.fn(async () => ({ code: 0 })) }),
    ).resolves.toEqual({ restarted: false });
  });
});

describe("processCommands", () => {
  it("stops processing once a restart is requested", async () => {
    const { api } = spyApi();
    const runScript = vi.fn(async () => ({ code: 0 }));
    const restart = vi.fn();
    const cmds: WorkerCommand[] = [
      { id: "u1", command: "update", payload: null },
      { id: "r1", command: "restart", payload: null },
      { id: "u2", command: "update", payload: null }, // must NOT run
    ];
    const res = await processCommands(cmds, api, CFG, { runScript, restart });
    expect(res.restarted).toBe(true);
    // update ran once (u1); u2 after the restart did not.
    expect(runScript).toHaveBeenCalledTimes(1);
  });
});
