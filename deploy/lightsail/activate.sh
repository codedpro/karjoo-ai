#!/usr/bin/env bash
# Put the karjoo build that is already on this host live. Runs on Lightsail as
# ~/karjoo/deploy/activate.sh; ci-deploy.sh calls it after pulling a build and
# tagging it karjoo:latest (the build it replaces is karjoo:previous).
#
#   activate.sh              deploy karjoo:latest
#   activate.sh --rollback   run karjoo:previous again
#
# A plain recreate: a few seconds of 502s per deploy are accepted for this
# project — zero-downtime blue/green is reserved for 1xai. Every container
# (the migration job included) runs in sideprojects.slice, capped and at the
# lowest CPU priority, so a deploy can never starve 1xai or the box.
#
#   1. Drizzle migrations (npm run db:migrate) from the new image — on failure
#      nothing changes;
#   2. web is recreated from the new image and must answer
#      /api/extension/version;
#   3. its ITMaster-fed pages are refreshed (refresh-content.mjs: GitHub builds
#      cannot reach ITMaster, so /blog etc. are prerendered without it).# On failure: web is recreated from karjoo:previous and the owner is told on
# Telegram (OPS_TELEGRAM_* in .env).
set -euo pipefail
RT=/home/ubuntu/karjoo
cd "$RT"
IMG=karjoo
CTR=karjoo-app
HEALTH=/api/extension/version
say() { echo "[$(date -u +%H:%M:%S)] $*"; }
dc() { sudo docker compose "$@"; }
envval() { { grep "^$1=" "$RT/.env" || true; } | head -1 | cut -d= -f2-; }
notify() {
    local tok chat
    tok=$(envval OPS_TELEGRAM_BOT_TOKEN); chat=$(envval OPS_TELEGRAM_CHAT_ID)
    [ -n "$tok" ] && [ -n "$chat" ] || return 0
    printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$tok" |
        curl -s -m 20 -K - -F chat_id="$chat" -F text="$1" >/dev/null || true
}
healthy() { # through the edge, like the tunnel; up to 3 minutes
    for _ in $(seq 1 90); do
        sudo docker exec karjoo-edge wget -q -O /dev/null -T 5 "http://$CTR:3000$HEALTH" 2>/dev/null && return 0
        sleep 2
    done
    return 1
}
recreate() { dc up -d --no-deps --force-recreate web 2>&1 | grep -vE '^\s*$' | tail -1; }

if [ "${1:-}" = --rollback ]; then
    sudo docker image inspect "$IMG:previous" >/dev/null 2>&1 || { say "no $IMG:previous to roll back to"; exit 1; }
    sudo docker tag "$IMG:latest" "$IMG:rollback-from"
    sudo docker tag "$IMG:previous" "$IMG:latest"
    sudo docker tag "$IMG:rollback-from" "$IMG:previous"; sudo docker rmi "$IMG:rollback-from" >/dev/null
    say "rollback: recreating web from the previous build"
    recreate
    healthy && { say "rolled back, healthy"; exit 0; }
    notify "🔴 karjoo rollback: the previous build is unhealthy too — needs a human."
    exit 1
fi
say "schema migration"
if ! dc run --rm --no-deps -T migrate 2>&1 | tail -4; then
    say "migration FAILED — the running site was not touched"
    sudo docker tag "$IMG:previous" "$IMG:latest" 2>/dev/null || true   # keep :latest = what runs
    notify "⚠️ karjoo deploy: the database migration failed; the running site was not touched. Needs a look."
    exit 1
fi
say "recreating web from the new build"
recreate
if ! healthy; then
    sudo docker logs --tail 20 "$CTR" 2>&1 | sed 's/^/    /' || true
    say "new build UNHEALTHY — back to the previous one"
    if sudo docker image inspect "$IMG:previous" >/dev/null 2>&1; then
        sudo docker tag "$IMG:previous" "$IMG:latest"
        recreate
        if healthy; then
            notify "⚠️ karjoo deploy: the new build was unhealthy and was rolled back automatically; the site runs the previous version."
        else
            notify "🔴 karjoo deploy: the new build was unhealthy AND the previous one is too — the site is down, needs a human."
        fi
    else
        notify "🔴 karjoo deploy: the new build is unhealthy and there is no previous build to return to — the site is down."
    fi
    exit 1
fi
if ! sudo docker exec "$CTR" node deploy/lightsail/refresh-content.mjs 2>&1 | tail -2; then
    say "WARN: ITMaster content refresh failed — /blog may be empty until the engine's next push"
    notify "⚠️ karjoo deploy: ITMaster content refresh failed; /blog may list no articles until the next publish."
fi
say "live and healthy ($(sudo docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMG:latest" 2>/dev/null | cut -c1-12))"
