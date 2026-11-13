#!/usr/bin/env bash
# Nightly logical backup, encrypted with age, optionally uploaded to S3-compatible storage.
#   BACKUP_DIR=/var/backups/mtjari AGE_RECIPIENT=age1... [S3_URI=s3://bucket/path] ./backup.sh
set -euo pipefail
: "${AGE_RECIPIENT:?public age key required (backups are never stored unencrypted)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/mtjari}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/mtjari-$STAMP.dump.age"
mkdir -p "$BACKUP_DIR"

docker compose -p mtjari exec -T postgres pg_dump -U postgres -Fc mtjari | age -r "$AGE_RECIPIENT" -o "$FILE"
[ -s "$FILE" ] || { echo "backup is empty" >&2; exit 1; }

if [ -n "${S3_URI:-}" ]; then aws s3 cp "$FILE" "$S3_URI/" --only-show-errors; fi
find "$BACKUP_DIR" -name 'mtjari-*.dump.age' -mtime "+$KEEP_DAYS" -delete
echo "backup written: $FILE"
