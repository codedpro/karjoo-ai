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

# A worker that exists but stopped ticking is worse than one that died: the process
# holds the slot, so this script kept exiting happily while the node had not
# heartbeated for over an hour. So "running" now means *alive AND ticking*.
#
# Liveness signal: the worker appends a line to the log every loop interval, so a log
# older than STALE_AFTER_SEC means the loop is wedged even if the pid is there.
STALE_AFTER_SEC=300

worker_running() {
  local pid cwd found=1
  for pid in $(pgrep -f "dist/main\.js" 2>/dev/null); do
    cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
    if [ "${cwd}" = "${WORKER_DIR}" ]; then
      found=0
      break
    fi
  done
  [ "${found}" -eq 0 ] || return 1

  # A pid exists — is it still ticking?
  if [ -f "${LOG}" ]; then
    local age
    age=$(( $(date +%s) - $(stat -c %Y "${LOG}" 2>/dev/null || echo 0) ))
    if [ "${age}" -gt "${STALE_AFTER_SEC}" ]; then
      echo "$(date -Is) [keepalive] worker pid alive but log stale (${age}s) — treating as hung" >> "${LOG}"
      return 1
    fi
  fi
  return 0
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
