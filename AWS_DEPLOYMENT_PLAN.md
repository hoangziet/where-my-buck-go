# AWS Deployment Plan

Status: finalized implementation plan, 2026-11-15. Infrastructure and deployment automation described here are not implemented or provisioned yet. This is the production target for the next coding iteration; local Docker development remains supported.

## Decisions

| Component | Selected deployment | Automation and acceptance |
| --- | --- | --- |
| Region | Singapore (`ap-southeast-1`); Lightsail distribution/web-address APIs use `us-east-1` | Terraform provider aliases and explicit CLI regions; verify account eligibility before creating resources. |
| Frontend and backend | One Linux Lightsail instance, initially 2 GB RAM, with separate Next.js and Flask containers | Build images in GitHub Actions, deploy immutable image digests, and measure memory before increasing the instance size. |
| Database | Amazon RDS PostgreSQL 17, Single-AZ, initially `db.t4g.micro` and 20 GB gp3 | Terraform provisions RDS outside Docker, encrypted storage, deletion protection, final snapshots, and seven-day automated backup retention. Check engine/class availability in the target region. |
| Database network | Private RDS endpoint in the region's default VPC, connected to Lightsail through VPC peering | Terraform manages app-specific subnet groups, routes, and security groups without replacing unrelated default-VPC resources. Allow PostgreSQL only from the app host; verify TLS certificates. |
| Evidence | Private Amazon S3 bucket in Singapore | Replace the production R2 requirement with an AWS S3 provider, block public access, enable encryption/versioning, and retain owner-scoped access through the backend. |
| Public address | Lightsail distribution plus an AWS-managed `*.amazonlightsail.com` web address | Terraform manages the distribution; use AWS CLI for web-address operations if the pinned Terraform provider lacks support. AWS manages viewer HTTPS and certificate renewal. No purchased domain or Route 53 hosted zone. |
| Container registry | Private Amazon ECR repositories | GitHub builds and pushes images; deployment transfers a short-lived pull token to the host. Retain current and previous release digests and expire obsolete images. |
| Secrets | AWS Systems Manager Parameter Store SecureString; RDS-managed administrator secret where supported | Write values through protected CLI input, never commit them or expose them in CI output. Keep application and migration database permissions separate. |
| Operations | AWS Budgets, bounded CloudWatch logs/metrics, RDS backups, and an encrypted S3 recovery archive | Provision through Terraform/CLI. Configure retention, usage alerts, and a restore rehearsal. Budget alerts are notifications, not a hard spending cap. |

Gemini remains the existing external AI provider. “AWS deployment” covers hosting and storage; switching the AI model to Amazon Bedrock is outside this iteration.

## Ordered Implementation

| Phase | Work performed by the agent from the terminal | Completion evidence |
| --- | --- | --- |
| 0. Repair the release baseline | Fix CI's unused `type: ignore` errors in `r2_evidence.py`; reconcile local and CI typing dependencies. PR #12 has already merged; main run `43668928237` currently fails its backend job. | Backend, frontend, and Docker CI all pass on the exact release commit. |
| 1. Inspect access and cost | Inspect existing AWS/GitHub authentication with `aws sts get-caller-identity` and `gh auth status`. Check service availability, IAM permissions, credit balance/expiry, default VPC, and existing resources. Obtain regional prices through AWS pricing APIs. | Account/region inventory, a monthly estimate, and an explicit Terraform resource-change plan. No inferred access from a browser login. |
| 2. Adapt the app | Add AWS S3 configuration with explicit region and the SDK credential chain; keep the local evidence provider. Add an AWS Compose profile with frontend, backend, proxy, and a one-shot migration job, using external RDS. Update backups for external PostgreSQL and S3. | S3 contract tests, RDS TLS configuration checks, migration checks, and local regression checks pass. AWS Compose contains no database service or database volume. |
| 3. Define infrastructure | Add `infra/aws/` with pinned Terraform/provider versions, locking, least-privilege IAM, Lightsail, peering, RDS, S3, ECR, distribution, secrets metadata, budgets, and monitoring. Bootstrap encrypted/versioned S3 state through an idempotent AWS CLI script. | `terraform fmt -check`, validation, and a reviewed saved plan; state access is restricted, and DB/evidence deletion is protected. |
| 4. Configure GitHub | Use `gh api` to configure repository rules, the deployment environment, and branch restrictions; use `gh variable set`/`gh secret set` for configuration. Terraform creates GitHub OIDC trust and separate build/deploy roles. | Main requires pull requests and successful checks. Only authorized main/environment workflows can assume deployment roles; PR code cannot deploy. Report repository-plan/API limitations rather than claiming unsupported protections exist. |
| 5. Provision and initialize | Apply the reviewed infrastructure plan from the terminal after deployment authorization. Use scripts to configure Docker, create/attach the AWS URL, install configuration, initialize RDS roles, migrate schema, and bootstrap the owner through protected input. | RDS is private; app containers are healthy; the AWS URL serves login over HTTPS. Start with an empty production database; importing local financial data is a separate explicit action. |
| 6. Release and verify | Trigger the workflow with `gh workflow run`, observe it through `gh run`, and exercise login, chat, one-image draft, confirmation, evidence, reports, CSV, and logout with isolated synthetic data. | End-to-end checks run through the actual AWS URL, with no cached private responses, lost cookies, duplicate transactions, or unexpected timeout failures. |
| 7. Recovery and handover | Rehearse rollback to previous image digests and restore into a separate temporary RDS target; verify referenced S3 object checksums. Remove only the temporary resources. | Record restore duration, recovery commands, released SHA/digests, AWS URL, costs, and backup evidence in the runbook. |

## Terminal Automation Contract

- Terraform owns declared infrastructure. AWS CLI handles account inspection, state bootstrap, secret injection, and unsupported provider features. CLI fallbacks must discover existing resources, wait for completion, record identifiers, and safely resume; they must not silently create duplicates or unmanaged drift.
- GitHub CLI handles repository configuration, variables, secrets, pull requests, workflow dispatch, status checks, and logs. The owner should not have to create resources or copy endpoint values between consoles.
- Introduce `scripts/aws/` entry points for `preflight`, `bootstrap`, `plan`, `apply`, `configure-github`, `deploy`, `verify`, `rollback`, and `backup`. These are planned commands, not existing scripts. Each reports a concise result and redacts secrets.
- GitHub Actions authenticates to AWS using OIDC, without persistent AWS access keys in GitHub. Trust is restricted to this repository and the intended ref/environment. Infrastructure permissions are separate from release permissions.
- Lightsail instances do not provide EC2 instance profiles. Runtime S3 access therefore needs a narrowly scoped service identity, with its key created outside Terraform state, stored in SecureString, installed in a root-readable environment file, and rotated by the automation. Do not claim that GitHub OIDC supplies continuous runtime credentials to the host.
- Deploy through temporary SSH credentials obtained with `aws lightsail get-instance-access-details`. Temporarily allow only the runner's IP, verify the SSH host key against the API response, and remove the firewall rule and credentials even on failure. Avoid a permanent SSH key in GitHub or an unrestricted SSH port.
- Build on GitHub runners, not the small production host. Serialize deployments, pin action revisions, associate checks with the exact commit, run migrations once, and deploy only images that passed checks. The initial release is dispatched from the terminal; subsequent releases can run automatically after an authorized merge and successful CI.
- Work on `codex/` branches and open PRs through `gh`. Never push directly to `main`. PR #12 is merged, so the AWS implementation requires a new PR.

## Request Routing and Release Gates

- Use one public origin for the UI and `/api/*`. Forward cookies, query strings, CSRF and idempotency headers, and required Next.js headers. Permit the application's HTTP methods. Disable CDN caching for authenticated pages, API responses, evidence, and errors; initially disable all dynamic caching and cache only fingerprinted static assets.
- The free web address terminates TLS at the distribution. It does not install a certificate on the Lightsail instance. Configure and verify the edge-to-origin transport explicitly: an HTTP origin is not end-to-end TLS, and a self-signed HTTPS origin is rejected by Lightsail distributions. Resolving a supported encrypted origin path is a mandatory implementation gate before live financial data is enabled; if this needs a different compute/ingress service, revise the resource plan and cost estimate before provisioning it.
- Derive trusted host, protocol, and client IP only at controlled proxies. Restrict direct origin access and validate secure `__Host-` cookies, CSRF, and login rate limiting through the distribution.
- Align the Gemini request/retry budget, Gunicorn timeout, proxy timeout, and distribution response timeout. Test a slow upstream response and retry behavior through the public URL; a local health check is not release acceptance.
- RDS needs no public access or NAT gateway for the connection from Lightsail over peering. Keep AWS database traffic private and use a verified RDS CA bundle. Use a small bounded database connection pool.
- Schedule daily consistent database/evidence archives, retain seven daily archives initially, and use seven-day RDS point-in-time recovery. Preserve S3 versions needed by retained backups. Target database recovery-point loss of at most 15 minutes when RDS recovery is available; the daily archive fallback has a maximum target data-loss window of 24 hours. Aim for recovery within two hours and verify that target in rehearsal.
- Before a schema change, take a recoverable backup. Automatic app rollback is allowed only when the previous app is compatible with the new schema. Destructive migrations, database replacement, or resource destruction need an explicit review; a failed deployment must never erase ledger data.

## Cost and Owner Involvement

Use a planning envelope of **USD 35–45/month**, before tax and external Gemini usage, for low traffic: USD 12 for the initial Lightsail instance, USD 2.50 for the smallest distribution, plus RDS compute/storage, S3, ECR, secrets, backups, and monitoring. This is an estimate, not a quote; refresh prices and include any origin-transport changes before apply. No NAT gateway, load balancer, Multi-AZ standby, or paid domain is included in this baseline.

The screenshot shows USD 100 credit and 182 days remaining. At the planning envelope, that credit represents roughly 2–3 months of usage, not six months of guaranteed service. Check credit coverage and Free Plan service eligibility through the account; never silently upgrade the account or enable a paid replacement service. Set monthly cost alerts and remaining-credit/expiry reporting before deployment. Do not destroy data automatically to enforce a budget.

The owner performs only interactive identity steps that cannot be delegated: approve AWS/GitHub login or MFA if no usable session exists, supply the Gemini credential and owner login through a protected prompt, and confirm an alert subscription if required. The agent prepares and shows the exact resource/cost plan before the initial deployment decision. No routine console setup or per-release manual deployment is intended.

## References

- [Lightsail pricing](https://aws.amazon.com/lightsail/pricing/)
- [RDS PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/)
- [AWS Free Plan](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html)
- [Create and attach a Lightsail web address using AWS CLI](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-create-attach-web-address.html)
- [Lightsail distribution request/response behavior](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-distribution-request-and-response.html)
- [Connect Lightsail to RDS using VPC peering](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-how-to-set-up-vpc-peering-with-aws-resources.html)
- [Temporary Lightsail SSH credentials](https://docs.aws.amazon.com/cli/latest/reference/lightsail/get-instance-access-details.html)
- [GitHub OIDC with AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
