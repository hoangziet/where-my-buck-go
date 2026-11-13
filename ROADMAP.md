# Product Readiness Roadmap

The goal is a dependable local web app for the owner. Production deployment is a later milestone and must wait for explicit owner approval. Each iteration follows this loop: reproduce the highest-priority gap, make one focused change, run the applicable checks, exercise the changed flow in the running Docker app, commit the verified change using Conventional Commits, and update this roadmap with evidence.

## Milestones

### 1. Local Runtime — Complete

- Build and start PostgreSQL, migrations, Flask, and Next.js with `docker compose -f compose.local.yml up -d --build`.
- Verify all services are healthy, `/api/health` returns `{"status":"ok"}`, and `/login` serves the frontend.
- Verify the owner can sign in using the existing local account without replacing its database volume.

**Acceptance:** all services stay healthy after restart; login and authenticated navigation work in the browser.

### 2. Core Owner Journeys — Complete

- Verify text intake creates a draft, explicit confirmation creates exactly one transaction, and evidence is viewable.
- Verify one-image receipt intake with an optional caption, draft correction/confirmation, and evidence viewing.
- Verify reports, filtered CSV export, edit, soft delete, undo, chat history, and logout.
- Verify transient failures can be retried without duplicate drafts or misleading success states.

**Acceptance:** each journey passes against the local Docker stack and its persisted state matches the UI.

### 3. Reliability and Regression Coverage — Complete

- Align the frontend image byte limit with the backend limit and improve image URL cleanup and chat-history loading errors.
- Add browser-level coverage for critical owner journeys and regression coverage for idempotency, authorization, and version conflicts.
- Keep strict mypy type checking as a required CI gate.
- Keep backend tests, Ruff, mypy, frontend lint, frontend build, and browser checks green in CI.

**Acceptance:** CI blocks regressions in critical flows and all required checks pass without ignored type-check failures.

### 4. Production Readiness — In Progress

- Implement and verify production evidence storage (R2), deployment configuration, backups, migrations, health checks, and recovery procedures.
- Review secrets, cookies, logging, resource limits, and operational monitoring.
- Deploy only after local acceptance and explicit owner approval.

**Acceptance:** a documented deployment and recovery rehearsal succeeds without exposing local data or secrets.

## Current Evidence

- Chat/image retry keys and proposal confirm/discard retry keys are retained for the same user action; failed discard remains visible and retryable.
- Playwright browser regression tests cover sign-in/sign-out, text-draft review/discard, confirmation retry with the same idempotency key, staged image paste with a caption, separate edit/delete/undo confirmations, filtered CSV export, and CSV formula-injection protection.
- The fixture-driven Playwright suite can target `PLAYWRIGHT_BASE_URL`; all 9 browser tests passed against the production frontend container. CSV download and filtered contents were verified using controlled API fixtures, and the Docker Compose CI job runs this suite against the built container.
- A separate live-stack Playwright journey passed against isolated Docker PostgreSQL, Flask, and production Next.js: it logged in, created and confirmed a disposable proposal through the real API, checked persisted transactions, filtered CSV contents and report totals, soft deleted the row, verified API/report totals returned to zero, and logged out.
- The Docker Compose CI job provisions its own disposable owner and runs this live-stack test after the fixture-driven suite. GitHub run `43358809631` passed all three jobs, including the live-stack journey.
- The local backup command captures the PostgreSQL custom dump and evidence volume while app services are stopped, verifies the dump/archive, writes a private archive and SHA-256 sidecar, then restarts the app. A backup/restore rehearsal on isolated Compose projects restored the owner, soft-deleted transaction, and evidence file with its stored SHA-256; the restored app passed the live owner E2E. Also re-run directly against the real local Docker stack (backup only, not restore, to avoid touching the owner's live data): the archive, checksum, and manifest were all valid, and the app came back healthy. GitHub run `43359468921` passed the full CI workflow including backup, restore, checksum verification, and the rerun owner journey after recovery.
- Nine fixture-driven Playwright tests pass against the production frontend; the dedicated live-stack case passes separately. Frontend lint and TypeScript checks pass.
- Full local CI checks on the prior current worktree passed: 101 backend tests, Ruff, strict mypy, clean `npm ci`, frontend lint/build, and 7 Playwright tests; npm audit reported zero vulnerabilities. The later added regression cases and live-stack journey also pass locally.
- Strict mypy passes all 27 backend source files; CI now fails on type-check errors.
- Frontend production and full dependency audits report zero vulnerabilities. The runtime image omits development and optional peer packages, including Playwright and ESLint; the minimatch override is scoped to the TypeScript ESLint parser tree.
- GitHub main CI passed on `24197c4` (`43358809631`): backend tests, Ruff, strict mypy, frontend lint/build and Playwright, Docker Compose health/routes, and the authenticated live-stack owner journey all passed. The backup/restore steps added in this worktree are newer and await their own GitHub run.
- Local Docker Compose is running PostgreSQL, backend, and frontend. Backend health returned `{"status":"ok"}`, `/login` returned HTTP 200, and the Gemini text smoke test passed without creating a transaction.
- Docker Compose now health-checks the frontend through its `/login` route. After rebuilding/recreating the stack, PostgreSQL, backend, and frontend all reported healthy; authenticated Transactions navigation and the existing owner session remained available, and the visible ledger remained empty.
- The owner signed in through the browser; dashboard, transactions, chat, and settings pages loaded. A live text intake produced the expected draft preview, and discarding it did not write a transaction. A separate synthetic text conversation reloaded from Recent chats with its messages intact.
- A synthetic receipt passed through the live image flow: Gemini extracted 12,000 VND and the exact date/time, then the draft was discarded without a ledger write.
- Transactions-page edit, delete, and undo now create a reviewable proposal first and require a separate confirmation before applying it. Playwright verifies the confirm endpoint is untouched until that explicit action; backend PostgreSQL tests cover persisted ledger changes.
- The live local owner journey confirmed one disposable text transaction, edited it through a separate preview, soft deleted it, restored it through a separate undo preview, and viewed its original evidence. Dashboard totals reflected the edited amount.
- A separate live owner check confirmed a synthetic expense appeared in Transactions and the matching dashboard/category totals, applied expense and category filters, then soft deleted the row. The dashboard and transaction list returned to zero afterward.
- A second live journey confirmed a synthetic receipt transaction for 4,321 VND at the expected date/time and verified that the original image opens from Transactions evidence, then soft deleted it. The text and image test records are both soft deleted; the visible Transactions list is empty. The real owner session was left signed in.
- Frontend image validation now matches the backend's 4,000,000-byte limit; chat history load failures are shown in the conversation, and image preview URLs are revoked when replaced, removed, or unmounted.
- The chat draft Confirm button previously had no in-flight guard: two clicks before the first request resolved fired two concurrent `confirmProposal` calls, and the error state had no retry action, so a successful confirm could still render as a dead-end failure. Verified by double-clicking Confirm on a real Gemini-generated draft in the browser: exactly one `/confirm` request and one transaction resulted, and the UI now shows a disabled "Confirming…" state in between plus a working "Try again" affordance on genuine failures.
- Sessions were only ever soft-revoked (logout, password reset), never deleted, so a session that expired without an explicit logout stayed in the table forever. `create_session` now prunes rows past their own expiry (compared against the database's clock, not the new row's own future `expires_at` — an earlier draft compared against the wrong timestamp and would have deleted other still-valid sessions, caught before committing). A new live-PostgreSQL test proves a long-expired, never-logged-out row is pruned on the next login while a fresh session survives; verified against the real local dev database, where 16 stale expired rows dropped to 1 immediately.
- Any 401 from an authenticated API call (not the initial `/api/auth/me` check) previously left the user stuck on the current page showing a raw backend error, since nothing logged them out or redirected. `api.ts` now reports unauthorized responses to `AuthProvider`, which clears the session and redirects to `/login?expired=1` with a plain-language message. Verified end-to-end in the browser: killed a live session server-side mid-use and confirmed the redirect and message both fire.
- Two gaps the "regression coverage for idempotency, authorization, and version conflicts" acceptance criterion called for were still open: the mid-session 401 redirect above had only manual verification, and `handleStaleVersion`'s 409 recovery on Transactions (refresh the list instead of applying a stale edit) had no automated coverage at all. Both now have Playwright cases in `auth.spec.ts` and `transactions.spec.ts`.
