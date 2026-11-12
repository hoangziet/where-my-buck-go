# Where My Buck Go

Local-first personal finance assistant with authentication, a preview/confirm ledger and text chat.
The web chat can create drafts and confirm them only through a separate user action. Transaction
history supports separate edit/delete/undo previews and confirmation. The web can inspect a PNG/JPEG
payment image through Gemini in read-only mode; image evidence and image-to-draft are not available yet.
Gemini also has separate local smoke tests.
`SRD.md` records the agreed product rules; no old SQLite code or data is imported.

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
With `GEMINI_API_KEY` set, Gemini routes web text chat to owner-scoped read-only totals or creates
draft proposals. It cannot confirm transactions or execute SQL. Chat history is client-supplied and
bounded to eight turns; it is not yet persisted server-side.
To test a single image locally without saving it, run
`./.venv/bin/wmbg-gemini-image-smoke image.png --expect-amount 17500 --expect-date 2026-11-09 --expect-time 18:36`.
Only PNG/JPEG files up to 4 MB are sent to Gemini. The CLI and web image-preview endpoint are read-only
extraction checks, not receipt storage or transaction proposals; the image is shared with the Gemini API.

## Ledger API (local)

All ledger writes require an authenticated session, its `X-CSRF-Token` header, a new UUID
`Idempotency-Key` header, and `expectedVersion` in JSON. Creating a proposal uses version `0`;
confirming or editing a proposal uses its previewed version. Reusing a key with a different body
returns `409`; repeating an identical request returns the original response. The model cannot call
the confirm route. `POST /api/proposals` creates a draft; `PATCH /api/proposals/<id>` completes or
replaces one; `POST /api/proposals/<id>/confirm` is a distinct, explicit action. For existing
transactions, `POST /api/proposals/changes` with `operation: edit|delete|undo`, `targetId` and
the transaction's `expectedVersion` creates a separate preview. `GET /api/proposals/<id>` and
`GET /api/transactions/<id>` include owner-scoped `evidenceIds`; fetch original text via
`GET /api/evidence/<id>`. `GET /api/proposals` lists up to 200 open owner drafts, including after a
page reload. Every proposal requires original `evidenceText`. Missing date stays a
draft; a missing time receives a marked default. Local evidence lives in private `.local-evidence/`.
The app refuses to start with filesystem evidence in production until the R2 adapter is available.

`POST /api/chat/messages` accepts `{ "text": "...", "history": [], "expectedVersion": 0 }`
with the same session, CSRF, and UUID idempotency header. Read-only totals support a single day,
this/last month, or a validated custom range up to 366 days. It returns either a read-only answer,
an explicit selection request for edits/deletes, or separate draft previews for extracted items.
Retry a failed request with its original key; successful replays return the same previews.
`POST /api/chat/image-preview` accepts multipart `image` with CSRF and returns a validated read-only
payment preview. It neither stores the image nor creates a transaction.

## Checks

`./.venv/bin/pytest backend/tests -q`, `./.venv/bin/ruff check backend`,
`./.venv/bin/mypy backend/src/where_my_buck_go`, and `cd frontend && npm run build`.

Python source lives at `backend/src/where_my_buck_go/`. Existing local PostgreSQL databases named
`fingpt` remain unchanged so the current owner and session history are preserved. After the rename,
sign in again: the app now uses `wmbg_*` cookie names.

For an integration check against a disposable PostgreSQL database, run
`TEST_DATABASE_URL=postgresql+psycopg://... ./.venv/bin/pytest backend/tests -q`.
