#!/usr/bin/env bash
#
# Karjoo — 24/7 server-side discovery scheduler tick.
#
# Fills the auto-apply queue for eligible users (server toggle ON + worker plan +
# valid session), AI-filtered at each user's threshold, charged to their own 1xAi
# wallet. The endpoint is internal-only, fail-closed, idempotent, and self-serializes
# via a Postgres advisory lock — so it is safe to fire on a short interval.
#
# The shared secret is READ FROM .env.local at runtime — never embedded in this file
# or in `crontab -l`. Each tick's summary + HTTP code is appended to the log.
#
set -uo pipefail

APP_DIR="/home/website-dev/karjoo-ai"
LOG_DIR="${APP_DIR}/logs"
LOG="${LOG_DIR}/discovery-cron.log"
ENDPOINT="http://127.0.0.1:3030/api/internal/top-up"

mkdir -p "${LOG_DIR}"

SECRET="$(sed -n 's/^INTERNAL_API_SECRET=//p' "${APP_DIR}/.env.local" | head -1)"
# strip surrounding quotes (double then single) via bash parameter expansion — no tr quoting.
SECRET="${SECRET%\"}"; SECRET="${SECRET#\"}"
SECRET="${SECRET%\'}"; SECRET="${SECRET#\'}"
if [ -z "${SECRET}" ]; then
  echo "$(date -Is) ERROR: INTERNAL_API_SECRET missing in .env.local" >> "${LOG}"
  exit 1
fi

RESP="$(curl -sS -m 240 -w ' HTTP %{http_code}' -X POST "${ENDPOINT}" -H "x-internal-secret: ${SECRET}" 2>&1)"
echo "$(date -Is) ${RESP}" >> "${LOG}"
