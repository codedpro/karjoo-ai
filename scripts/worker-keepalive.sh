#!/usr/bin/env bash
#
# Karjoo fleet-worker keepalive supervisor (sudo-free, cron-driven).
#
# Ensures EXACTLY ONE worker node runs on this host. It detects a running worker by
# checking whether any `node dist/main.js` process has the worker dir as its cwd — so
# a pre-existing (even orphaned) instance is recognized and NOT duplicated. If none is
# running (crash / reboot), it launches a fresh one from the current build.
#
# It never signals/kills the existing process; it only fills a gap.
#
set -uo pipefail

WORKER_DIR="/home/website-dev/karjoo-ai/worker"
LOG_DIR="/home/website-dev/karjoo-ai/logs"
LOG="${LOG_DIR}/worker.log"

mkdir -p "${LOG_DIR}"

# Is a worker (cwd == WORKER_DIR, running dist/main.js) already alive?
worker_running() {
  local pid cwd
  for pid in $(pgrep -f "dist/main\.js" 2>/dev/null); do
    cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
    if [ "${cwd}" = "${WORKER_DIR}" ]; then
      return 0
    fi
  done
  return 1
}

if worker_running; then
  exit 0
fi

echo "$(date -Is) [keepalive] no worker running — launching a fresh node" >> "${LOG}"
cd "${WORKER_DIR}" || exit 1

KARJOO_API="http://127.0.0.1:3030" \
KARJOO_NODE_KEY="karjoo-local-prod-1" \
KARJOO_BROWSER_PATH="/usr/bin/google-chrome-stable" \
KARJOO_HEADLESS="true" \
KARJOO_NODE_REGION="local-host" \
KARJOO_AGENT_VERSION="0.1.0" \
KARJOO_LOOP_INTERVAL_SEC="60" \
setsid nohup node dist/main.js >> "${LOG}" 2>&1 &

echo "$(date -Is) [keepalive] launched worker pid=$!" >> "${LOG}"
