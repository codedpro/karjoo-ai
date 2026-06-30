/**
 * Server-commanded auto-update handler (§ rule 4).
 *
 * The server issues 'update' / 'restart' commands; the node polls them, executes,
 * and acks. This module decides what to DO for each command:
 *   • 'update'  → run the configured update script (pull + restart, deployment-
 *                 agnostic) then ack 'done' (or 'failed' with the error). The script
 *                 path comes from the command payload.updateScript when present
 *                 (the server injects fleetUpdateScript() there) else the node's
 *                 configured KARJOO_FLEET_UPDATE_SCRIPT.
 *   • 'restart' → ack 'done' then ask the supervisor to restart us (exit). The
 *                 supervisor (systemd/pm2/docker) brings the node back up.
 *
 * The script execution + process exit are injected so this is fully unit-tested
 * without spawning a real process or killing the test runner.
 */
import type { KarjooFleetApi } from "./api-client.js";
import type { WorkerConfig } from "./config.js";
import { Logger, logger as defaultLogger } from "./logger.js";
import type { WorkerCommand } from "./types.js";

/** Result of running the update script. */
export interface ScriptResult {
  code: number;
  /** Short, non-secret stdout/stderr tail for the ack (truncated by the logger anyway). */
  output?: string;
}

/** Runs a shell script and resolves with its exit code (injectable for tests). */
export type ScriptRunner = (script: string) => Promise<ScriptResult>;

/** Requests a process restart (injectable; default exits so the supervisor restarts us). */
export type RestartFn = () => void;

export interface CommandDeps {
  runScript: ScriptRunner;
  restart?: RestartFn;
  logger?: Logger;
}

/** Resolve the update script: payload override → node config default. */
export function resolveUpdateScript(
  command: WorkerCommand,
  cfg: Pick<WorkerConfig, "updateScript">,
): string {
  const fromPayload = command.payload?.updateScript;
  if (typeof fromPayload === "string" && fromPayload.trim()) return fromPayload.trim();
  return cfg.updateScript;
}

/**
 * Handle one command end-to-end: ack 'acked', execute, then ack 'done'/'failed'.
 * Returns true when a restart/exit was requested (the caller stops the loop).
 *
 * Order of acks (matches the server lifecycle pending→acked→done|failed):
 *   1. ack 'acked' immediately (the node took the command).
 *   2. execute.
 *   3. ack 'done' or 'failed' with the result.
 * For 'restart' we ack 'done' BEFORE exiting (so the server records completion),
 * then request the restart.
 */
export async function handleCommand(
  command: WorkerCommand,
  api: KarjooFleetApi,
  cfg: Pick<WorkerConfig, "updateScript">,
  deps: CommandDeps,
): Promise<{ restarted: boolean }> {
  const log = deps.logger ?? defaultLogger;
  const restart = deps.restart ?? (() => process.exit(0));

  await safeAck(api, command.id, "acked", undefined, log);

  if (command.command === "update") {
    const script = resolveUpdateScript(command, cfg);
    log.info("running update command", { commandId: command.id, script });
    try {
      const res = await deps.runScript(script);
      if (res.code === 0) {
        await safeAck(api, command.id, "done", { code: res.code }, log);
        log.info("update command done", { commandId: command.id });
      } else {
        await safeAck(api, command.id, "failed", { code: res.code, output: res.output }, log);
        log.warn("update command failed", { commandId: command.id, code: res.code });
      }
    } catch (err) {
      await safeAck(api, command.id, "failed", { error: errMessage(err) }, log);
      log.error("update command threw", { commandId: command.id, error: errMessage(err) });
    }
    return { restarted: false };
  }

  if (command.command === "restart") {
    log.info("running restart command", { commandId: command.id });
    await safeAck(api, command.id, "done", { restarted: true }, log);
    restart();
    return { restarted: true };
  }

  // Unknown command: ack failed so the server sees we could not run it.
  await safeAck(api, command.id, "failed", { error: "unknown command" }, log);
  return { restarted: false };
}

/**
 * Process all pending commands in order. Stops early (and returns restarted:true)
 * once a command requested a restart — no point running further commands before
 * the process bounces.
 */
export async function processCommands(
  commands: WorkerCommand[],
  api: KarjooFleetApi,
  cfg: Pick<WorkerConfig, "updateScript">,
  deps: CommandDeps,
): Promise<{ restarted: boolean }> {
  for (const command of commands) {
    const { restarted } = await handleCommand(command, api, cfg, deps);
    if (restarted) return { restarted: true };
  }
  return { restarted: false };
}

/** Ack without letting an ack failure crash command handling. */
async function safeAck(
  api: KarjooFleetApi,
  commandId: string,
  status: "acked" | "done" | "failed",
  result: Record<string, unknown> | undefined,
  log: Logger,
): Promise<void> {
  try {
    await api.ackCommand(commandId, status, result);
  } catch (err) {
    log.warn("command ack failed", { commandId, status, error: errMessage(err) });
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The default script runner: spawn the script via the shell and resolve with its
 * exit code + a short output tail. Imported lazily so the unit tests (which inject
 * a fake runner) never spawn a child process.
 */
export const spawnScriptRunner: ScriptRunner = async (script) => {
  const { spawn } = await import("node:child_process");
  return new Promise<ScriptResult>((resolve) => {
    const child = spawn(script, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
      if (out.length > 4000) out = out.slice(-4000);
    });
    child.stderr?.on("data", (d: Buffer) => {
      out += d.toString();
      if (out.length > 4000) out = out.slice(-4000);
    });
    child.on("error", (err) => resolve({ code: 1, output: String(err) }));
    child.on("close", (code) => resolve({ code: code ?? 0, output: out.slice(-1000) }));
  });
};
