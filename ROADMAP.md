# Product Readiness Roadmap

The goal is a dependable local web app for the owner. Production deployment is a later milestone and must wait for explicit owner approval. Each iteration follows this loop: reproduce the highest-priority gap, make one focused change, run the applicable checks, exercise the changed flow in the running Docker app, commit the verified change using Conventional Commits, and update this roadmap with evidence.

## Milestones

### 1. Local Runtime — Complete

- Build and start PostgreSQL, migrations, Flask, and Next.js with `docker compose -f compose.local.yml up -d --build`.
- Verify all services are healthy, `/api/health` returns `{"status":"ok"}`, and `/login` serves the frontend.
- Verify the owner can sign in using the existing local account without replacing its database volume.

**Acceptance:** all services stay healthy after restart; login and authenticated navigation work in the browser.

### 2. Core Owner Journeys — In Progress

- Verify text intake creates a draft, explicit confirmation creates exactly one transaction, and evidence is viewable.
- Verify one-image receipt intake with an optional caption, draft correction/confirmation, and evidence viewing.
- Verify reports, filtered CSV export, edit, soft delete, undo, chat history, and logout.
- Verify transient failures can be retried without duplicate drafts or misleading success states.

**Acceptance:** each journey passes against the local Docker stack and its persisted state matches the UI.

### 3. Reliability and Regression Coverage — In Progress

- Align the frontend image byte limit with the backend limit and improve image URL cleanup and chat-history loading errors.
- Add browser-level coverage for critical owner journeys and regression coverage for idempotency, authorization, and version conflicts.
- Keep strict mypy type checking as a required CI gate.
- Keep backend tests, Ruff, mypy, frontend lint, frontend build, and browser checks green in CI.

**Acceptance:** CI blocks regressions in critical flows and all required checks pass without ignored type-check failures.

### 4. Production Readiness — Not Started

- Implement and verify production evidence storage (R2), deployment configuration, backups, migrations, health checks, and recovery procedures.
- Review secrets, cookies, logging, resource limits, and operational monitoring.
- Deploy only after local acceptance and explicit owner approval.

**Acceptance:** a documented deployment and recovery rehearsal succeeds without exposing local data or secrets.

## Current Evidence

- Chat/image retry keys and proposal confirm/discard retry keys are retained for the same user action; failed discard remains visible and retryable.
- Playwright browser regression tests cover sign-in/sign-out, text-draft review/discard, confirmation retry with the same idempotency key, staged image paste with a caption, separate edit/delete/undo confirmations, filtered CSV export, and CSV formula-injection protection.
- All 7 Playwright tests pass; frontend lint and production build pass.
- Full local CI checks on the current worktree passed: 101 backend tests, Ruff, strict mypy, clean `npm ci`, frontend lint/build, and all 7 Playwright tests; npm audit reports zero vulnerabilities. Local `playwright install --with-deps` needs sudo unavailable here, while `playwright install chromium` and the browser suite pass.
- Strict mypy passes all 27 backend source files; CI now fails on type-check errors.
- Frontend production and full dependency audits report zero vulnerabilities. The runtime image omits development and optional peer packages, including Playwright and ESLint; the minimatch override is scoped to the TypeScript ESLint parser tree.
- At the latest remote check, GitHub main CI was green on `653ebe83`, while local `main` is 15 commits ahead at `845040e`; remote CI has not run on these local commits.
- Local Docker Compose is running PostgreSQL, backend, and frontend. Backend health returned `{"status":"ok"}`, `/login` returned HTTP 200, and the Gemini text smoke test passed without creating a transaction.
- Docker Compose now health-checks the frontend through its `/login` route. After rebuilding/recreating the stack, PostgreSQL, backend, and frontend all reported healthy; authenticated Transactions navigation and the existing owner session remained available, and the visible ledger remained empty.
- The owner signed in through the browser; dashboard, transactions, chat, and settings pages loaded. A live text intake produced the expected draft preview, and discarding it did not write a transaction. A separate synthetic text conversation reloaded from Recent chats with its messages intact.
- A synthetic receipt passed through the live image flow: Gemini extracted 12,000 VND and the exact date/time, then the draft was discarded without a ledger write.
- Transactions-page edit, delete, and undo now create a reviewable proposal first and require a separate confirmation before applying it. Playwright verifies the confirm endpoint is untouched until that explicit action; backend PostgreSQL tests cover persisted ledger changes.
- The live local owner journey confirmed one disposable text transaction, edited it through a separate preview, soft deleted it, restored it through a separate undo preview, and viewed its original evidence. Dashboard totals reflected the edited amount.
- A second live journey confirmed a synthetic receipt transaction for 4,321 VND at the expected date/time and verified that the original image opens from Transactions evidence, then soft deleted it. The text and image test records are both soft deleted; the visible Transactions list is empty. The real owner session was left signed in.
- Frontend image validation now matches the backend's 4,000,000-byte limit; chat history load failures are shown in the conversation, and image preview URLs are revoked when replaced, removed, or unmounted.
