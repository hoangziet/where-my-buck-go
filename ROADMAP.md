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

## Remaining Work — Ordered Gates

1. **Validate the current source on GitHub.** The latest successful run is `43360142327` at `dca45f0`; `origin/main` is still at that commit while the local branch is 21 commits ahead. Publish the reviewed commits, then require every CI job to pass before calling the branch verified.
2. **Verify live R2 access.** Configure a private bucket and bucket-scoped token, then exercise disposable text and image upload/read/delete operations and compare SHA-256 values. Keep owner receipts out of this test.
3. **Prepare a production-like recovery target.** Select a host and domain, configure TLS, production secrets, firewall rules, and off-host encrypted backups. Rehearse PostgreSQL and evidence recovery against live R2 without using local owner data.
4. **Deploy only with explicit owner approval.** Take a verified backup, deploy, check health/login/evidence flows and monitoring, and verify a tested rollback path before treating production readiness as complete.

## Current Evidence

### Verified locally

- The local Compose stack is running PostgreSQL, Flask, and Next.js. All services report healthy; `/api/health` returns `{"status":"ok"}` and `/login` returns HTTP 200.
- Core owner journeys have been exercised locally: text and one-image receipt drafts, explicit confirmation/discard, reports, filtered CSV, evidence viewing, chat history, and edit/delete/undo proposals. The live-write Playwright journey passed on an isolated synthetic owner and database.
- Backend checks pass: 121 pytest cases against disposable PostgreSQL, Ruff, and strict mypy across 30 source files. Frontend lint and production build pass; Playwright passes 9 tests, with its real-write case skipped by default.
- CI includes PostgreSQL and frontend checks, local Compose owner journeys, local backup/restore verification, production-profile security checks, plus production PostgreSQL/R2 backup and restore against S3Mock. A local rehearsal restored one synthetic evidence object and verified its SHA-256 against the restored database.
- Production configuration includes isolated backend networking, health checks, resource/log limits, secure cookies and proxy handling. `ROADMAP.md` and production runbooks document the remaining release gates.

### Continuous delivery loop

For each iteration, take the highest open gate, define observable acceptance evidence, make one focused change, run its tests and relevant Docker journey, commit the verified change using Conventional Commits, and update this roadmap with results. If GitHub CI fails, fix that failure before advancing to deployment. Keep production deployment behind the owner approval gate.
