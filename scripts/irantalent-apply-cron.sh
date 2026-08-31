#!/usr/bin/env bash
#
# Karjoo IranTalent server-side apply tick.
#
# IranTalent's apply transaction is pure HTTP, so it runs on the control plane
# rather than on a Playwright worker node. This fires the internal endpoint, which
# self-serializes via a Postgres advisory lock — safe to run on a short interval.
#
# The shared secret is READ FROM .env.local at runtime — never embedded here or in
# `crontab -l`. Each tick's summary + HTTP code is appended to the log.
#
set -uo pipefail

APP_DIR="/home/website-dev/karjoo-ai"
LOG_DIR="${APP_DIR}/logs"
LOG="${LOG_DIR}/irantalent-apply.log"
ENDPOINT="http://127.0.0.1:3030/api/internal/irantalent-apply"

mkdir -p "${LOG_DIR}"

SECRET="$(sed -n 's/^INTERNAL_API_SECRET=//p' "${APP_DIR}/.env.local" | head -1)"
SECRET="${SECRET%\"}"; SECRET="${SECRET#\"}"
SECRET="${SECRET%\'}"; SECRET="${SECRET#\'}"
if [ -z "${SECRET}" ]; then
  echo "$(date -Is) ERROR: INTERNAL_API_SECRET missing in .env.local" >> "${LOG}"
  exit 1
fi

RESP="$(curl -sS -m 240 -w ' HTTP %{http_code}' -X POST "${ENDPOINT}" -H "x-internal-secret: ${SECRET}" 2>&1)"
echo "$(date -Is) ${RESP}" >> "${LOG}"
