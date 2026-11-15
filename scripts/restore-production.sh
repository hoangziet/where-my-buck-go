#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ "${1:-}" != "--confirm-replace-production-data" || $# -ne 2 ]]; then
  printf 'Usage: %s --confirm-replace-production-data /path/to/production-backup.tar.gz\n' "$0" >&2
  exit 2
fi

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ARCHIVE="$(cd -- "$(dirname -- "$2")" && pwd)/$(basename -- "$2")"
if [[ ! -f "$SOURCE_ARCHIVE" || ! -f "$SOURCE_ARCHIVE.sha256" ]]; then
  printf 'Backup archive or checksum sidecar is missing.\n' >&2
  exit 1
fi
(
  cd -- "$(dirname -- "$SOURCE_ARCHIVE")"
  sha256sum -c "$(basename -- "$SOURCE_ARCHIVE").sha256"
)

COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/compose.prod.yml}"
COMPOSE=(docker compose --project-directory "$ROOT_DIR" -f "$COMPOSE_FILE")
RUNNING_SERVICES="$("${COMPOSE[@]}" ps --services --status running)"
for SERVICE in db backend frontend; do
  if ! grep -Fxq "$SERVICE" <<<"$RUNNING_SERVICES"; then
    printf 'Required production service is not running: %s\n' "$SERVICE" >&2
    exit 1
  fi
done

STAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
RECOVERY_BACKUP_DIR="${RECOVERY_BACKUP_DIR:-$ROOT_DIR/.backups/pre-restore-$STAMP}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wmbg-production-restore.XXXXXX")"
CHECK_DUMP_PATH="/tmp/wmbg-production-restore-$STAMP-$$.dump"
APP_STOPPED=0
RESTORE_COMPLETE=0
DB_CONTAINER="$("${COMPOSE[@]}" ps -q db)"
POSTGRES_USER="$("${COMPOSE[@]}" exec -T db printenv POSTGRES_USER)"
POSTGRES_DB="$("${COMPOSE[@]}" exec -T db printenv POSTGRES_DB)"

cleanup() {
  STATUS=$?
  trap - EXIT
  if [[ -n "$CHECK_DUMP_PATH" ]]; then
    "${COMPOSE[@]}" exec -T -u 0 db unlink "$CHECK_DUMP_PATH" >/dev/null 2>&1 || true
  fi
  if [[ "$APP_STOPPED" == 1 && "$RESTORE_COMPLETE" == 0 ]]; then
    printf 'Restore did not complete. The production app remains stopped; the pre-restore backup is at %s.\n' "$RECOVERY_BACKUP_DIR" >&2
    STATUS=1
  elif [[ "$RESTORE_COMPLETE" == 1 ]] && ! "${COMPOSE[@]}" up -d --wait --wait-timeout 180 frontend; then
    printf 'Restored data is in place, but the production app did not become healthy. Inspect Compose health.\n' >&2
    STATUS=1
  fi
  rm -rf -- "$WORK_DIR"
  exit "$STATUS"
}
trap cleanup EXIT

python3 - "$SOURCE_ARCHIVE" "$WORK_DIR" <<'PY'
import sys
import tarfile
from pathlib import Path

archive_path = Path(sys.argv[1])
output_dir = Path(sys.argv[2])
expected = {"database.dump", "r2-evidence.tar", "manifest.txt"}
with tarfile.open(archive_path, "r:gz") as archive:
    members = archive.getmembers()
    if {member.name for member in members} != expected or len(members) != len(expected):
        raise SystemExit("Production backup has unexpected or missing files")
    if any(not member.isfile() for member in members):
        raise SystemExit("Production backup contains a non-file entry")
    manifest = archive.extractfile("manifest.txt")
    if manifest is None or b"format=where-my-buck-go-production-backup-v1\n" not in manifest.read():
        raise SystemExit("Production backup manifest is invalid")
    for name in sorted(expected):
        source = archive.extractfile(name)
        if source is None:
            raise SystemExit(f"Production backup entry is unreadable: {name}")
        target = output_dir / name
        with target.open("xb") as destination:
            destination.write(source.read())
        target.chmod(0o600)
PY
tar -tf "$WORK_DIR/r2-evidence.tar" >/dev/null
docker cp "$WORK_DIR/database.dump" "$DB_CONTAINER:$CHECK_DUMP_PATH"
"${COMPOSE[@]}" exec -T -u 0 db pg_restore --list "$CHECK_DUMP_PATH" >/dev/null
"${COMPOSE[@]}" exec -T -u 0 db unlink "$CHECK_DUMP_PATH"
CHECK_DUMP_PATH=""

"$ROOT_DIR/scripts/backup-production.sh" "$RECOVERY_BACKUP_DIR"
CHECK_DUMP_PATH="/tmp/wmbg-production-restore-$STAMP-$$.dump"

"${COMPOSE[@]}" stop frontend backend
APP_STOPPED=1
"${COMPOSE[@]}" exec -T db dropdb --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB"
"${COMPOSE[@]}" exec -T db createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$POSTGRES_DB"
docker cp "$WORK_DIR/database.dump" "$DB_CONTAINER:$CHECK_DUMP_PATH"
"${COMPOSE[@]}" exec -T -u 0 db pg_restore --exit-on-error --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$CHECK_DUMP_PATH"
"${COMPOSE[@]}" exec -T -u 0 db unlink "$CHECK_DUMP_PATH"
CHECK_DUMP_PATH=""
"${COMPOSE[@]}" run -T --rm --no-deps -v "$WORK_DIR/r2-evidence.tar:/restore/r2-evidence.tar:ro" \
  backend wmbg-restore-r2-evidence /restore/r2-evidence.tar
RESTORE_COMPLETE=1
"${COMPOSE[@]}" up -d --wait --wait-timeout 180 frontend
curl --fail --silent --show-error http://127.0.0.1:3000/api/health >/dev/null
curl --fail --silent --show-error --output /dev/null http://127.0.0.1:3000/login
printf 'Production database and R2 evidence restore completed and passed health checks.\n'
