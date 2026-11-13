# Product Readiness Roadmap

The goal is a dependable local web app for the owner. Production deployment is a later milestone and must wait for explicit owner approval. Each iteration follows this loop: reproduce the highest-priority gap, make one focused change, run the applicable checks, exercise the changed flow in the running Docker app, commit the verified change using Conventional Commits, and update this roadmap with evidence.

## Milestones

### 1. Local Runtime — In Progress

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
- Backend test suite passed: 101 tests. Ruff, frontend lint, and frontend production build passed.
- Strict mypy passes all 27 backend source files; CI now fails on type-check errors.
- Local Docker Compose is running PostgreSQL, backend, and frontend. Backend health returned `{"status":"ok"}`, `/login` returned HTTP 200, and the Gemini text smoke test passed without creating a transaction.
- The owner signed in through the browser; dashboard, transactions, chat, and settings pages loaded. No ledger write was made during browser verification, so transaction creation and correction journeys remain unverified.
- Frontend image validation now matches the backend's 4,000,000-byte limit; chat history load failures are shown in the conversation, and image preview URLs are revoked when replaced, removed, or unmounted.
