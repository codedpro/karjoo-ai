/**
 * Karjoo worker-node entrypoint.
 *
 * Wires the real adapters and runs the agent:
 *   1. load config from env (fail fast if missing),
 *   2. ensure a credential (load persisted, or enroll once with the token),
 *   3. run the main loop (heartbeat → claim → process → commands).
 *
 * The real adapters are: the global fetch, the playwright-core launcher, the
 * shell script runner, and process.exit for restart. All of these are injectable
 * (see agent.ts) and MOCKED in the unit tests — main.ts itself just composes them.
 *
 * Run on a VM:  KARJOO_API=… KARJOO_NODE_KEY=… KARJOO_FLEET_ENROLLMENT_TOKEN=… \
 *               KARJOO_BROWSER_PATH=/usr/bin/chromium  node dist/main.js
 */
import { KarjooFleetApi } from "./lib/api-client.js";
import { loadConfig, WorkerConfigError } from "./lib/config.js";
import { ensureCredential, EnrollmentError } from "./lib/enroll.js";
import { runLoop, realSleep } from "./lib/agent.js";
import { launchChromium } from "./lib/browser.js";
import { spawnScriptRunner } from "./lib/commands.js";
import { logger } from "./lib/logger.js";

async function main(): Promise<void> {
  let cfg;
  try {
    cfg = loadConfig(process.env);
  } catch (err) {
    if (err instanceof WorkerConfigError) {
      logger.error("invalid config", { error: err.message });
      process.exit(2);
    }
    throw err;
  }

  if (!cfg.browserExecutablePath) {
    logger.warn(
      "KARJOO_BROWSER_PATH is unset — set it to a system Chromium (we never download one). " +
        "Best-effort apply jobs will fail to launch a browser until it is configured.",
    );
  }

  const api = new KarjooFleetApi({ apiBase: cfg.apiBase });

  // Ensure we have a credential (load persisted, or enroll once).
  try {
    await ensureCredential(api, cfg);
  } catch (err) {
    if (err instanceof EnrollmentError) {
      logger.error("enrollment failed", { error: err.message });
      process.exit(3);
    }
    logger.error("could not obtain credential", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(3);
  }

  // Graceful shutdown: stop after the current tick on SIGINT/SIGTERM.
  let stopping = false;
  const stop = () => {
    if (!stopping) logger.info("shutdown signal received; stopping after current tick");
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await runLoop(
    {
      api,
      cfg,
      launchBrowser: launchChromium,
      runScript: spawnScriptRunner,
      restart: () => process.exit(0),
      sleep: realSleep,
    },
    { stopped: () => stopping },
  );

  logger.info("worker exiting");
  process.exit(0);
}

main().catch((err) => {
  logger.error("fatal", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
