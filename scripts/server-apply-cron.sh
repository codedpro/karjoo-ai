#!/usr/bin/env bash
#
# Karjoo server-side apply tick (control-plane boards).
#
# IranTalent, Karboom and e-estekhdam apply through plain HTTP transactions, so
# they run here on the control plane rather than on a Playwright worker node.
# (Jobinja and JobVision drive a real DOM, so the fleet worker handles those.)
#
# This fires the internal endpoint, which self-serializes via a Postgres advisory
# lock — safe to run on a short interval.
#
# The shared secret is READ FROM .env.local at runtime — never embedded here or in
# `crontab -l`. Each tick's summary + HTTP code is appended to the log.
#
set -uo pipefail

APP_DIR="/home/website-dev/karjoo-ai"
LOG_DIR="${APP_DIR}/logs"
LOG="${LOG_DIR}/server-apply.log"
ENDPOINT="http://127.0.0.1:3030/api/internal/server-apply"

mkdir -p "${LOG_DIR}"

SECRET="$(sed -n 's/^INTERNAL_API_SECRET=//p' "${APP_DIR}/.env.local" | head -1)"
SECRET="${SECRET%\"}"; SECRET="${SECRET#\"}"
SECRET="${SECRET%\'}"; SECRET="${SECRET#\'}"
if [ -z "${SECRET}" ]; then
  echo "$(date -Is) ERROR: INTERNAL_API_SECRET missing in .env.local" >> "${LOG}"
  exit 1
fi

# The tick renders a tailored PDF per application (Karboom and e-estekhdam upload
# one), so it can legitimately take a while. Keep the timeout well above the
# 5-minute cron interval's worth of work rather than cutting a run in half.
RESP="$(curl -sS -m 600 -w ' HTTP %{http_code}' -X POST "${ENDPOINT}" -H "x-internal-secret: ${SECRET}" 2>&1)"
echo "$(date -Is) ${RESP}" >> "${LOG}"
