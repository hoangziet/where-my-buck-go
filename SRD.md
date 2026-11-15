# Product and Architecture Requirements

## Product

Where My Buck Go is a personal finance assistant for one owner. The web app supports chat-based income and expense entry, receipt image intake, financial questions, transaction history, reports, CSV export, edits, soft deletes, and undo. There is no public registration. Banking sync, multiple wallets, recurring transactions, budgets, and CSV import are out of scope for v1.

The web app is the first delivery channel. Telegram is a possible later milestone and is not required for the web release.

## Current Architecture

- Backend: Python, Flask, SQLAlchemy, and PostgreSQL with versioned Alembic migrations.
- Frontend: Next.js, React, and TypeScript. The frontend and backend run as separate services in local Docker Compose; the Next.js frontend proxies API requests to the backend.
- AI: Gemini structured function calls for chat routing and receipt extraction. The backend validates model output; the model cannot execute SQL or confirm ledger changes.
- Evidence: private filesystem storage in local development; AWS S3 in the AWS deployment, with the Cloudflare R2 adapter retained for legacy deployments. Production startup validates the selected evidence provider configuration.
- Deployment: local Docker Compose is supported. Production deployment and a background worker are future work; there is no outbox worker currently.

The selected production target is AWS: EC2 and CloudFront for the application, managed RDS PostgreSQL outside
Docker, private S3 evidence storage, and an AWS-provided HTTPS address without a purchased domain.
[AWS Deployment Plan](AWS_DEPLOYMENT_PLAN.md) defines Terraform, AWS CLI, and GitHub CLI automation,
cost assumptions, network gates, and release acceptance. Infrastructure and deployment automation are implemented; cloud provisioning and public-URL acceptance remain pending.

Backend responsibilities are separated into `api/` (HTTP, auth, validation), `domain/` (business rules), `services/` (use cases), and `adapters/` (database, Gemini, and evidence integrations). The owner identity comes from the authenticated session, never from request data.

## Ledger Rules

- Every create, edit, delete, and undo operation starts as a preview. It changes the ledger only after a separate explicit confirmation.
- Writes use a UUID `Idempotency-Key` and an expected version. Replaying the same key and payload returns the original result; reusing a key with a different payload returns a conflict.
- V1 stores VND amounts as exact decimal values and uses `Asia/Ho_Chi_Minh` for local dates and times.
- A transaction needs a date and amount before confirmation. Missing dates are not inferred from upload or processing time. Missing times use a visible, editable default based on the stated period.
- One text message can produce multiple independent proposals. Each proposal requires its own confirmation.
- Each image intake request accepts one PNG or JPEG image and creates one proposal for the receipt total, preserving the original image as evidence. Multiple images are not supported in a single request. An optional caption may clarify merchant or category; receipt amount, date, and time take precedence over caption values.
- Evidence remains associated with its draft and confirmed transaction and can be viewed in the web app.
- Edits, soft deletes, and undo require a preview and explicit confirmation. Chat requests matching multiple transactions require the owner to select one.

## Authentication and Security

- Authentication uses an owner-created username and password; there is no public sign-up or SSO.
- Passwords use Argon2id. Server-side sessions expire after 12 hours and can be revoked. Production cookies use the `__Host-` prefix, `HttpOnly`, and `SameSite=Strict`.
- Mutating authenticated requests require a CSRF token. Login attempts are rate-limited using an HMAC digest of the client address.
- Treat chat, captions, receipt contents, and model responses as untrusted input. Validate all data before applying business rules. Never log secrets or raw financial content.

## Quality and Roadmap

Keep modules cohesive, public Python APIs typed, and TypeScript strict. Cover money, date/time, authorization, idempotency, and draft-confirm behavior with tests. Run the backend tests, Ruff, mypy, frontend lint, and frontend build before reporting a code change as complete.

Implemented local capabilities include authentication, draft/confirm ledger flows, chat, single-image intake, reports, evidence viewing, CSV export, Docker Compose, and an S3-compatible production R2 evidence adapter. Remaining production work follows the AWS deployment plan, including native S3 support, external RDS, automated infrastructure and releases, and a recovery rehearsal. Telegram remains a later integration. Production deployment requires owner authorization for the concrete resource and cost plan.
