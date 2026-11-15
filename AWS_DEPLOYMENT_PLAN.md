# AWS Deployment Plan

Status: implementation in progress, 2026-11-15. AWS CLI preflight passed, Terraform state storage is bootstrapped, and infrastructure validation passed. A provisional plan showed 54 resources to create and no updates or deletions; its temporary alert address was invalidated. Recreate the saved plan with the owner's real alert email before review and apply. No application infrastructure has been applied. Local Docker development remains supported.

## Decisions

| Component | Selected deployment | Automation and acceptance |
| --- | --- | --- |
| Region | Sydney (`ap-southeast-2`), matching the account project's selected region | Explicit provider and CLI regions; verify account eligibility before creating resources. |
| Frontend and backend | One Ubuntu EC2 `t3.small` instance, initially 2 GB RAM, with separate Next.js and Flask containers | Build images locally from the exact CI-approved `main` commit, deploy immutable image digests, and measure memory before increasing the instance size. |
| Database | Amazon RDS PostgreSQL 17, Single-AZ, initially `db.t4g.micro` and 20 GB gp3 | Terraform provisions RDS outside Docker, encrypted storage, deletion protection, final snapshots, and seven-day automated backup retention. Check engine/class availability in the target region. |
| Database network | Private RDS endpoint in a dedicated VPC with two isolated database subnets | Terraform manages dedicated subnet groups, routes, and security groups. Allow PostgreSQL only from the app host; verify TLS certificates. |
| Evidence | Private Amazon S3 bucket in Singapore | Replace the production R2 requirement with an AWS S3 provider, block public access, enable encryption/versioning, and retain owner-scoped access through the backend. |
| Public address | CloudFront distribution with a default `*.cloudfront.net` address | Terraform manages the distribution and EC2 VPC origin. AWS manages viewer HTTPS and certificate renewal. No purchased domain or Route 53 hosted zone. |
| Container registry | Private Amazon ECR repositories | Local AWS CLI session builds and pushes images; the EC2 instance role obtains short-lived registry tokens. Retain tagged releases; expire only untagged images. |
| Secrets | AWS Systems Manager Parameter Store SecureString; RDS-managed administrator secret where supported | Write values through protected CLI input, never commit them or expose them in CI output. Keep application and migration database permissions separate. |
| Operations | AWS Budgets, bounded CloudWatch logs/metrics, RDS backups, and an encrypted S3 recovery archive | Provision through Terraform/CLI. Configure retention, usage alerts, and a restore rehearsal. Budget alerts are notifications, not a hard spending cap. |

Gemini remains the existing external AI provider. “AWS deployment” covers hosting and storage; switching the AI model to Amazon Bedrock is outside this iteration.

## Ordered Implementation

| Phase | Work performed by the agent from the terminal | Completion evidence |
| --- | --- | --- |
| 0. Repair the release baseline | Fix CI's unused `type: ignore` errors in `r2_evidence.py`; reconcile local and CI typing dependencies. PR #12 has already merged; main run `43668928237` currently fails its backend job. | Backend, frontend, and Docker CI all pass on the exact release commit. |
| 1. Inspect access and cost | Inspect existing AWS/GitHub authentication with `aws sts get-caller-identity` and `gh auth status`. Check service availability, IAM permissions, credit balance/expiry, VPC quotas and existing resources. Obtain regional prices through AWS pricing APIs. | Account/region inventory, a monthly estimate, and an explicit Terraform resource-change plan. No inferred access from a browser login. |
| 2. Adapt the app | Add AWS S3 configuration with explicit region and the SDK credential chain; keep the local evidence provider. Add an AWS Compose profile with frontend, backend, proxy, and a one-shot migration job, using external RDS. Update backups for external PostgreSQL and S3. | S3 contract tests, RDS TLS configuration checks, migration checks, and local regression checks pass. AWS Compose contains no database service or database volume. |
| 3. Define infrastructure | Add `infra/aws/` with pinned Terraform/provider versions, locking, least-privilege IAM, EC2, VPC origin, RDS, S3, ECR, distribution, secrets metadata, budgets, and monitoring. Bootstrap encrypted/versioned S3 state through an idempotent AWS CLI script. | `terraform fmt -check`, validation, and a reviewed saved plan; state access is restricted, and DB/evidence deletion is protected. |
| 4. Configure GitHub | Use `gh api` to configure repository rules and branch restrictions. GitHub is used for code review and CI only; no AWS credentials or deploy environment are configured there. | Main requires pull requests and successful checks. AWS build/deploy credentials remain in the local short-lived AWS CLI session. |
| 5. Provision and initialize | Apply the reviewed infrastructure plan from the terminal after deployment authorization. Use scripts to configure Docker, create/attach the AWS URL, install configuration, initialize RDS roles, migrate schema, and bootstrap the owner through protected input. | RDS is private; app containers are healthy; the AWS URL serves login over HTTPS. Start with an empty production database; importing local financial data is a separate explicit action. |
| 6. Release and verify | From terminal, run the release command against the exact CI-approved `main` commit and exercise login, chat, one-image draft, confirmation, evidence, reports, CSV, and logout with isolated synthetic data. | End-to-end checks run through the actual AWS URL, with no cached private responses, lost cookies, duplicate transactions, or unexpected timeout failures. |
| 7. Recovery and handover | Rehearse rollback to previous image digests and restore into a separate temporary RDS target; verify referenced S3 object checksums. Remove only the temporary resources. | Record restore duration, recovery commands, released SHA/digests, AWS URL, costs, and backup evidence in the runbook. |

## Terminal Automation Contract

- Terraform owns declared infrastructure. AWS CLI handles account inspection, state bootstrap, secret injection, and unsupported provider features. CLI fallbacks must discover existing resources, wait for completion, record identifiers, and safely resume; they must not silently create duplicates or unmanaged drift.
- GitHub CLI handles repository configuration, pull requests, and CI status checks. AWS deployment credentials are never stored in GitHub.
- Run `python3 scripts/aws/manage.py ACTION --profile wmbg` for `preflight`, `init-state`, `plan`, `apply`, `configure-github`, `seed-secrets`, `deploy`, `verify`, `rollback`, and `backup`. Use `plan --email ADDRESS` for alert delivery and `deploy --initialize` for initial database roles, then `deploy` for schema migration, containers, and owner setup.
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
- Schedule daily consistent database/evidence archives, retain seven daily archives initially, and use seven-day RDS point-in-time recovery. Preserve S3 versions needed by retained backups. Target database recovery-point loss of at most 15 minutes when RDS recovery is available; the daily archive fallback has a maximum target data-loss window of 24 hours. Aim for recovery within two hours and verify that target in rehearsal.
- Before a schema change, take a recoverable backup. Automatic app rollback is allowed only when the previous app is compatible with the new schema. Destructive migrations, database replacement, or resource destruction need an explicit review; a failed deployment must never erase ledger data.

## Cost and Owner Involvement

Use a provisional envelope of **USD 45–55/month**, before tax and external Gemini usage, for low traffic. It includes EC2, public IPv4 for outbound access, EBS, RDS compute/storage, CloudFront, S3, ECR, secrets, and monitoring. AWS Pricing API currently reports Sydney Linux EC2 `t3.small` at USD 0.0264/hour (~USD 19.27/month) and RDS PostgreSQL `db.t4g.micro` Single-AZ at USD 0.025/hour (~USD 18.25/month). The remaining envelope covers EBS/RDS storage, public IPv4, CloudFront, S3, ECR, secrets, logs, and backups; refresh those quantities and prices before applying Terraform. No NAT gateway, load balancer, Multi-AZ standby, or paid domain is included.

AWS CLI verifies an ACTIVE Free Plan with **USD 200 credit** expiring 2027-05-15. AWS-managed project policy denies IAM OIDC provider discovery and account contact lookup; project-level permissions cannot override this policy. Deployment therefore uses the local AWS CLI session and does not require GitHub OIDC. At the provisional USD 45–55 monthly envelope, the credit covers about 3.6–4.4 months; remaining storage, network, and log prices still need to be verified before Terraform apply. Never silently upgrade the account. Monthly budget alerts target USD 50 and do not cap spending.

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

- Verify account eligibility, regional pricing, and review the saved Terraform plan before apply.
- Provision infrastructure, build exact-commit images, initialize RDS, and validate the public URL.
- Complete authenticated product acceptance and verify backup/rollback on the actual deployment.
- Automate isolated restore-target provisioning and cleanup; the restore runtime currently requires a separately prepared target database and bucket.
- Keep all AWS credentials local; GitHub Actions performs CI and never deploys to AWS.
