#!/usr/bin/env bash
set -euo pipefail

ORIGIN=${1:-https://karjoo.1xai.ir}
VERIFY_HOST=${KARJOO_VERIFY_HOST:-}
TMP_DIR=$(mktemp -d /tmp/karjoo-web-verify.XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT

CURL_ARGS=(--silent --show-error --location --max-time 20)
if [[ -n "$VERIFY_HOST" ]]; then
  CURL_ARGS+=(--header "Host: $VERIFY_HOST")
fi

status_of() {
  local path=$1
  curl "${CURL_ARGS[@]}" --output /dev/null --write-out '%{http_code}' "${ORIGIN}${path}"
}

require_status() {
  local path=$1
  local expected=$2
  local status
  status=$(status_of "$path")
  if [[ ! "$status" =~ $expected ]]; then
    echo "release verification failed: $path returned $status" >&2
    return 1
  fi
}

verify_page_assets() {
  local path=$1
  local name=$2
  local html="$TMP_DIR/$name.html"
  local assets="$TMP_DIR/$name.assets"
  curl "${CURL_ARGS[@]}" --fail "${ORIGIN}${path}" --output "$html"
  grep -Eo '/_next/static/[^"[:space:]]+\.(css|js)' "$html" \
    | sed 's/&amp;/\&/g' \
    | sort -u > "$assets" || true
  if [[ ! -s "$assets" ]]; then
    echo "release verification failed: $path exposed no local CSS/JS assets" >&2
    return 1
  fi
  while IFS= read -r asset; do
    curl "${CURL_ARGS[@]}" --fail --output /dev/null "${ORIGIN}${asset}"
  done < "$assets"
}

cache_bust=$(date +%s)
require_status "/" '^200$'
require_status "/jobs?release_verify=$cache_bust" '^200$'
require_status "/login?release_verify=$cache_bust" '^200$'
require_status "/dashboard/extension" '^(200|307)$'
require_status "/api/extension/version" '^200$'
verify_page_assets "/?release_verify=$cache_bust" root
verify_page_assets "/jobs?release_verify=$cache_bust" jobs
verify_page_assets "/login?release_verify=$cache_bust" login

echo "release verification OK: $ORIGIN"
