#!/usr/bin/env bash
#
# Weekly restore-verification for the karjoo Postgres backup.
#
# An unverified backup is not a backup. This takes the NEWEST artifact, decrypts it
# (if encrypted), gunzips it, and asks pg_restore to read its table of contents —
# proving the file is a structurally valid, restorable dump that still contains data.
# It never writes to the live database.
#
# Cron (installed for website-dev): 45 3 * * 0  → Sundays 03:45, after the nightly dump.
set -uo pipefail

REPO=/home/website-dev/karjoo-ai
LOCAL_DIR=/home/website-dev/backups/karjoo
CONTAINER=karjoo-db
LOG="$LOCAL_DIR/verify.log"
MIN_TABLES=10

log() { echo "$(date -Is) $*" >> "$LOG"; }

NEWEST=$(ls -1t "$LOCAL_DIR"/karjoo-*.dump.gz* 2>/dev/null | head -1)
if [ -z "$NEWEST" ]; then
  log "FATAL: no backup artifact found in $LOCAL_DIR"
  exit 1
fi

# Fail if the newest backup is stale (nightly job silently stopped).
AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$NEWEST") ) / 3600 ))
if [ "$AGE_H" -gt 48 ]; then
  log "FATAL: newest backup $(basename "$NEWEST") is ${AGE_H}h old — the nightly job is not running"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  log "FATAL: container $CONTAINER not running — cannot verify"
  exit 1
fi

decrypt_stream() {
  case "$NEWEST" in
    *.enc)
      KARJOO_BACKUP_KEY=$(grep -s '^KARJOO_BACKUP_KEY=' "$REPO/.env.local" | head -1 | cut -d= -f2-)
      if [ -z "${KARJOO_BACKUP_KEY:-}" ]; then
        log "FATAL: $(basename "$NEWEST") is encrypted but KARJOO_BACKUP_KEY is missing"
        exit 1
      fi
      export KARJOO_BACKUP_KEY
      openssl enc -d -aes-256-cbc -pbkdf2 -pass env:KARJOO_BACKUP_KEY -in "$NEWEST" | gunzip
      ;;
    *) gunzip -c "$NEWEST" ;;
  esac
}

# Read the dump's TOC inside the container; count restorable table-data entries.
TABLES=$(decrypt_stream \
  | docker exec -i "$CONTAINER" sh -c \
      'cat > /tmp/verify.dump && pg_restore --list /tmp/verify.dump 2>/dev/null | grep -c "TABLE DATA"; rm -f /tmp/verify.dump' \
  2>/dev/null | tail -1)
TABLES=${TABLES:-0}

if ! [ "$TABLES" -ge "$MIN_TABLES" ] 2>/dev/null; then
  log "FATAL: $(basename "$NEWEST") verified only ${TABLES} tables (min ${MIN_TABLES}) — backup may be corrupt"
  exit 1
fi

log "OK $(basename "$NEWEST") restorable — ${TABLES} tables, ${AGE_H}h old"
exit 0
