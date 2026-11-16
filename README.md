<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="frontend/public/wmbg-wordmark-dark.svg" />
    <img src="frontend/public/wmbg-wordmark.svg" alt="Where My Buck Go" height="46" />
  </picture>
  <h3>The auditable AI personal finance assistant.</h3>
  <p>
    Log expenses in plain language or receipt photos, query your financial history,<br/>
    and inspect every underlying SQL query with zero blind writes and sub-5ms proof citations.
  </p>
  <p>
    <img alt="Python 3.14" src="https://img.shields.io/badge/Python-3.14-3776AB?logo=python&logoColor=white" />
    <img alt="Flask API" src="https://img.shields.io/badge/Flask-API-000000?logo=flask&logoColor=white" />
    <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16%20Turbopack-000000?logo=next.js&logoColor=white" />
    <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" />
    <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" />
    <img alt="PostgreSQL 17" src="https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white" />
    <img alt="AWS CloudFront" src="https://img.shields.io/badge/AWS-CloudFront%20CDN-FF9900?logo=amazon-aws&logoColor=white" />
  </p>
</div>

<img src="docs/assets/landing.png" alt="Where My Buck Go application dashboard" width="100%" />

## Why Where My Buck Go

- **Zero blind writes.** Financial transactions can **never** be written directly by an AI model. Every create, edit, delete, or undo is proposed as an interactive preview draft that requires explicit owner confirmation.
- **Auditable by construction.** Every number in chat answers comes directly from real PostgreSQL queries. The `Steps & SQL` trace panel displays the exact parameterized queries and bound parameters executed against the database.
- **Multimodal receipt intake.** Take a photo of a paper receipt or bill; Gemini 2.5 Flash Vision extracts merchant details, total amounts, and dates into a draft, saving the original high-resolution photo as an immutable evidence record.
- **Sub-5ms citation loading.** Receipt evidence uses content-addressed SHA-256 ETags and HTTP 304 revalidation, eliminating repeated cloud storage reads and streaming evidence modals instantly.
- **Standalone iOS PWA.** Add to iPhone Home Screen for a native app feel: fullscreen standalone mode, dynamic viewport units, no URL chrome, and camera upload integration.

---

## Features

| | |
|---|---|
| 💬 **Conversational Intake** | Log spend in Vietnamese or English (`sáng nay ăn bún bò 55k`) with automatic category taxonomy assignment and timezone-aware date parsing. |
| 📸 **Receipt OCR & Evidence** | Upload receipt images directly; Gemini Vision extracts amounts and items, linking the original image as permanent audit proof. |
| 🛡️ **Two-Step Confirmation** | Propose first, save later. Review draft cards with full edit/discard options before anything touches the immutable ledger. |
| 🔍 **Live Steps & SQL Trace** | View the entire execution pipeline: PostgreSQL transaction locks, idempotency checks, classification steps, and parameterized SQL queries with bound parameter inspection. |
| 🔄 **Live Query Re-run** | Re-execute financial queries with one click (`Refresh Query`) to reflect real-time ledger updates without retyping prompts. |
| 📊 **Financial Dashboard** | Track monthly spending, category breakdowns, income vs. expense balance, and pin frequent Q&A ranges to your dashboard. |
| ⚡ **Fast Evidence Caching** | Batch evidence pre-population (`list_evidence_batch`), private immutable caching headers, and HTTP 304 revalidation (<2ms). |
| 📱 **iOS PWA Standalone** | Web app manifest, custom high-resolution icons, safe-area insets (`env(safe-area-inset-top/bottom)`), and iOS Safari zoom prevention. |
| 🔒 **Enterprise-Grade Security** | Argon2id password hashing, CSRF double-submit protection, `__Host-` secure cookies, advisory transaction locks, and strict `WHERE owner_id = %s` scoping. |

---

## How It Works

A user action flows securely through **Client/PWA → CloudFront → Nginx Proxy → Flask Backend → PostgreSQL / S3 / Gemini**:

```mermaid
flowchart LR
  subgraph Client [Client Tier]
    U[Browser / iOS PWA]
  end

  subgraph Cloud [AWS CloudFront & CDN]
    CF[CloudFront CDN<br/>d1498jatb9ljtb.cloudfront.net]
  end

  subgraph Host [Application Host / Docker Stack]
    NX[Nginx Reverse Proxy<br/>:80 / :443]
    FE[Next.js 16 Frontend<br/>:3000]
    BE[Flask Backend API<br/>:5000]
    DB[(PostgreSQL 17<br/>Append-Only Ledger)]
  end

  subgraph External [External Services]
    AI[Google Gemini 2.5 Flash<br/>Vision & Classification]
    S3[(AWS S3 / Cloudflare R2<br/>Evidence Store)]
  end

  U -->|HTTPS| CF
  CF -->|Proxy Pass| NX
  NX -->|Static & SSR| FE
  NX -->|API Requests| BE
  BE -->|Advisory Locks & SQL| DB
  BE -->|OCR & Routing| AI
  BE -->|Binary Evidence| S3
```

- **Frontend Tier:** Next.js 16 with React 19, Tailwind CSS v4, and strict TypeScript. Handles PWA lifecycle, ClientClock timezone synchronization, and streaming trace visualization.
- **Backend Tier:** Flask application organized into `domain/` (pure business models), `services/` (draft/confirm workflow & chat coordinator), `adapters/` (PostgreSQL, Gemini SDK, S3/R2 evidence), and `api/` (HTTP validation & CSRF).
- **Persistence Tier:** PostgreSQL with Alembic migrations, advisory transaction locks (`pg_advisory_xact_lock`), and atomic idempotency keys.
- **Evidence Storage Tier:** Binary storage with SHA-256 integrity verification, supporting local filesystem, AWS S3, and Cloudflare R2.

---

## Screenshots & Demo

| Governed AI Chat & SQL Trace | Transactions & Instant Citation |
| --- | --- |
| ![Chat with SQL trace](docs/assets/steps-sql.png) | ![Transactions ledger](docs/assets/transactions.png) |

| Receipt OCR Draft Proposal | Standalone iOS PWA |
| --- | --- |
| ![Receipt intake](docs/assets/sample-receipt.png) | ![Mobile PWA](docs/assets/pwa-mobile.png) |

### Walkthrough & Video Showcase

- 🎬 **Watch the full HD video showcase:** [`demo/where-my-buck-go-demo.mp4`](demo/where-my-buck-go-demo.mp4) (available in `frontend/public/videos/`).
- 📋 **Step-by-step test scenario:** [`demo/demo-scenario.md`](demo/demo-scenario.md) (10 comprehensive user flows).
- 🎙️ **10-minute presenter script:** [`demo/demo-presenter-script.md`](demo/demo-presenter-script.md) (Vietnamese narration with English stage cues).

---

## Run It Locally

### Prerequisites
- Docker & Docker Compose
- Python 3.11+ (Python 3.14 tested)
- Node.js 20+

### 1. Quickstart with Docker Compose

Start the full stack (PostgreSQL, migrations, Flask backend, and Next.js frontend):

```bash
# 1. Clone and configure environment
cp .env.example .env
# Edit .env and supply your GEMINI_API_KEY and a random AUTH_HMAC_KEY

# 2. Start the local stack
docker compose -f compose.local.yml up -d --build

# 3. On a fresh database, bootstrap the initial owner account
docker compose -f compose.local.yml exec backend wmbg-bootstrap owner
```

Open <http://localhost:3100> in your browser.

- View logs: `docker compose -f compose.local.yml logs -f frontend backend`
- Stop the stack: `docker compose -f compose.local.yml down` (preserves database volume).

---

### 2. Run Directly on Host (Native Development)

Start PostgreSQL:
```bash
docker compose -f compose.local.yml up -d db
```

Install and run the Backend:
```bash
python3 -m venv .venv
./.venv/bin/pip install -e './backend[dev]'
DATABASE_URL=postgresql+psycopg://fingpt:local-only-change-me@localhost:55432/fingpt ./.venv/bin/alembic upgrade head
set -a && source .env && set +a
./.venv/bin/flask --app where_my_buck_go.api.app:create_app run --port 5000
```

Install and run the Frontend:
```bash
cd frontend
npm ci
npm run dev -- -p 3100
```

---

## Testing & Quality Assurance

Where My Buck Go adheres to strict quality and type guarantees:

```bash
# 1. Run all backend tests (including PostgreSQL integration tests)
TEST_DATABASE_URL=postgresql+psycopg://fingpt:local-only-change-me@localhost:55432/fingpt ./.venv/bin/pytest backend/tests -q

# 2. Python lint and type checks (0 warnings, strict mypy)
./.venv/bin/ruff check backend
./.venv/bin/mypy --config-file backend/pyproject.toml backend/src/where_my_buck_go

# 3. Frontend lint and Next.js production build
cd frontend && npm run lint && npm run build

# 4. Playwright End-to-End tests
cd frontend && npm run test:e2e
```

### Gemini Adapter Smoke Tests

Verify Gemini AI connectivity and function calling without creating ledger writes:

```bash
# Harmless text classification check
./.venv/bin/wmbg-gemini-smoke

# Read-only receipt OCR extraction check
./.venv/bin/wmbg-gemini-image-smoke docs/assets/sample-receipt.png --expect-amount 17500 --expect-date 2026-11-09 --expect-time 18:36
```

---

## Backup & Recovery

- **Local Backup:** Run `./scripts/backup-local.sh` to capture a consistent, checksummed archive of the PostgreSQL database and evidence store.
- **Production Backup:** Run `./scripts/backup-production.sh /path/to/encrypted-storage` to create a verified snapshot of PostgreSQL and Cloudflare R2 / AWS S3 evidence objects.
- **Restore:** Use `./scripts/restore-production.sh --confirm-replace-production-data /path/to/backup.tar.gz` with sidecar SHA-256 verification.

---

## Production Deployment (AWS)

The production application is deployed on AWS at:
**<https://d1498jatb9ljtb.cloudfront.net>**

- **Architecture:** CloudFront CDN → AWS EC2 / Lightsail Host (Nginx Reverse Proxy + Docker Compose) → PostgreSQL & AWS S3 / Cloudflare R2.
- **Configuration & Playbooks:** See [`AWS_DEPLOYMENT_PLAN.md`](AWS_DEPLOYMENT_PLAN.md) and [`deploy/aws/README.md`](deploy/aws/README.md).

---

## Repository Layout

```text
backend/
  src/where_my_buck_go/
    api/              HTTP routes, validation, and CSRF protection
    domain/           Pure domain entities (Money, Ledger, ImagePreview)
    services/         Application services (Ledger, Chat, Image, History, DebugTrace)
    adapters/         PostgreSQL repos, Gemini AI SDK, S3/R2 evidence storage
  migrations/         Alembic database migration versions
  tests/              Unit and PostgreSQL integration tests (137 tests)
frontend/
  src/app/            Next.js App Router (chat, transactions, dashboard, login)
  src/components/     Shared React components (TopNav, TracePanel, FinancialTable)
  src/lib/            API clients, authentication context, and currency formatters
  public/             PWA manifest, icons, wordmarks, and demo video
demo/
  demo-scenario.md    Detailed 10-step walkthrough test scenarios
  demo-presenter-script.md 10-minute presentation guide with timing cues
  make_demo_video.py  Reproducible FFmpeg demo video generator
  where-my-buck-go-demo.mp4 Full HD 1080p demo walkthrough video
docs/
  assets/             Curated high-resolution UI snapshots and sample receipts
infra/
  aws/                Terraform definitions for AWS compute, network, and IAM
scripts/
  aws/                Release automation and AWS management scripts
  backup-local.sh     Local backup script with checksum verification
  restore-production.sh Safe production restore with pre-flight checks
```

- Product requirements and rules: [`SRD.md`](SRD.md)
- Development domain glossary: [`GLOSSARY.md`](GLOSSARY.md)
- Engineering guidelines and rules: [`AGENTS.md`](AGENTS.md)
