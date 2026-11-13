#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${1:-$ROOT_DIR/.backups}"
mkdir -p -- "$BACKUP_DIR"
BACKUP_DIR="$(cd -- "$BACKUP_DIR" && pwd)"

COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/compose.local.yml}"
COMPOSE=(docker compose --project-directory "$ROOT_DIR" -f "$COMPOSE_FILE")
RUNNING_SERVICES="$("${COMPOSE[@]}" ps --services --status running)"
for SERVICE in db backend frontend; do
  if ! grep -Fxq "$SERVICE" <<<"$RUNNING_SERVICES"; then
    printf 'Required service is not running: %s\n' "$SERVICE" >&2
    exit 1
  fi
done

BACKEND_CONTAINER="$("${COMPOSE[@]}" ps -q backend)"
DB_CONTAINER="$("${COMPOSE[@]}" ps -q db)"
STAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
ARCHIVE_NAME="where-my-buck-go-$STAMP-$$.tar.gz"
ARCHIVE_PATH="$BACKUP_DIR/$ARCHIVE_NAME"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wmbg-backup.XXXXXX")"
CHECK_DUMP_PATH="/tmp/wmbg-backup-check-$STAMP-$$.dump"
RESTART_APP=1

cleanup() {
  STATUS=$?
  trap - EXIT
  if [[ -n "$CHECK_DUMP_PATH" ]]; then
    "${COMPOSE[@]}" exec -T -u 0 db unlink "$CHECK_DUMP_PATH" >/dev/null 2>&1 || true
  fi
  if [[ "$RESTART_APP" == 1 ]] && ! "${COMPOSE[@]}" up -d --wait --wait-timeout 120 frontend; then
    printf 'Backup finished, but the app could not be restarted automatically. Start it with docker compose.\n' >&2
    STATUS=1
  fi
  rm -rf -- "$WORK_DIR"
  exit "$STATUS"
}
trap cleanup EXIT

"${COMPOSE[@]}" stop frontend backend
"${COMPOSE[@]}" exec -T db pg_dump -Fc -U fingpt -d fingpt >"$WORK_DIR/database.dump"
docker cp "$BACKEND_CONTAINER:/data/evidence" "$WORK_DIR/evidence"
cat >"$WORK_DIR/manifest.txt" <<EOF
format=where-my-buck-go-local-backup-v1
created_at_utc=$STAMP
database=fingpt
evidence_directory=evidence/
EOF

docker cp "$WORK_DIR/database.dump" "$DB_CONTAINER:$CHECK_DUMP_PATH"
"${COMPOSE[@]}" exec -T -u 0 db pg_restore --list "$CHECK_DUMP_PATH" >/dev/null
"${COMPOSE[@]}" exec -T -u 0 db unlink "$CHECK_DUMP_PATH"
CHECK_DUMP_PATH=""
tar -czf "$WORK_DIR/$ARCHIVE_NAME" -C "$WORK_DIR" database.dump evidence manifest.txt
tar -tzf "$WORK_DIR/$ARCHIVE_NAME" >/dev/null
mv -- "$WORK_DIR/$ARCHIVE_NAME" "$ARCHIVE_PATH"
(
  cd -- "$BACKUP_DIR"
  sha256sum "$ARCHIVE_NAME" >"$ARCHIVE_NAME.sha256"
)

printf 'Backup created: %s\n' "$ARCHIVE_PATH"
printf 'Checksum: %s.sha256\n' "$ARCHIVE_PATH"
