#!/usr/bin/env bash
#
# Karjoo fleet-worker deploy — push the worker to a remote node over SSH.
#
# WHY A NODE IS REMOTE AT ALL: the boards that matter (Jobinja, JobVision,
# Karboom, IranTalent) sit behind ArvanCloud, which accepts the TCP connection
# from a non-Iranian address and then never answers the TLS handshake. The
# control-plane host is not in Iran, so a worker running there reaches nothing.
# The node has to run from an Iranian IP; that is the whole point of the fleet.
#
# WHY ONLY THE WORKER SUBTREE: a node is untrusted by design (architecture rule:
# stateless / untrusted / ephemeral). It gets the worker code and its OWN node
# credential — never the repo, never a git credential, never the vault key, never
# the database. Per-job sessions arrive over the API and are discarded after use.
# That is also why this pushes with rsync instead of cloning the repo there.
#
#   ./scripts/deploy-worker.sh <ssh-host> [remote-dir]
#
# Idempotent: re-running it re-syncs, rebuilds and restarts. Enrollment happens
# once on first start; the node then authenticates with its persisted credential,
# so the enrollment token is only needed until that file exists.
set -euo pipefail

HOST="${1:-}"
REMOTE_DIR="${2:-/home/claude/karjoo-worker}"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/worker"
ENV_FILE="/etc/karjoo-worker.env"
SERVICE="karjoo-worker"

if [ -z "${HOST}" ]; then
  echo "usage: $0 <ssh-host> [remote-dir]" >&2
  exit 1
fi

echo "==> syncing worker source to ${HOST}:${REMOTE_DIR}"
ssh "${HOST}" "mkdir -p '${REMOTE_DIR}'"
# node_modules/dist/test artifacts are rebuilt remotely; .karjoo-worker holds the
# node's own credential and must NEVER be overwritten from here.
rsync -az --delete \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude '.karjoo-worker/' \
  --exclude '*.log' \
  "${LOCAL_DIR}/" "${HOST}:${REMOTE_DIR}/"

echo "==> installing + building on ${HOST}"
ssh "${HOST}" "set -e
  cd '${REMOTE_DIR}'
  npm ci --no-audit --no-fund >/dev/null
  npm run build >/dev/null
  test -f dist/main.js || { echo 'build produced no dist/main.js' >&2; exit 1; }
  echo 'build ok'"

echo "==> restarting ${SERVICE}"
ssh "${HOST}" "sudo systemctl restart '${SERVICE}' && sleep 3 && sudo systemctl is-active '${SERVICE}'"

echo "==> recent log"
ssh "${HOST}" "sudo journalctl -u '${SERVICE}' -n 15 --no-pager -o cat"

echo "deploy complete (env: ${ENV_FILE} on the node)"
