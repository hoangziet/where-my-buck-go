# Repository Guidelines

## Language

Think and write repository content in English; reply to users in Vietnamese. Keep code, identifiers, comments, prompts, logs, tests, and technical docs in English. Preserve Vietnamese literals only when needed for Vietnamese product behavior or tests. Write Vietnamese docs only on explicit user request.

## Project Structure

- `backend/src/where_my_buck_go/` contains the Flask application, organized into `api/`, `domain/`, `services/`, and `adapters/`.
- `backend/migrations/versions/` contains Alembic migrations; `backend/tests/` contains pytest tests.
- `frontend/src/app/` contains Next.js routes; shared components and API helpers live in `frontend/src/components/` and `frontend/src/lib/`.
- `README.md` documents local setup.

## Build, Test, and Development

- `docker compose -f compose.local.yml up -d --build` builds and starts PostgreSQL, migrations, backend, and frontend. Open `http://localhost:3100`.
- `TEST_DATABASE_URL=postgresql+psycopg://... ./.venv/bin/pytest backend/tests -q` runs backend tests, including PostgreSQL integration tests. Use a disposable database; integration tests create and drop a temporary schema.
- `./.venv/bin/ruff check backend` and `./.venv/bin/mypy backend/src/where_my_buck_go` check Python style and types.
- From `frontend/`, run `npm ci`, `npm run lint`, and `npm run build`. For development, use `npm run dev -- -p 3100`.

## Code Quality and Style

Write clean, readable, maintainable code: use clear names and small cohesive functions; avoid duplication and needless abstractions. Use four spaces in Python and TypeScript/React formatting. Python names use `snake_case`; React components and types use `PascalCase`; migrations use numbered prefixes. Put business rules in `domain/` or `services/`, integrations in `adapters/`, and HTTP validation in `api/`. Preserve strict typing. For frontend changes, follow `frontend/AGENTS.md` and read the relevant guide under `frontend/node_modules/next/dist/docs/`.

## Testing and Commits

Name tests `test_*.py` / `test_*`. Cover changed behavior, especially authorization, idempotency, money/date handling, and draft confirmation. Run relevant checks before committing.

Use [qoomon's Conventional Commit format](https://gist.github.com/qoomon/5dfcdf8eec66a051ecd85625518cfd13): `type(scope): description` (`scope` optional). Choose an appropriate type: `feat`, `fix`, `test`, `style`, `docs`, `build`, `ops`, `chore`, `perf`, or `refactor`. Use a concise, imperative, lowercase description with no final period. Mark breaking changes with `!` and explain them in a `BREAKING CHANGE:` footer. Commit each coherent, verified change promptly. Check `git status` and stage only related files; never include secrets or unrelated user changes. PRs should describe behavior and checks, link an issue when available, and show screenshots for UI changes.

## Security

Keep secrets in `.env`; never commit credentials or real financial data. Use `AUTH_HMAC_KEY` and `GEMINI_API_KEY` from environment configuration. Preserve CSRF, owner scoping, parameterized SQL, and explicit confirmation for ledger writes. Avoid `docker compose down -v` unless intentionally deleting local data.
