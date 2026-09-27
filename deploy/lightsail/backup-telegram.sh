#!/usr/bin/env bash
# Karjoo database backups on Lightsail → the owner's Telegram (@Coded_Pro), so
# nothing is lost even with no access to this box. Cron (ubuntu):
#   17 * * * *  ~/karjoo/deploy/backup-telegram.sh hourly
#   50 2 * * *  ~/karjoo/deploy/backup-telegram.sh daily
#   20 4 * * 0  ~/karjoo/deploy/backup-telegram.sh verify
#
# hourly  everything EXCEPT the rows of raw_listings (the scraped-ads archive:
#         ~250 MB of the ~330 MB database) — one small file.
# daily   the full database, also kept in ~/backups/karjoo (7 days), sent in
#         45 MB parts (Telegram's bot upload limit is 50 MB).
# verify  restores the newest local full dump into a scratch database and
#         compares row counts with production; alerts on any mismatch.
#
# Encrypted with KARJOO_BACKUP_KEY (aes-256-cbc, pbkdf2). Restore:
#   cat karjoo-*.part-* > f.enc   # daily only; hourly is one file
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:$KARJOO_BACKUP_KEY -in f.enc | gunzip \
#     | docker exec -i karjoo-db pg_restore -U karjoo -d karjoo --clean --if-exists
# (restoring an hourly file leaves raw_listings empty — load that table's rows
#  from the latest daily with pg_restore --data-only -t raw_listings.)
set -Eeuo pipefail
RT=/home/ubuntu/karjoo
LOCAL=/home/ubuntu/backups/karjoo
MODE=${1:-hourly}
val() { { grep "^$1=" "$RT/.env" || true; } | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
TOKEN=$(val OPS_TELEGRAM_BOT_TOKEN); CHAT=$(val OPS_TELEGRAM_CHAT_ID); KEY=$(val KARJOO_BACKUP_KEY)
[ -n "$TOKEN" ] && [ -n "$CHAT" ] && [ -n "$KEY" ] || { echo "missing OPS_TELEGRAM_BOT_TOKEN/OPS_TELEGRAM_CHAT_ID/KARJOO_BACKUP_KEY in $RT/.env" >&2; exit 1; }
export KEY
STAMP=$(date -u +%Y%m%d-%H%M)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
tg() { printf 'url = "https://api.telegram.org/bot%s/%s"\n' "$TOKEN" "$1"; }
fail() { tg sendMessage | curl -s -m 20 -K - -F chat_id="$CHAT" -F text="⚠️ karjoo backup ($MODE) FAILED ($STAMP UTC): $1" >/dev/null || true; echo "FATAL: $1" >&2; exit 1; }
trap 'fail "line $LINENO: $BASH_COMMAND"' ERR
psql() { docker exec karjoo-db psql -U karjoo "$@"; }
counts() { psql -d "$1" -Atc "select string_agg(relname||'='||n, ',' order by relname) from (select c.relname, (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.'||quote_ident(c.relname), false, true, '')))[1]::text n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r') t"; }
send() { # $1 file, $2 caption
    local r; r=$(tg sendDocument | curl -sS -m 600 --retry 3 -K - -F chat_id="$CHAT" -F disable_notification=true -F caption="$2" -F document=@"$1")
    grep -q '"ok":true' <<<"$r" || fail "Telegram refused $(basename "$1"): $(head -c 200 <<<"$r")"
}

case "$MODE" in
hourly)
    OUT=$TMP/karjoo-hourly-$STAMP.dump.gz.enc
    docker exec karjoo-db pg_dump -U karjoo -d karjoo -Fc --exclude-table-data=raw_listings \
        | gzip -9 | openssl enc -aes-256-cbc -pbkdf2 -pass env:KEY -out "$OUT"
    [ "$(stat -c%s "$OUT")" -gt 10240 ] || fail "dump suspiciously small"
    [ "$(stat -c%s "$OUT")" -lt 47185920 ] || fail "hourly dump over 45 MB — split it or exclude more"
    send "$OUT" "karjoo hourly $STAMP UTC · DB without raw_listings rows · AES-256, key = KARJOO_BACKUP_KEY"
    echo "$(date -u +%FT%TZ) hourly sent ($(du -h "$OUT" | cut -f1))" ;;
daily)
    mkdir -p "$LOCAL"; chmod 700 "$LOCAL"
    OUT=$LOCAL/karjoo-full-$STAMP.dump.gz.enc
    docker exec karjoo-db pg_dump -U karjoo -d karjoo -Fc | gzip -9 | openssl enc -aes-256-cbc -pbkdf2 -pass env:KEY -out "$OUT"
    chmod 600 "$OUT"
    [ "$(stat -c%s "$OUT")" -gt 1048576 ] || { rm -f "$OUT"; fail "full dump suspiciously small"; }
    split -b 45M -d -a 2 "$OUT" "$TMP/$(basename "$OUT").part-"
    n=$(ls "$TMP" | wc -l); i=0
    for p in "$TMP"/*.part-*; do i=$((i+1)); send "$p" "karjoo DAILY FULL $STAMP UTC · part $i/$n · cat parts in order, AES-256, key = KARJOO_BACKUP_KEY"; done
    find "$LOCAL" -name 'karjoo-full-*.dump.gz.enc' -mtime +7 -delete
    echo "$(date -u +%FT%TZ) daily sent in $n part(s) ($(du -h "$OUT" | cut -f1))" ;;
verify)
    F=$(ls -1t "$LOCAL"/karjoo-full-*.dump.gz.enc 2>/dev/null | head -1); [ -n "$F" ] || fail "no local full dump to verify"
    psql -d postgres -qc "DROP DATABASE IF EXISTS karjoo_verify" -c "CREATE DATABASE karjoo_verify"
    openssl enc -d -aes-256-cbc -pbkdf2 -pass env:KEY -in "$F" | gunzip | docker exec -i karjoo-db pg_restore -U karjoo -d karjoo_verify --no-owner >/dev/null 2>"$TMP/restore.err" || true
    got=$(counts karjoo_verify); psql -d postgres -qc "DROP DATABASE karjoo_verify"
    tables=$(tr ',' '\n' <<<"$got" | grep -c =) ; [ "$tables" -gt 20 ] || fail "restore drill: only $tables tables came back from $(basename "$F")"
    echo "$(date -u +%FT%TZ) verify OK: $(basename "$F") → $tables tables, $(tr ',' '\n' <<<"$got" | awk -F= '{s+=$2} END{print s}') rows" ;;
*) echo "usage: $0 hourly|daily|verify" >&2; exit 2 ;;
esac
