#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${1:-$ROOT_DIR/.backups/production}"
mkdir -p -- "$BACKUP_DIR"
chmod 700 -- "$BACKUP_DIR"
BACKUP_DIR="$(cd -- "$BACKUP_DIR" && pwd)"

COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/compose.prod.yml}"
COMPOSE=(docker compose --project-directory "$ROOT_DIR" -f "$COMPOSE_FILE")
RUNNING_SERVICES="$("${COMPOSE[@]}" ps --services --status running)"
for SERVICE in db backend frontend; do
  if ! grep -Fxq "$SERVICE" <<<"$RUNNING_SERVICES"; then
    printf 'Required production service is not running: %s\n' "$SERVICE" >&2
    exit 1
  fi
done
DB_CONTAINER="$("${COMPOSE[@]}" ps -q db)"
POSTGRES_USER="$("${COMPOSE[@]}" exec -T db printenv POSTGRES_USER)"
POSTGRES_DB="$("${COMPOSE[@]}" exec -T db printenv POSTGRES_DB)"
"${COMPOSE[@]}" exec -T db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3000/api/health >/dev/null

STAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
ARCHIVE_NAME="where-my-buck-go-production-$STAMP-$$.tar.gz"
ARCHIVE_PATH="$BACKUP_DIR/$ARCHIVE_NAME"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wmbg-production-backup.XXXXXX")"
CHECK_DUMP_PATH="/tmp/wmbg-production-backup-check-$STAMP-$$.dump"
RESTART_APP=1

cleanup() {
  STATUS=$?
  trap - EXIT
  if [[ -n "$CHECK_DUMP_PATH" ]]; then
    "${COMPOSE[@]}" exec -T -u 0 db unlink "$CHECK_DUMP_PATH" >/dev/null 2>&1 || true
  fi
  if [[ "$RESTART_APP" == 1 ]] && ! "${COMPOSE[@]}" up -d --wait --wait-timeout 180 frontend; then
    printf 'Backup failed or completed, but the production app could not be restarted. Inspect Compose health before reopening traffic.\n' >&2
    STATUS=1
  fi
  rm -rf -- "$WORK_DIR"
  exit "$STATUS"
}
trap cleanup EXIT

"${COMPOSE[@]}" stop frontend backend
"${COMPOSE[@]}" exec -T db pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB" >"$WORK_DIR/database.dump"
"${COMPOSE[@]}" run -T --rm --no-deps backend wmbg-export-r2-evidence >"$WORK_DIR/r2-evidence.tar"
tar -tf "$WORK_DIR/r2-evidence.tar" >/dev/null
cat >"$WORK_DIR/manifest.txt" <<EOF
format=where-my-buck-go-production-backup-v1
created_at_utc=$STAMP
database=$POSTGRES_DB
evidence_source=Cloudflare R2
evidence_archive=r2-evidence.tar
EOF

docker cp "$WORK_DIR/database.dump" "$DB_CONTAINER:$CHECK_DUMP_PATH"
"${COMPOSE[@]}" exec -T -u 0 db pg_restore --list "$CHECK_DUMP_PATH" >/dev/null
"${COMPOSE[@]}" exec -T -u 0 db unlink "$CHECK_DUMP_PATH"
CHECK_DUMP_PATH=""
tar -czf "$WORK_DIR/$ARCHIVE_NAME" -C "$WORK_DIR" database.dump r2-evidence.tar manifest.txt
tar -tzf "$WORK_DIR/$ARCHIVE_NAME" >/dev/null
mv -- "$WORK_DIR/$ARCHIVE_NAME" "$ARCHIVE_PATH"
(
  cd -- "$BACKUP_DIR"
  sha256sum "$ARCHIVE_NAME" >"$ARCHIVE_NAME.sha256"
)

printf 'Production backup created: %s\n' "$ARCHIVE_PATH"
printf 'Checksum: %s.sha256\n' "$ARCHIVE_PATH"
