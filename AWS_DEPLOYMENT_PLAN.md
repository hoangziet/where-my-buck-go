# AWS Deployment Plan

Status: deployed with a production frontend blocker under remediation, 2026-11-15. Production runs in AWS Sydney at https://d1498jatb9ljtb.cloudfront.net from CI-approved `main` commit `0221f2d4e8298fd3f3c0ce777202e3e63fa0447e`. Terraform provisions CloudFront, EC2, private RDS PostgreSQL, S3, ECR, monitoring, and recovery storage. The frontend currently reads the local CSRF cookie name but not the secure production `__Host-wmbg_csrf` name, so UI mutations fail with HTTP 403; PR #16 fixes the cookie lookup. The account's Free Plan permits one RDS instance, so a full second-instance rehearsal was blocked; recovery was verified in a temporary, separate database on the production RDS instance and all temporary restore resources were removed. Local Docker development remains supported.

## Decisions

| Component | Selected deployment | Automation and acceptance |
| --- | --- | --- |
| Region | Sydney (`ap-southeast-2`), matching the account project's selected region | Explicit provider and CLI regions; verify account eligibility before creating resources. |
| Frontend and backend | One Ubuntu EC2 `t3.small` instance, initially 2 GB RAM, with separate Next.js and Flask containers | Build images locally from the exact CI-approved `main` commit, deploy immutable image digests, and measure memory before increasing the instance size. |
| Database | Amazon RDS PostgreSQL 17, Single-AZ, initially `db.t4g.micro` and 20 GB gp3 | Terraform provisions RDS outside Docker, encrypted storage, deletion protection, final snapshots, and one-day automated backup retention to meet the AWS Free Plan limit. Daily application archives remain in S3 for seven days. Check engine/class availability in the target region. |
| Database network | Private RDS endpoint in a dedicated VPC with two isolated database subnets | Terraform manages dedicated subnet groups, routes, and security groups. Allow PostgreSQL only from the app host; verify TLS certificates. |
| Evidence | Private Amazon S3 bucket in Singapore | Replace the production R2 requirement with an AWS S3 provider, block public access, enable encryption/versioning, and retain owner-scoped access through the backend. |
| Public address | CloudFront distribution with a default `*.cloudfront.net` address | Terraform manages the distribution and EC2 VPC origin. AWS manages viewer HTTPS and certificate renewal. No purchased domain or Route 53 hosted zone. |
| Container registry | Private Amazon ECR repositories | Local AWS CLI session builds and pushes images; the EC2 instance role obtains short-lived registry tokens. Retain tagged releases; expire only untagged images. |
| Secrets | AWS Systems Manager Parameter Store SecureString; RDS-managed administrator secret where supported | Write values through protected CLI input, never commit them or expose them in CI output. Keep application and migration database permissions separate. |
| Operations | AWS Budgets, bounded CloudWatch logs/metrics, RDS backups, and an encrypted S3 recovery archive | Provisioned through Terraform/CLI. One-day RDS backups, seven daily S3 archives, and a restore rehearsal are verified. Budget alerts are notifications, not a hard spending cap. |

Gemini remains the existing external AI provider. “AWS deployment” covers hosting and storage; switching the AI model to Amazon Bedrock is outside this iteration.

## Ordered Implementation

| Phase | Work performed by the agent from the terminal | Completion evidence |
| --- | --- | --- |
| 0. Repair the release baseline | Fix CI typing errors and reconcile local and CI typing dependencies. | Complete. Required backend, frontend, and Docker checks passed on release commit `0221f2d4e8298fd3f3c0ce777202e3e63fa0447e`. |
| 1. Inspect access and cost | Inspect AWS/GitHub authentication, service availability, IAM permissions, credit, quotas, regional prices, and existing resources. | Complete before apply. Account/region inventory and a reviewed resource plan are recorded; the monthly estimate remains provisional and actual usage must be monitored. |
| 2. Adapt the app | Add AWS S3 configuration, external RDS TLS, an AWS Compose profile, and backup support while retaining local Docker. | Complete. Backend, frontend, Docker, and related checks passed in CI; AWS Compose contains no database service or database volume. |
| 3. Define infrastructure | Add pinned Terraform/provider versions, restricted state, least-privilege IAM, EC2, private RDS, S3, ECR, CloudFront VPC origin, budgets, and monitoring. | Complete. Terraform formatting, validation, reviewed plan, and protected state/data resources passed before apply. |
| 4. Configure GitHub | Configure repository rules and required CI through GitHub CLI; GitHub Actions performs CI only. | Complete. PR-based changes and required checks are enforced; AWS deploy credentials remain in the local short-lived AWS CLI session. |
| 5. Provision and initialize | Apply the reviewed infrastructure plan from the terminal. Configure containers, private RDS, CloudFront URL, migrations, and owner bootstrap. | Complete. RDS is private; health and login endpoints work over HTTPS. No local financial data was imported. |
| 6. Release and verify | Release the exact CI-approved `main` commit and exercise authenticated product flows using synthetic data. | Partial. Authenticated API login/logout and read-only report/transaction retrieval passed. A direct API chat and one-image draft/evidence request were verified; the image draft was discarded and the ledger remained empty. Browser confirmation, CSV export, and full origin/cookie acceptance remain open. A production cookie-name mismatch blocks all frontend mutations until PR #16 is reviewed, merged, and released. |
| 7. Recovery and handover | Create and verify S3 archives, then rehearse restoring PostgreSQL and evidence in isolation. | Backup object hashes and restore passed. AWS Free Plan blocked a second RDS instance; restore was tested in a distinct temporary database on the existing RDS instance using the exact backup runtime with a guard limited to that separate database. The database, temporary SSM secret, IAM policy, and bucket were removed. This verifies archive restoration but does not exercise recovery to a separate RDS host. Rollback rehearsal remains open. |

## Terminal Automation Contract

- Terraform owns declared infrastructure. AWS CLI handles account inspection, state bootstrap, secret injection, and unsupported provider features. CLI fallbacks must discover existing resources, wait for completion, record identifiers, and safely resume; they must not silently create duplicates or unmanaged drift.
- GitHub CLI handles repository configuration, pull requests, and CI status checks. AWS deployment credentials are never stored in GitHub.
- Run `python3 scripts/aws/manage.py ACTION --profile wmbg-infra` for `preflight`, `init-state`, `plan`, `apply`, `configure-github`, `seed-secrets`, `deploy`, `verify`, `rollback`, and `backup`. Add `plan --email ADDRESS` to create an SNS email subscription, or add it later with a new plan. Use `deploy --initialize` for initial database roles, then `deploy` for schema migration, containers, and owner setup.
- Authenticate interactively with `aws login --profile wmbg --region ap-southeast-2`; the `wmbg-infra` credential-process profile delegates to this short-lived session. The release command checks that the exact commit is on `main` with successful required CI before building and pushing images locally.
- Runtime access uses an EC2 instance profile and IMDSv2. No persistent AWS access keys are installed. Database migration credentials remain separate from application credentials.
- Deploy through Systems Manager Run Command with a checksum-verified S3 release bundle. The origin has no public inbound or SSH rule; CloudFront reaches port 8080 through its service security group.
- Build on the operator's local Docker host, not the small production host or GitHub runners. Associate CI checks with the exact commit, run migrations once, and deploy only images built from a CI-approved `main` commit.
- Work on `codex/` branches and open PRs through `gh`. Never push directly to `main`. PR #12 is merged, so the AWS implementation requires a new PR.

## Request Routing and Release Gates

- Use one public origin for the UI and `/api/*`. Forward cookies, query strings, CSRF and idempotency headers, and required Next.js headers. Permit the application's HTTP methods. Disable CDN caching for authenticated pages, API responses, evidence, and errors; initially disable all dynamic caching and cache only fingerprinted static assets.
- Viewer HTTPS terminates at CloudFront. The VPC origin uses HTTP over the private CloudFront-to-VPC connection; this is not end-to-end TLS. Validate origin isolation before admitting live financial data.
- Derive trusted host, protocol, and client IP only at controlled proxies. Restrict direct origin access and validate secure `__Host-` cookies, CSRF, and login rate limiting through the distribution.
- Align the Gemini request/retry budget, Gunicorn timeout, proxy timeout, and distribution response timeout. Test a slow upstream response and retry behavior through the public URL; a local health check is not release acceptance.
- RDS needs no public access or NAT gateway for the connection from EC2 in the same VPC. Keep AWS database traffic private and use a verified RDS CA bundle. Use a small bounded database connection pool.
- Schedule daily consistent database/evidence archives, retain seven daily archives initially, and use one-day RDS point-in-time recovery to satisfy the AWS Free Plan limit. Preserve S3 versions needed by retained backups. Target database recovery-point loss of at most 15 minutes when RDS recovery is available; the daily archive fallback has a maximum target data-loss window of 24 hours. Aim for recovery within two hours and verify that target in rehearsal.
- Before a schema change, take a recoverable backup. Automatic app rollback is allowed only when the previous app is compatible with the new schema. Destructive migrations, database replacement, or resource destruction need an explicit review; a failed deployment must never erase ledger data.

## Cost and Owner Involvement

Use a provisional envelope of **USD 45–55/month for this app**, before tax and external Gemini usage, for low traffic. It includes EC2, public IPv4 for outbound access, EBS, RDS compute/storage, CloudFront, S3, ECR, secrets, and monitoring. AWS Pricing API currently reports Sydney Linux EC2 `t3.small` at USD 0.0264/hour (~USD 19.27/month) and RDS PostgreSQL `db.t4g.micro` Single-AZ at USD 0.025/hour (~USD 18.25/month). The remaining envelope covers EBS/RDS storage, public IPv4, CloudFront, S3, ECR, secrets, logs, and backups; refresh those quantities and prices before applying Terraform. No NAT gateway, load balancer, Multi-AZ standby, or paid domain is included.

Read-only inventory found an existing untagged Aurora PostgreSQL 17.9 Serverless v2 cluster named `database-1`, configured to auto-pause after five minutes; its ownership and purpose are unverified. Its storage encryption and deletion protection are disabled, with one-day backup retention. Leave it untouched and do not use it for application data; the app plan creates its own encrypted RDS PostgreSQL database with deletion protection, one-day automated backups, and seven-day S3 archives. The USD 45–55 estimate excludes any charges from the existing Aurora cluster, so actual account costs may be higher until its owner confirms its purpose or removes it separately.

AWS CLI verifies an ACTIVE Free Plan with **USD 200 credit** expiring 2027-05-15. AWS-managed project policy denies IAM OIDC provider discovery and account contact lookup; project-level permissions cannot override this policy. Deployment therefore uses the local AWS CLI session and does not require GitHub OIDC. At the provisional USD 45–55 monthly envelope, the credit covers about 3.6–4.4 months. Refresh prices and actual usage through AWS billing before relying on that estimate. Never silently upgrade the account. Monthly budget alerts target USD 50 and do not cap spending.

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

## Remaining Release Gates

- Verify current regional prices and monitor actual AWS charges against the $50 monthly budget notification.
- Review, merge, and release PR #16, then exercise browser confirmation/discard, CSV export, secure cookies/CSRF, and slow Gemini handling through the public URL with synthetic data.
- Rehearse image rollback after reviewing migration compatibility.
- Rehearse restore to a separate RDS host when the account plan permits another RDS instance; current Free Plan quota allows only one.
- Configure an SNS email subscription if inbox delivery of budget and alarm notifications is required.
- Keep all AWS credentials local; GitHub Actions performs CI and never deploys to AWS.
