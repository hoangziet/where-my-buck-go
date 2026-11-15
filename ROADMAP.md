# Product Readiness Roadmap

The goal is a dependable owner-operated app. Local development remains supported, and production is deployed on AWS. Each iteration follows this loop: reproduce the highest-priority gap, make a focused change, run applicable checks, exercise the changed flow, commit with Conventional Commits, and update this roadmap with evidence.

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

### 4. Production Readiness — Deployed, Acceptance In Progress

- Implement the [AWS deployment plan](AWS_DEPLOYMENT_PLAN.md): managed RDS outside Docker, native S3 evidence storage, an AWS-provided HTTPS address, and Terraform/AWS CLI/GitHub CLI automation. Existing R2 recovery checks remain useful regression coverage.
- Production is deployed at the AWS CloudFront URL using managed RDS outside Docker, native S3 evidence storage, and Terraform/AWS CLI/GitHub CLI automation.
- Verify operational behavior through the public URL with synthetic data and record remaining browser acceptance.

**Acceptance:** core hosted flows and backup restoration are verified without exposing local data or secrets; live-data CSV export, Gemini timeout handling, rollback rehearsal, and restore to a separate RDS host remain open.

## Remaining Work — Ordered Gates

1. **Verify live-data CSV export.** Test live-data CSV export without retaining synthetic financial records. Prefer an isolated disposable owner/database if feasible; otherwise ask before creating and confirming a production transaction.
2. **Verify Gemini slow/timeout and error handling.** Verify Gemini slow/timeout behavior and user-facing retry/error handling without accidental duplicate drafts. Begin with deterministic fault-injection tests in an isolated environment to avoid unnecessary paid Gemini calls.
3. **Rehearse rollback.** Review migration compatibility, then verify image rollback to previous digests without changing the database (the runtime does not roll back schema automatically).
4. **Rehearse cross-instance recovery.** The AWS Free Plan currently permits only one RDS instance. Repeat restore against a separate RDS host when the account plan permits it; archive restore was verified in a distinct temporary database on the existing RDS host.
5. **Finish operational handover and cost monitoring.** Review actual AWS charges against the $50 budget notification and decide whether an SNS email subscription is needed (Cost Explorer showed $0 for 2026-11-01 through 2026-11-16; billing data can lag).

## Current Evidence

### Verified locally

- The local Compose stack is running PostgreSQL, Flask, and Next.js. All services report healthy; `/api/health` returns `{"status":"ok"}` and `/login` returns HTTP 200.
- Core owner journeys have been exercised locally: text and one-image receipt drafts, explicit confirmation/discard, reports, filtered CSV, evidence viewing, chat history, and edit/delete/undo proposals. The live-write Playwright journey passed on an isolated synthetic owner and database.
- Backend checks pass: 121 pytest cases against disposable PostgreSQL, Ruff, and strict mypy across 30 source files. `pip-audit` and `npm audit` report no known vulnerabilities; frontend lint and production build pass, and Playwright passes 9 tests with its real-write case skipped by default.
- CI includes Python and npm vulnerability audits, PostgreSQL and frontend checks, local Compose owner journeys, local backup/restore verification, production-profile security checks, plus production PostgreSQL/R2 backup and restore against S3Mock. A local rehearsal restored one synthetic evidence object and verified its SHA-256 against the restored database.
- Production configuration includes isolated backend networking, health checks, resource/log limits, secure cookies and proxy handling. `ROADMAP.md` and production runbooks document the remaining release gates.

### Verified in AWS

- Production URL: https://d1498jatb9ljtb.cloudfront.net. Release commit: `cc07b0f92d65a0451c68f24378a9cffcdca51f39`.
- Health endpoint returned HTTP 200 and `{"status":"ok"}` on 2026-11-16.
- PR #16 (production CSRF cookie fix) and PR #15 (deployment status documentation) are merged and deployed. Required `backend`, `frontend`, `docker-compose`, and `aws-infrastructure` checks passed on the release commit.
- Authenticated production checks passed for login/logout, reports and transaction reads, secure `__Host-wmbg_csrf` cookie, and a CSRF-protected synthetic draft that was discarded. No transaction was confirmed; the active ledger remained empty.
- Public-browser login/logout passed. CSV download and contents passed in the production UI with a browser-only fixture because the production ledger is empty and the export button is disabled when there are no rows.
- Daily PostgreSQL/evidence backup objects were downloaded and matched their manifest SHA-256 values. Restore rehearsal into a separate temporary database on the existing RDS host passed; all temporary restore resources were removed.

### Continuous delivery loop

For each iteration, take the highest open gate, define observable acceptance evidence, make one focused change, run applicable checks, commit with Conventional Commits, and update this roadmap. Production infrastructure changes use reviewed PRs; do not push directly to `main`. AWS releases remain terminal-driven from CI-approved commits, and GitHub Actions never deploys to AWS.
