#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
COMPOSE_FILE="$ROOT/docker-compose.web.yml"
RUNTIME_DIR="$ROOT/.karjoo-runtime"
ACTIVE_FILE="$RUNTIME_DIR/active-slot"
UPSTREAM_FILE="$RUNTIME_DIR/upstream.conf"
LOCK_FILE="$RUNTIME_DIR/deploy.lock"
PUBLIC_ORIGIN=${KARJOO_PUBLIC_ORIGIN:-https://karjoo.1xai.ir}
PUBLIC_HOST=${KARJOO_PUBLIC_HOST:-karjoo.1xai.ir}
PURGE_SCRIPT=${KARJOO_PURGE_SCRIPT:-/home/website-dev/1xai/deploy/purge-cloudflare.sh}
LEGACY_CONTAINER=${KARJOO_LEGACY_CONTAINER:-karjoo-web}

mkdir -p "$RUNTIME_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "another Karjoo web deployment is already running" >&2
  exit 1
fi

compose() {
  docker compose --project-directory "$ROOT" -f "$COMPOSE_FILE" "$@"
}

validate_slot() {
  case "$1" in
    blue|green) ;;
    *) echo "invalid deployment slot: $1" >&2; return 1 ;;
  esac
}

slot_port() {
  validate_slot "$1"
  if [[ "$1" == blue ]]; then
    printf '3031\n'
  else
    printf '3032\n'
  fi
}

other_slot() {
  validate_slot "$1"
  if [[ "$1" == blue ]]; then
    printf 'green\n'
  else
    printf 'blue\n'
  fi
}

slot_dir() {
  validate_slot "$1"
  printf '%s/.next-%s\n' "$ROOT" "$1"
}

candidate_dir() {
  validate_slot "$1"
  printf '%s/.next-candidate\n' "$ROOT"
}

write_active() {
  validate_slot "$1"
  printf '%s\n' "$1" > "$ACTIVE_FILE.tmp"
  mv -f "$ACTIVE_FILE.tmp" "$ACTIVE_FILE"
}

write_upstream() {
  local primary=$1
  local backup=$2
  validate_slot "$primary"
  validate_slot "$backup"
  {
    printf 'server 127.0.0.1:%s max_fails=1 fail_timeout=5s;\n' "$(slot_port "$primary")"
    printf 'server 127.0.0.1:%s backup;\n' "$(slot_port "$backup")"
  } > "$UPSTREAM_FILE.tmp"
  mv -f "$UPSTREAM_FILE.tmp" "$UPSTREAM_FILE"
}

wait_for_url() {
  local url=$1
  local attempts=${2:-45}
  local i
  for ((i = 1; i <= attempts; i++)); do
    if curl --silent --show-error --fail --max-time 3 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "health check timed out: $url" >&2
  return 1
}

verify_slot() {
  local slot=$1
  local port
  port=$(slot_port "$slot")
  wait_for_url "http://127.0.0.1:$port/api/extension/version"
  KARJOO_VERIFY_HOST="$PUBLIC_HOST" "$ROOT/scripts/verify-web-release.sh" "http://127.0.0.1:$port"
}

verify_proxy() {
  wait_for_url "http://127.0.0.1:3030/api/extension/version"
  KARJOO_VERIFY_HOST="$PUBLIC_HOST" "$ROOT/scripts/verify-web-release.sh" "http://127.0.0.1:3030"
}

verify_public() {
  "$ROOT/scripts/verify-web-release.sh" "$PUBLIC_ORIGIN"
}

build_candidate() {
  local slot=$1
  local candidate
  candidate=$(candidate_dir "$slot")
  rm -rf -- "$candidate"
  echo "building candidate for $slot"
  (
    cd "$ROOT"
    KARJOO_NEXT_DIST_DIR=".next-candidate" npm run build
  )
  test -f "$candidate/BUILD_ID"
  rm -rf -- "$candidate/cache" "$candidate/dev"
}

restore_slot() {
  local slot=$1
  local destination=$2
  local rollback=$3
  compose stop "$slot" >/dev/null 2>&1 || true
  rm -rf -- "$destination"
  if [[ -d "$rollback" ]]; then
    mv "$rollback" "$destination"
    compose up -d --no-deps --force-recreate "$slot"
  fi
}

promote_candidate() {
  local slot=$1
  local candidate destination rollback had_previous=0
  validate_slot "$slot"
  candidate=$(candidate_dir "$slot")
  destination=$(slot_dir "$slot")
  rollback="$RUNTIME_DIR/.next-$slot.rollback"
  test -f "$candidate/BUILD_ID"

  compose stop "$slot" >/dev/null 2>&1 || true
  rm -rf -- "$rollback"
  if [[ -d "$destination" ]]; then
    mv "$destination" "$rollback"
    had_previous=1
  fi
  mv "$candidate" "$destination"

  if ! compose up -d --no-deps --force-recreate "$slot" || ! verify_slot "$slot"; then
    echo "candidate failed in $slot; restoring its previous build" >&2
    restore_slot "$slot" "$destination" "$rollback"
    return 1
  fi

  if (( had_previous )); then
    rm -rf -- "$rollback"
  fi
}

reload_proxy() {
  docker exec karjoo-proxy nginx -t
  docker exec karjoo-proxy nginx -s reload
}

switch_slots() {
  local primary=$1
  local backup=$2
  write_upstream "$primary" "$backup"
  reload_proxy
  write_active "$primary"
  verify_proxy
}

rollback_switch() {
  local previous=$1
  local failed=$2
  echo "rolling traffic back to $previous" >&2
  write_upstream "$previous" "$failed"
  reload_proxy || true
  write_active "$previous"
  verify_proxy || true
}

purge_cloudflare() {
  if [[ ! -x "$PURGE_SCRIPT" ]]; then
    echo "Cloudflare purge script is missing or not executable: $PURGE_SCRIPT" >&2
    return 1
  fi
  "$PURGE_SCRIPT"
}

clone_legacy_build() {
  local destination
  destination=$(slot_dir green)
  compose stop green >/dev/null 2>&1 || true
  rm -rf -- "$destination"
  if [[ -f "$ROOT/.next/BUILD_ID" ]]; then
    echo "preserving the current production build in the green fallback slot"
    cp -a --reflink=auto "$ROOT/.next" "$destination"
  else
    echo "no legacy build found; cloning the verified blue build"
    cp -a --reflink=auto "$(slot_dir blue)" "$destination"
  fi
  rm -rf -- "$destination/cache" "$destination/dev"
  compose up -d --no-deps --force-recreate green
  verify_slot green
}

initial_migration() {
  local legacy_available=0
  echo "initializing Karjoo blue-green deployment"
  build_candidate blue
  promote_candidate blue
  clone_legacy_build
  write_upstream blue green

  echo "handing port 3030 from the legacy app to the stable proxy"
  if docker inspect "$LEGACY_CONTAINER" >/dev/null 2>&1; then
    legacy_available=1
    docker stop --time 20 "$LEGACY_CONTAINER" >/dev/null
  fi
  if ! compose up -d --no-deps proxy || ! verify_proxy; then
    echo "proxy handoff failed" >&2
    if (( legacy_available )); then
      echo "restoring the legacy container" >&2
      compose stop proxy >/dev/null 2>&1 || true
      docker start "$LEGACY_CONTAINER" >/dev/null
      wait_for_url "http://127.0.0.1:3030/api/extension/version" || true
    fi
    return 1
  fi

  write_active blue
  if ! verify_public; then
    echo "public verification failed before cache purge" >&2
    if (( legacy_available )); then
      echo "restoring legacy" >&2
      compose stop proxy >/dev/null 2>&1 || true
      docker start "$LEGACY_CONTAINER" >/dev/null
      wait_for_url "http://127.0.0.1:3030/api/extension/version" || true
    fi
    return 1
  fi
  purge_cloudflare
  verify_public
  echo "blue-green migration complete; blue is active and green preserves the previous build"
}

deploy_release() {
  if [[ ! -f "$ACTIVE_FILE" ]]; then
    initial_migration
    return
  fi

  local active target
  active=$(tr -d '[:space:]' < "$ACTIVE_FILE")
  validate_slot "$active"
  target=$(other_slot "$active")

  # Recover an interrupted host reboot or a manually stopped service before
  # replacing either release slot.
  compose up -d --no-deps "$active"
  verify_slot "$active"
  write_upstream "$active" "$target"
  compose up -d --no-deps proxy
  verify_proxy

  build_candidate "$target"
  promote_candidate "$target"
  if ! switch_slots "$target" "$active"; then
    rollback_switch "$active" "$target"
    return 1
  fi
  if ! verify_public; then
    rollback_switch "$active" "$target"
    return 1
  fi
  if ! purge_cloudflare; then
    rollback_switch "$active" "$target"
    return 1
  fi
  if ! verify_public; then
    rollback_switch "$active" "$target"
    return 1
  fi
  echo "deployment complete; $target is active and $active is the hot fallback"
}

manual_rollback() {
  if [[ ! -f "$ACTIVE_FILE" ]]; then
    echo "blue-green deployment has not been initialized" >&2
    return 1
  fi
  local active target
  active=$(tr -d '[:space:]' < "$ACTIVE_FILE")
  validate_slot "$active"
  target=$(other_slot "$active")
  compose up -d --no-deps "$target"
  verify_slot "$target"
  switch_slots "$target" "$active"
  purge_cloudflare
  verify_public
  echo "rollback complete; $target is active"
}

show_status() {
  local active=uninitialized
  if [[ -f "$ACTIVE_FILE" ]]; then
    active=$(tr -d '[:space:]' < "$ACTIVE_FILE")
  fi
  printf 'active slot: %s\n' "$active"
  compose ps
}

case "${1:-deploy}" in
  deploy) deploy_release ;;
  rollback) manual_rollback ;;
  status) show_status ;;
  *) echo "usage: $0 [deploy|rollback|status]" >&2; exit 2 ;;
esac
