#!/usr/bin/env bash
#
# Karjoo × Jobinja live E2E runner. Builds the extension, finds Playwright's Chromium,
# loads the real packaged extension, and drives the live account. Headful under xvfb
# (MV3 extensions need a real browser, not headless-shell). Credentials come from the
# gitignored e2e/.env.e2e (or the environment). No creds → the suite SKIPs (exit 0).
#
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"

# 1) credentials (gitignored file, or already-exported env)
if [ -f "$DIR/.env.e2e" ]; then set -a; . "$DIR/.env.e2e"; set +a; fi

# 2) Playwright's FULL Chromium (not headless-shell — extensions need the full build)
if [ -z "${KARJOO_E2E_CHROME:-}" ]; then
  KARJOO_E2E_CHROME="$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | sort | tail -1)"
fi
if [ -z "${KARJOO_E2E_CHROME:-}" ] || [ ! -x "${KARJOO_E2E_CHROME}" ]; then
  echo "[e2e] Playwright Chromium not found. Install it once:"
  echo "        (cd \"$ROOT/worker\" && npx playwright install chromium)"
  exit 2
fi
export KARJOO_E2E_CHROME

# 3) xvfb (virtual display for the headful extension browser)
if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "[e2e] xvfb-run not found. Install: sudo apt-get install -y xvfb"; exit 2
fi

# 4) build the extension so we test the CURRENT code
echo "[e2e] building extension…"
( cd "$ROOT/extension" && npm run build >/dev/null 2>&1 ) || { echo "[e2e] extension build failed"; exit 1; }
export KARJOO_EXT_DIR="$ROOT/extension/dist"

# 5) run
echo "[e2e] launching (chromium: $(basename "$(dirname "$(dirname "$KARJOO_E2E_CHROME")")"))"
exec xvfb-run -a node "$DIR/jobinja.e2e.mjs"
