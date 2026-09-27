#!/usr/bin/env bash
# Put the karjoo build that is already on this host live, with no dropped
# requests. Runs on Lightsail as ~/karjoo/deploy/activate.sh; ci-deploy.sh calls
# it after pulling a build and tagging it karjoo:latest.
#
#   activate.sh              deploy karjoo:latest
#   activate.sh --rollback   put the previous build (still in the idle slot) back
#
# 1. migrate — Drizzle migrations from the new image against the live database.
#    If they fail, nothing else happens: the live slot keeps serving. (A
#    migration that did apply is NOT undone by a later failure or a rollback.)
# 2. The new image starts in the IDLE slot (app_blue / app_green) and is
#    checked directly on /api/extension/version.
# 3. The edge — what the tunnel reaches as http://app:3000 — is pointed at it:
#    edge/upstream.inc is replaced and nginx reloads gracefully, so in-flight
#    requests finish on the old slot and new ones reach the new.
# 4. The site is checked through the edge and through Cloudflare; on failure the
#    edge goes straight back to the old slot.
# 5. The old slot is stopped once it holds no connection (at most 5 minutes)
#    and stays on disk for --rollback.
# The very first deploy (no upstream.inc yet) just starts blue.
#
# Every failure goes to the owner's Telegram (OPS_TELEGRAM_* in .env).
set -euo pipefail
RT=/home/ubuntu/karjoo
cd "$RT"
UPSTREAM=$RT/edge/upstream.inc
LOG=$RT/deploy/ci-deploy.log
SITE=https://karjoo.1xai.ir
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

# ---- drain mode (re-invoked detached below; inherits the deploy lock on fd 9,
# so the next deploy waits instead of recreating a slot that still has clients)
if [ "${1:-}" = "--drain" ]; then
    ctr=$2
    conns() { sudo docker exec "$ctr" sh -c 'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null' 2>/dev/null |
        awk '$2 ~ /:0BB8$/ && $4 == "01"' | wc -l; }
    for _ in $(seq 1 150); do [ "$(conns)" = 0 ] && break; sleep 2; done
    left=$(conns || echo "?")
    sudo docker stop -t 10 "$ctr" >/dev/null 2>&1 || true
    echo "$(date -u +%FT%TZ) drained $ctr (connections left at stop: $left)" >> "$LOG"
    exit 0
fi

live_slot() { grep -oE 'karjoo-app-(blue|green)' "$UPSTREAM" 2>/dev/null | head -1 || true; }
set_upstream() { # $1 = container; atomic replace (edge/ is a directory mount), graceful reload
    printf 'set $app_upstream "%s:3000";\n' "$1" > "$UPSTREAM.tmp"
    mv -f "$UPSTREAM.tmp" "$UPSTREAM"
    sudo docker exec karjoo-edge nginx -t -q && sudo docker exec karjoo-edge nginx -s reload
}
slot_healthy() { # $1 = container, checked directly (not through the edge)
    for _ in $(seq 1 90); do
        sudo docker exec karjoo-edge wget -q -O /dev/null -T 5 "http://$1:3000$HEALTH" 2>/dev/null && return 0
        sleep 2
    done
    return 1
}
site_healthy() { # through the edge, and (unless $1 = local) end to end through Cloudflare
    for _ in $(seq 1 15); do
        if sudo docker exec karjoo-edge wget -q -O /dev/null -T 5 "http://127.0.0.1:3000$HEALTH" 2>/dev/null &&
            { [ "${1:-}" = local ] || [ "$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$SITE$HEALTH" || true)" = 200 ]; }; then
            return 0
        fi
        sleep 2
    done
    return 1
}

activate() { # $1 = deploy | rollback
    local mode=$1 live new
    live=$(live_slot)
    case "$live" in
        karjoo-app-blue) new=green ;;
        karjoo-app-green) new=blue ;;
        "") [ "$mode" = deploy ] || { say "nothing to roll back to"; return 1; }
            new=blue; say "first deploy: no live slot yet — starting edge, onexai and the tunnel connector"
            printf 'set $app_upstream "%s:3000";\n' karjoo-app-blue > "$UPSTREAM"
            dc up -d --no-deps edge onexai cloudflared 2>&1 | grep -vE '^\s*$' | tail -3 ;;
    esac
    if [ "$mode" = deploy ]; then
        say "migrations"
        if ! dc run --rm --no-deps -T migrate 2>&1 | tail -4; then
            say "migrate FAILED — ${live:-nothing} untouched"
            notify "⚠️ karjoo deploy: database migrations failed; the live app was not touched. Needs a look."
            return 1
        fi
        sudo docker tag karjoo:latest "karjoo:$new"
    else
        sudo docker image inspect "karjoo:$new" >/dev/null 2>&1 || { say "no previous build in slot $new"; return 1; }
    fi

    say "starting slot $new — ${live:-nothing} keeps serving"
    dc up -d --no-deps --force-recreate "app_$new" 2>&1 | grep -vE '^\s*$' | tail -2
    if ! slot_healthy "karjoo-app-$new"; then
        sudo docker logs --tail 20 "karjoo-app-$new" 2>&1 | sed 's/^/    /' || true
        dc stop "app_$new" >/dev/null 2>&1 || true
        say "slot $new never became healthy — ${live:-nothing} still live, users saw nothing"
        notify "⚠️ karjoo $mode: the new app never became healthy; the previous one is still serving (no downtime). Needs a look."
        return 1
    fi
    set_upstream "karjoo-app-$new"
    if [ -z "$live" ]; then
        site_healthy local && { say "live on $new"; return 0; }
        say "edge check failed on first deploy"; return 1
    fi
    if ! site_healthy; then
        set_upstream "$live"
        dc stop "app_$new" >/dev/null 2>&1 || true
        say "site unhealthy after the switch — switched back to $live"
        notify "⚠️ karjoo $mode: the site failed its check after the switch; switched straight back to the previous app."
        return 1
    fi
    say "live on $new ($(sudo docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "karjoo:$new" 2>/dev/null | cut -c1-12)); $live drains in the background, then stops"
    setsid -f "$0" --drain "$live" >/dev/null 2>&1 </dev/null
}

case "${1:-}" in
    "") activate deploy ;;
    --rollback) activate rollback ;;
    *) echo "usage: $0 [--rollback]" >&2; exit 2 ;;
esac
