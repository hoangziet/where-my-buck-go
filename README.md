<div align="center">
  <img src="docs/assets/hero.svg" alt="A calm, clear view of personal finances" width="900" />

  # Where My Buck Go

  **A personal finance assistant that keeps every decision in your hands.**

  Say what you spent, or snap a receipt. The assistant prepares a draft; nothing reaches your ledger until you confirm it.

  [Live app](https://d1498jatb9ljtb.cloudfront.net) · [▶ 15-second demo](demo-video-15s/output/demo-15s.mp4) · [Deployment runbook](deploy/aws/README.md)

  <br />

  <img src="docs/assets/demo-15s/demo.gif" alt="15-second product demo: log a lunch in chat, review the draft, confirm it, and watch the monthly dashboard update" width="800" />
</div>

---

## How it works

<table>
  <tr>
    <td width="33%"><img src="docs/assets/demo-15s/draft-review.png" alt="A chat message becomes a draft preview awaiting review" /></td>
    <td width="33%"><img src="docs/assets/demo-15s/confirmed.png" alt="The owner confirms the draft and it is saved" /></td>
    <td width="33%"><img src="docs/assets/demo-15s/dashboard.png" alt="The monthly dashboard reflects the confirmed expense" /></td>
  </tr>
  <tr>
    <td align="center"><strong>1. Say it</strong><br />Describe a spend in plain language or attach one receipt image. The assistant proposes a draft.</td>
    <td align="center"><strong>2. Review it</strong><br />Check the amount, category, and date. Confirm or discard &mdash; the model can never save on its own.</td>
    <td align="center"><strong>3. See your month</strong><br />Confirmed entries update totals, categories, and recent transactions right away.</td>
  </tr>
</table>

## Product highlights

<table>
  <tr>
    <td width="33%" align="center"><img src="docs/assets/review-before-save.svg" alt="A draft is reviewed before saving" width="240" /><br /><strong>Review before saving</strong><br />Entries stay drafts until you explicitly confirm them.</td>
    <td width="33%" align="center"><img src="docs/assets/receipt-evidence.svg" alt="A receipt stays attached as evidence" width="240" /><br /><strong>Keep the source</strong><br />A receipt stays attached to its draft and transaction as evidence.</td>
    <td width="33%" align="center"><img src="docs/assets/financial-overview.svg" alt="A simple monthly spending overview" width="240" /><br /><strong>Understand the month</strong><br />Spending, income, categories, and history at a glance.</td>
  </tr>
</table>

### Core capabilities

- Record income and expenses through chat or a single receipt image.
- Ask owner-scoped questions about totals over supported date ranges.
- Preview and confirm creates, edits, deletes, and undo operations.
- Browse evidence, reports, saved conversations, and filtered CSV exports.
- Install it as a standalone PWA on iOS, or use it in any browser.
- Run locally with Docker Compose or use the deployed AWS application.

## Run locally

### Requirements

- Docker Engine with Docker Compose
- A Gemini API key for AI chat and receipt extraction (optional for the rest of the app)

### Start the stack

```sh
cp .env.example .env
# Set AUTH_HMAC_KEY to a random secret of at least 32 bytes.
# Set GEMINI_API_KEY to enable AI features.
docker compose -f compose.local.yml up -d --build
docker compose -f compose.local.yml exec backend wmbg-bootstrap owner
```

Open [http://localhost:3100](http://localhost:3100). On later starts, omit the bootstrap command if an owner already exists. Stop the services with `docker compose -f compose.local.yml down`; this preserves local database and evidence volumes. Avoid `-v` unless you intend to delete that data.

For host-based development, Python and frontend commands are documented in [AGENTS.md](AGENTS.md). The current AWS architecture, provisioning and release process are in [AWS_DEPLOYMENT_PLAN.md](AWS_DEPLOYMENT_PLAN.md) and the [AWS operations runbook](deploy/aws/README.md).

## Architecture

```text
Next.js web app ── same-origin API proxy ── Flask API ── PostgreSQL
                                              ├── Gemini (structured extraction and chat)
                                              └── private evidence storage
```

- **Frontend:** Next.js, React, TypeScript.
- **Backend:** Python, Flask, SQLAlchemy, Alembic, PostgreSQL.
- **AI:** Gemini structured function calls; server-side validation controls all proposed actions.
- **Local evidence:** private filesystem volume. **Production evidence:** private AWS S3 bucket.
- **Production:** AWS EC2 and CloudFront with managed RDS PostgreSQL and Terraform-managed infrastructure.

More on the product and its safety rules: [SRD](SRD.md). Contributor conventions: [AGENTS.md](AGENTS.md).

## Safety model

- No public registration; the owner account is bootstrapped by an operator.
- Model output is untrusted and cannot execute SQL or confirm a ledger change.
- Mutating requests require authentication, CSRF protection, idempotency keys, and version checks.
- Receipt and chat content are private evidence; never commit real financial records or credentials.

## Checks

```sh
./.venv/bin/pytest backend/tests -q
./.venv/bin/ruff check backend
./.venv/bin/mypy --config-file backend/pyproject.toml backend/src/where_my_buck_go
cd frontend && npm ci && npm run lint && npm run build
```

PostgreSQL integration tests require a disposable `TEST_DATABASE_URL`. Browser tests use `npm run test:e2e` from `frontend/` and Playwright Chromium.

## Demo video

The demos are authored as code with [HyperFrames](https://github.com/heygen-com/hyperframes) and use synthetic data only; interface elements are rebuilt from the frontend source, not recorded from a real account.

| Project | Length | Output |
| --- | --- | --- |
| [`demo-video-15s/`](demo-video-15s/) | 15 s | [`output/demo-15s.mp4`](demo-video-15s/output/demo-15s.mp4) |
| [`demo-video/`](demo-video/) | 32 s | [`output/main.mp4`](demo-video/output/main.mp4) |

To edit or re-render, install Node.js 22+ and FFmpeg, then run:

```sh
cd demo-video-15s
npm run dev                             # live preview in the browser
npm run check                           # lint, layout, motion, and contrast checks
npx hyperframes render -o output/demo-15s.mp4
```

## License

This project is licensed under the [MIT License](LICENSE).
