#!/bin/sh
# gmov DB backup: pg_dump (plain SQL + DROP statements) piped through gzip.
# Retention: keep 7 days of dailies + 4 weekly (Sunday) copies, pruned by mtime.
# Usage: db-backup.sh [once|loop]   (default: loop)
set -eu
export LC_ALL=C

BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
RETENTION_WEEKS="${BACKUP_RETENTION_WEEKS:-4}"
WEEKLY_KEEP_DAYS=$((RETENTION_WEEKS * 7))

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"
# PGPASSWORD comes from the environment (compose). pg_hba trust also works
# for local-socket use; over TCP the password env is required.

mkdir -p "$BACKUP_DIR"

run_backup() {
  stamp=$(date +%Y%m%d-%a-%H%M%S)
  file="$BACKUP_DIR/gmov-$stamp.sql.gz"
  echo "[backup] dumping $PGDATABASE@$PGHOST to $file ..."
  # pipefail so a pg_dump failure is not masked by gzip's exit code.
  set -o pipefail
  if pg_dump -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" \
      --clean --if-exists | gzip > "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "[backup] wrote $(du -h "$file" | cut -f1) $file"
  else
    code=$?
    rm -f "$file.tmp"
    echo "[backup] FAILED (exit $code), keeping previous backups" >&2
    return $code
  fi
  set +o pipefail
}

prune() {
  # Dailies older than RETENTION_DAYS, except Sunday copies.
  # shellcheck disable=SC2086
  find "$BACKUP_DIR" -maxdepth 1 -name 'gmov-*.sql.gz' \
    -mtime +$RETENTION_DAYS ! -name '*-Sun-*' -delete -print | sed 's/^/[prune] removed /'
  # Sunday copies older than RETENTION_WEEKS.
  # shellcheck disable=SC2086
  find "$BACKUP_DIR" -maxdepth 1 -name 'gmov-*-Sun-*.sql.gz' \
    -mtime +$WEEKLY_KEEP_DAYS -delete -print | sed 's/^/[prune] removed weekly /'
  echo "[backup] current set:"
  ls -lh "$BACKUP_DIR" | tail -n +2
}

mode="${1:-loop}"
if [ "$mode" = "once" ]; then
  run_backup && prune
  exit $?
fi

echo "[backup] loop mode: every ${INTERVAL}s, keep ${RETENTION_DAYS}d + ${RETENTION_WEEKS} Sundays"
while true; do
  run_backup && prune || true
  sleep "$INTERVAL"
done
