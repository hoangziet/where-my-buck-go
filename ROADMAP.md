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

**Acceptance:** core hosted flows and backup restoration are verified without exposing local data or secrets; browser confirmation, CSV export, rollback, and restore to a separate RDS host remain open.

## Remaining Work — Ordered Gates

1. **Complete public-browser acceptance.** Verify explicit transaction confirmation/discard, CSV export, secure cookies, CSRF, and slow Gemini handling through the live URL with synthetic data.
2. **Rehearse rollback.** Review migration compatibility, then verify rollback to previous image digests without changing the database.
3. **Rehearse cross-instance recovery.** The AWS Free Plan currently permits only one RDS instance. Repeat restore against a separate RDS host when the account plan permits it; current archive restore was verified in a distinct temporary database on the existing instance.
4. **Finish operational handover.** Review actual AWS charges against the budget notification; add an SNS email subscription if inbox delivery is desired.

## Current Evidence

### Verified locally

- The local Compose stack is running PostgreSQL, Flask, and Next.js. All services report healthy; `/api/health` returns `{"status":"ok"}` and `/login` returns HTTP 200.
- Core owner journeys have been exercised locally: text and one-image receipt drafts, explicit confirmation/discard, reports, filtered CSV, evidence viewing, chat history, and edit/delete/undo proposals. The live-write Playwright journey passed on an isolated synthetic owner and database.
- Backend checks pass: 121 pytest cases against disposable PostgreSQL, Ruff, and strict mypy across 30 source files. `pip-audit` and `npm audit` report no known vulnerabilities; frontend lint and production build pass, and Playwright passes 9 tests with its real-write case skipped by default.
- CI includes Python and npm vulnerability audits, PostgreSQL and frontend checks, local Compose owner journeys, local backup/restore verification, production-profile security checks, plus production PostgreSQL/R2 backup and restore against S3Mock. A local rehearsal restored one synthetic evidence object and verified its SHA-256 against the restored database.
- Production configuration includes isolated backend networking, health checks, resource/log limits, secure cookies and proxy handling. `ROADMAP.md` and production runbooks document the remaining release gates.

### Verified in AWS

- Production URL: https://d1498jatb9ljtb.cloudfront.net. Release commit: `0221f2d4e8298fd3f3c0ce777202e3e63fa0447e`.
- Health, authenticated API login/logout, report summary, chat Q&A, one-image draft/evidence retrieval, and zero active transactions were verified. Synthetic receipt intake was discarded without writing to the ledger.
- Daily PostgreSQL/evidence backup objects were downloaded and matched their manifest SHA-256 values. Restore produced one chat, two messages, the known QA message, and zero transactions; evidence restore verified zero objects.
- A separate-database restore rehearsal used a temporary database on the same RDS host because the AWS Free Plan rejected creation of another RDS instance. The temporary database, SecureString parameter, IAM policy, and S3 bucket were deleted. Production health/login checks still pass.

### Continuous delivery loop

For each iteration, take the highest open gate, define observable acceptance evidence, make one focused change, run applicable checks, commit with Conventional Commits, and update this roadmap. Production infrastructure changes use reviewed PRs; do not push directly to `main`. AWS releases remain terminal-driven from CI-approved commits, and GitHub Actions never deploys to AWS.
