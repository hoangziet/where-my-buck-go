# Where My Buck Go

Local-first personal finance assistant with authentication, a preview/confirm ledger, and a Gemini-backed
chat for text and receipt photos. Every create/edit/delete/undo is a draft until a separate, explicit
confirm action; nothing the model proposes is written or executed directly. Attaching a receipt image
creates a real draft with the original photo stored as evidence, same as a text message creates a draft
with the original text as evidence — both are viewable later from the Transactions page. Chat history is
persisted server-side (listed in the sidebar, resumable), and Q&A answers can be pinned to the dashboard.
Gemini also has separate local smoke tests. `SRD.md` records the agreed product rules and `ROADMAP.md`
tracks readiness work; no old SQLite
code or data is imported.

## Run with Docker Compose

Requires Docker Compose. The stack includes PostgreSQL, a one-shot migration service, the Flask
backend, and the Next.js frontend.

1. `cp .env.example .env` and set `AUTH_HMAC_KEY` to a random secret of at least 32 bytes.
   Set `GEMINI_API_KEY` to enable chat and image preview.
2. Start the app with `docker compose -f compose.local.yml up -d --build`.
   PostgreSQL migrations run automatically before the backend starts.
3. Open http://localhost:3100.
4. On a fresh database, create the owner with
   `docker compose -f compose.local.yml exec backend wmbg-bootstrap owner`.
   Skip this if you already have an owner in the existing database volume.

Follow logs with `docker compose -f compose.local.yml logs -f frontend backend`.
Stop the app with `docker compose -f compose.local.yml down`; this keeps the PostgreSQL and evidence
volumes. Do not add `-v` if you want to keep local data. The database retains its existing local
identity and volume so current owner accounts and sessions remain available.

## Local backup and restore

Create a consistent, checksummed backup with `./scripts/backup-local.sh` (or pass a destination such as
`./scripts/backup-local.sh /media/encrypted-drive/where-my-buck-go`). The command pauses the frontend and
backend while it captures the PostgreSQL database and evidence volume, validates the archive, then starts
the app again. Archives are written with owner-only permissions; store copies on encrypted media and keep
`.env`/`AUTH_HMAC_KEY` separately. The default `.backups/` directory is ignored by Git.

For a restore, verify the sidecar with `cd /path/to/backup && sha256sum -c <archive>.tar.gz.sha256`, then
extract the archive to a private temporary directory. Confirm the target stack and stop the frontend/backend
before replacing its database:

```sh
docker compose -f compose.local.yml stop frontend backend
docker compose -f compose.local.yml exec -T db dropdb --if-exists -U fingpt fingpt
docker compose -f compose.local.yml exec -T db createdb -U fingpt -O fingpt fingpt
db_container="$(docker compose -f compose.local.yml ps -q db)"
docker cp /path/to/extracted/database.dump "$db_container:/tmp/wmbg-restore.dump"
docker compose -f compose.local.yml exec -T -u 0 db pg_restore --exit-on-error --no-owner -U fingpt -d fingpt /tmp/wmbg-restore.dump
docker compose -f compose.local.yml exec -T -u 0 db unlink /tmp/wmbg-restore.dump
backend_container="$(docker compose -f compose.local.yml ps -aq backend)"
docker cp /path/to/extracted/evidence/. "$backend_container:/data/evidence/"
docker compose -f compose.local.yml up -d --wait frontend
```

Verify health checks and owner data after restore. Database replacement is destructive; confirm the target
and keep the source backup untouched. Rehearse restores with an isolated Compose project before relying on
a backup for recovery.

## Run services on the host

For host-based development, use Python 3.10+, Node 20+, and Docker. Start only PostgreSQL with
`docker compose -f compose.local.yml up -d db`, then install the backend with
`uv venv .venv && uv pip install --python .venv/bin/python -e './backend[dev]'`.
From `backend`, run migrations with
`DATABASE_URL=postgresql+psycopg://fingpt:local-only-change-me@localhost:55432/fingpt ../.venv/bin/alembic upgrade head`,
then load `.env` with `set -a; source ../.env; set +a` and start Flask with
`../.venv/bin/flask --app where_my_buck_go.api.app:create_app run --port 5000`.
In another shell, run `cd frontend && npm ci && npm run dev -- -p 3100` and visit
http://localhost:3100.
Local testing takes priority; Oracle deployment only starts after the owner approves the local app.
The Gemini adapter can be verified independently without writing financial data. Set `GEMINI_API_KEY`
in `.env`, load `.env` into the shell, then run `./.venv/bin/wmbg-gemini-smoke` from the repository root.
The default model is `gemini-3.1-flash-lite` (override with `GEMINI_MODEL`). The command makes one
request with harmless sample text and validates the forced function call.
With `GEMINI_API_KEY` set, Gemini routes web text chat to owner-scoped read-only totals, draft income/expense
proposals, or an edit/delete/undo request matched against the owner's own transactions (an explicit
selection step if more than one matches). It cannot confirm transactions or execute SQL. Chat history is
bounded to eight turns for the model but persisted in full server-side per conversation.
To test a single image locally without saving it, run
`./.venv/bin/wmbg-gemini-image-smoke image.png --expect-amount 17500 --expect-date 2026-11-09 --expect-time 18:36`.
Only PNG/JPEG files up to 4 MB are sent to Gemini. The CLI is a read-only extraction check and never writes
anything; the web `/api/chat/image-intake` endpoint performs the same extraction but creates a real,
confirmable draft with the original image stored as evidence.

## Ledger API (local)

All ledger writes require an authenticated session, its `X-CSRF-Token` header, a unique UUID
`Idempotency-Key` per logical operation, and `expectedVersion` in JSON. Reuse the same key when
retrying that operation after a timeout or lost response. Creating a proposal uses version `0`;
confirming or editing a proposal uses its previewed version. Reusing a key with a different body
returns `409`; repeating an identical request returns the original response. The model cannot call
the confirm route. `POST /api/proposals` creates a draft; `PATCH /api/proposals/<id>` completes or
replaces one; `POST /api/proposals/<id>/confirm` is a distinct, explicit action. For existing
transactions, `POST /api/proposals/changes` with `operation: edit|delete|undo`, `targetId` and
the transaction's `expectedVersion` creates a separate preview. `POST /api/proposals/<id>/discard`
marks an open draft discarded instead of leaving it open forever; it is scoped, idempotent and
version-checked the same as confirm. `GET /api/proposals/<id>` and
`GET /api/transactions/<id>` include owner-scoped `evidenceIds`; fetch original text via
`GET /api/evidence/<id>`. `GET /api/proposals` lists up to 200 open owner drafts, including after a
page reload. Every proposal requires original `evidenceText`. Missing date stays a
draft; a missing time receives a marked default. Local evidence lives in private `.local-evidence/`.
The app refuses to start with filesystem evidence in production until the R2 adapter is available.

`POST /api/chat/messages` accepts `{ "text": "...", "history": [], "expectedVersion": 0, "chatId": "..." }`
(`chatId` optional; a new conversation is created and returned when omitted) with the same session,
CSRF, and UUID idempotency header. Read-only totals support a single day, this/last month, or a
validated custom range up to 366 days. It returns a read-only answer, draft previews for extracted
items, a ready-to-confirm edit/delete/undo draft when exactly one transaction matches, or a list of
candidate transactions to pick from when more than one matches. Every response includes `debugTrace`
(the routing steps and executed SQL templates, values hidden) for the "Steps & SQL" panel in the chat
UI, and `chatId` for the conversation it was appended to. Retry a failed request with its original
key; successful replays return the same previews. `POST /api/chat/image-intake` accepts multipart
`image` (optional `caption` text) with CSRF and an idempotency key, and creates a real draft the same
way text intake does, with the original image stored as evidence.
`GET /api/chats` lists the owner's conversations; `GET /api/chats/<id>/messages` returns one
conversation's full history. `POST /api/chat/pins` / `GET /api/chat/pins` / `DELETE
/api/chat/pins/<id>` manage dashboard-pinned Q&A ranges, each re-running the same owner-scoped
aggregate on every read — never arbitrary SQL.
`POST /api/auth/change-password` verifies the current password before setting a new one and revokes
every active session, the same as the CLI reset.

## Checks

`./.venv/bin/pytest backend/tests -q`, `./.venv/bin/ruff check backend`,
`./.venv/bin/mypy backend/src/where_my_buck_go`, and from `frontend/`, `npm run lint`, `npm run build`,
and `npm run test:e2e` (requires Playwright Chromium; the test command starts the production server).

Python source lives at `backend/src/where_my_buck_go/`. Existing local PostgreSQL databases named
`fingpt` remain unchanged so the current owner and session history are preserved. After the rename,
sign in again: the app now uses `wmbg_*` cookie names.

For an integration check against a disposable PostgreSQL database, run
`TEST_DATABASE_URL=postgresql+psycopg://... ./.venv/bin/pytest backend/tests -q`.
