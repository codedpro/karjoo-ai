#!/usr/bin/env bash
#
# Nightly Postgres backup for karjoo.
#
# Why this exists: karjoo's database holds user accounts, wallet_ledger,
# payment_requests and the ENCRYPTED session vault (session_blobs) — and it had no
# backup at all, while three sibling projects on this same box each had one. A volume
# loss or a bad migration was unrecoverable.
#
# What it does:
#   1. pg_dump (custom format) inside the karjoo-db container
#   2. gzip, then AES-256 encrypt IF a key is configured (see below)
#   3. verify the artifact is non-trivial, then apply retention
#
# Encryption (recommended): put a strong random key in .env.local as
#   KARJOO_BACKUP_KEY=...
# Without it the dump is stored gzipped but UNENCRYPTED (mode 600, local only) and the
# script warns — the dump contains personal data and the wallet ledger.
# NOTE: session_blobs stay AES-GCM encrypted inside the dump regardless (the vault key
# is KARJOO_VAULT_KEY and is NOT in the dump) — a dump alone cannot open board sessions.
#
# Restore:
#   # encrypted:
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass env:KARJOO_BACKUP_KEY \
#       -in karjoo-YYYYMMDD-HHMM.dump.gz.enc | gunzip \
#       | docker exec -i karjoo-db pg_restore -U karjoo -d karjoo --clean --if-exists
#   # plain:
#   gunzip -c karjoo-YYYYMMDD-HHMM.dump.gz \
#       | docker exec -i karjoo-db pg_restore -U karjoo -d karjoo --clean --if-exists
#
# Cron (installed for website-dev):  20 3 * * *  → daily 03:20 local time.
set -uo pipefail

REPO=/home/website-dev/karjoo-ai
LOCAL_DIR=/home/website-dev/backups/karjoo
CONTAINER=karjoo-db
DB_USER=karjoo
DB_NAME=karjoo
KEEP_LOCAL=14
STAMP=$(date +%Y%m%d-%H%M)
LOG="$LOCAL_DIR/backup.log"

mkdir -p "$LOCAL_DIR"
chmod 700 "$LOCAL_DIR" 2>/dev/null || true

log() { echo "$(date -Is) $*" >> "$LOG"; }

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  log "FATAL: container $CONTAINER is not running — no backup taken"
  exit 1
fi

# Optional encryption key (never echoed).
KARJOO_BACKUP_KEY=$(grep -s '^KARJOO_BACKUP_KEY=' "$REPO/.env.local" | head -1 | cut -d= -f2-)

if [ -n "${KARJOO_BACKUP_KEY:-}" ]; then
  OUT="$LOCAL_DIR/karjoo-$STAMP.dump.gz.enc"
  export KARJOO_BACKUP_KEY
  docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom \
    | gzip \
    | openssl enc -aes-256-cbc -pbkdf2 -pass env:KARJOO_BACKUP_KEY -out "$OUT"
  RC=${PIPESTATUS[0]}
else
  OUT="$LOCAL_DIR/karjoo-$STAMP.dump.gz"
  docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom | gzip > "$OUT"
  RC=${PIPESTATUS[0]}
  log "WARN: KARJOO_BACKUP_KEY not set — dump stored UNENCRYPTED (contains personal data + wallet ledger)"
fi

chmod 600 "$OUT" 2>/dev/null || true

if [ "$RC" -ne 0 ]; then
  log "FATAL: pg_dump failed (rc=$RC) — removing partial artifact $(basename "$OUT")"
  rm -f "$OUT"
  exit 1
fi

# Sanity: a real karjoo dump is far bigger than this; a few hundred bytes means the
# dump silently produced nothing useful. Fail loudly rather than bank an empty backup.
SIZE_BYTES=$(stat -c %s "$OUT" 2>/dev/null || echo 0)
if [ "$SIZE_BYTES" -lt 2000 ]; then
  log "FATAL: backup suspiciously small (${SIZE_BYTES}B) — removing $(basename "$OUT")"
  rm -f "$OUT"
  exit 1
fi

log "OK $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"

# Retention — keep the newest N, delete older.
ls -1t "$LOCAL_DIR"/karjoo-*.dump.gz* 2>/dev/null | tail -n +$((KEEP_LOCAL + 1)) | while read -r old; do
  rm -f "$old" && log "pruned $(basename "$old")"
done

exit 0
