#!/usr/bin/env bash
#
# Karjoo worker-node update script (server-commanded auto-update — fleet rule 4).
#
# The server issues an 'update' command; the node polls it and runs THIS script
# (path comes from the command payload.updateScript, else KARJOO_FLEET_UPDATE_SCRIPT,
# default ./update.sh). It is deployment-agnostic: pull the latest code, reinstall,
# rebuild, then restart via the supervisor. Edit it to match YOUR deployment.
#
# It must be idempotent and exit 0 on success (the node acks 'done') or non-zero on
# failure (the node acks 'failed' with the exit code). Keep it quiet about secrets —
# never echo the node credential or any session material.
#
set -euo pipefail

cd "$(dirname "$0")"

echo "[update] pulling latest…"
git fetch --all --prune
git reset --hard "@{upstream}"

echo "[update] installing deps (no browser download)…"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm ci --omit=dev || npm install --omit=dev

echo "[update] building…"
npm run build

# Restart via your supervisor. Pick the one you use; the others are examples.
#   systemd : sudo systemctl restart karjoo-worker
#   pm2     : pm2 restart karjoo-worker
#   docker  : docker compose up -d --build karjoo-worker
#
# Default: ask systemd to restart the unit. Adjust to your environment.
if command -v systemctl >/dev/null 2>&1; then
  echo "[update] restarting via systemd…"
  sudo systemctl restart karjoo-worker || true
else
  echo "[update] no systemd; the worker will also restart itself on a 'restart' command."
fi

echo "[update] done."
