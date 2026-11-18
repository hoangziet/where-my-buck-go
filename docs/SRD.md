# Product and Architecture Requirements

## Product

Where My Buck Go is a personal finance assistant for one owner. The web app supports chat-based income and expense entry, receipt image intake, financial questions, transaction history, reports, CSV export, edits, soft deletes, and undo. There is no public registration. Banking sync, multiple wallets, recurring transactions, budgets, and CSV import are out of scope for v1.

The web app is the primary delivery channel. A personal Telegram bot can be connected from Settings and paired to one private Telegram chat. Telegram messages use the same draft and explicit-confirmation ledger rules as the web chat.

## Current Architecture

- Backend: Python, Flask, SQLAlchemy, and PostgreSQL with versioned Alembic migrations.
- Frontend: Next.js, React, and TypeScript. The frontend and backend run as separate services in local Docker Compose; the Next.js frontend proxies API requests to the backend.
- AI: Gemini structured function calls for chat routing and receipt extraction. The backend validates model output; the model cannot execute SQL or confirm ledger changes.
- Evidence: private filesystem storage in local development; AWS S3 in the AWS deployment, with the Cloudflare R2 adapter retained for legacy deployments. Production startup validates the selected evidence provider configuration.
- Deployment: local Docker Compose is supported. Production is deployed on AWS with EC2 and CloudFront, managed RDS PostgreSQL, private S3 evidence storage, and Terraform-managed infrastructure. There is no background outbox worker.

The selected production target is AWS: EC2 and CloudFront for the application, managed RDS PostgreSQL outside
Docker, private S3 evidence storage, and an AWS-provided HTTPS address without a purchased domain.
[AWS Deployment Plan](../deploy/aws/DEPLOYMENT_PLAN.md) defines Terraform, AWS CLI, and GitHub CLI automation,
cost assumptions, network gates, and release acceptance. Production is deployed at
https://d1498jatb9ljtb.cloudfront.net. Authenticated API and browser login/logout, report reads,
secure CSRF cookie handling, a discarded synthetic draft, backup hashes, and a separate-database
restore rehearsal have passed. Live-data CSV export, Gemini timeout handling, rollback rehearsal,
and a restore to a separate RDS host remain open acceptance work.

Backend responsibilities are separated into `api/` (HTTP, auth, validation), `domain/` (business rules), `services/` (use cases), and `adapters/` (database, Gemini, and evidence integrations). The owner identity comes from the authenticated session, never from request data.

## Ledger Rules

- Every create, edit, delete, and undo operation starts as a preview. It changes the ledger only after a separate explicit confirmation.
- Writes use a UUID `Idempotency-Key` and an expected version. Replaying the same key and payload returns the original result; reusing a key with a different payload returns a conflict.
- V1 stores VND amounts as exact decimal values and uses `Asia/Ho_Chi_Minh` for local dates and times.
- A transaction needs a date and amount before confirmation. A chat entry that states no date is drafted for today in the owner's timezone, shown on the draft and editable before confirmation; receipt images must show their own payment date. Missing times use a visible, editable default based on the stated period.
- One text message can produce multiple independent proposals. Each proposal requires its own confirmation.
- Each image intake request accepts one PNG or JPEG image and creates one proposal for the receipt total, preserving the original image as evidence. Multiple images are not supported in a single request. An optional caption may clarify merchant or category; receipt amount, date, and time take precedence over caption values.
- Evidence remains associated with its draft and confirmed transaction and can be viewed in the web app.
- Receipt images remain linked to the user message in chat history and render again when the owner reopens that conversation.
- Edits, soft deletes, and undo require a preview and explicit confirmation. Chat requests matching multiple transactions require the owner to select one.
- Transactions can be viewed in a month calendar; date-range filters support the current week and month.

## Telegram Integration

- Each owner may connect one personal Telegram bot by providing a BotFather token in Settings. The token is encrypted at rest; Telegram webhook secrets and one-time pairing codes are stored as digests.
- The bot is paired through a short-lived code and accepts messages only from its paired private chat. Chat drafts are never written to the ledger without `/confirm <draft-id>`; `/discard <draft-id>` discards a draft.
- Disconnecting removes the stored connection and asks Telegram to delete the webhook. The app's HTTPS origin must be reachable by Telegram for webhooks to work.

## Public Information Pages

- Landing-page footer links lead to Privacy, Terms, and Contact pages. Contact and privacy requests use the owner-provided address `hoangziet22@gmail.com`.

## Authentication and Security

- Authentication uses an owner-created username and password; there is no public sign-up or SSO.
- Passwords use Argon2id. Server-side sessions slide: they expire after 30 days without use, are renewed at most once a day while in use, and can be revoked. Production session cookies use the `__Host-` prefix, `Secure`, and `HttpOnly`; `SameSite` is `Strict` for password login and `Lax` for Google sign-in and renewals, with CSRF tokens required on every mutating request.
- Mutating authenticated requests require a CSRF token. Login attempts are rate-limited using an HMAC digest of the client address.
- Treat chat, captions, receipt contents, and model responses as untrusted input. Validate all data before applying business rules. Never log secrets or raw financial content.

## Quality and Maintenance

Keep modules cohesive, public Python APIs typed, and TypeScript strict. Cover money, date/time, authorization, idempotency, and draft-confirm behavior with tests. Run the backend tests, Ruff, mypy, frontend lint, and frontend build before reporting a code change as complete.

Implemented capabilities include authentication, draft/confirm ledger flows, web chat, personal Telegram bot integration, single-image intake with chat-history evidence, calendar and list transaction views, public privacy/terms/contact pages, reports, evidence viewing, CSV export, Docker Compose, AWS S3 and R2 evidence adapters, managed RDS, Terraform infrastructure, and terminal-driven releases. Production follow-up acceptance follows the AWS deployment plan.
