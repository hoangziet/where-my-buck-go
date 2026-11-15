# AWS Operations Runbook

## Current status

Production is deployed at https://d1498jatb9ljtb.cloudfront.net from CI-approved `main` commit
`0221f2d4e8298fd3f3c0ce777202e3e63fa0447e`. Health, API login/logout, read-only reports/transactions,
daily archive checksums, and a separate-database restore rehearsal have been verified. Direct API chat
and image intake also passed, but the frontend currently looks for `wmbg_csrf` while production sets
`__Host-wmbg_csrf`; UI mutations therefore fail with HTTP 403. PR #16 fixes the cookie lookup and must
be released before browser write-flow acceptance. The AWS Free Plan currently prevents creating a
second RDS instance, so the restore rehearsal used a temporary database on the existing RDS instance
and then removed it. See `AWS_DEPLOYMENT_PLAN.md` for remaining acceptance gates. Commands below run
from the repository root.

## Authenticate and provision

The operator completes AWS login/MFA; no access keys belong in GitHub or the repository.

```sh
aws login --profile wmbg --region ap-southeast-2
python3 scripts/aws/manage.py preflight --profile wmbg
```

Terraform must also resolve this identity. If the installed AWS provider cannot read CLI login sessions,
configure a credential-process profile and use it for the remaining commands:

```sh
aws configure set credential_process 'aws configure export-credentials --profile wmbg --format process' --profile wmbg-infra
aws configure set region ap-southeast-2 --profile wmbg-infra
python3 scripts/aws/manage.py preflight --profile wmbg-infra
```

AWS Free Plan project policy denies IAM OIDC provider discovery, so AWS deployment runs from this local short-lived CLI session. GitHub Actions runs CI only and receives no AWS credentials. Budget alerts publish to the operations SNS topic; pass `--email ADDRESS` to add an email subscription now, or add one later by re-running the plan after supplying the address.

Inspect the saved Terraform plan, regional prices, account eligibility, and existing resources before
`apply`. The plan is bound to the account and checked by hash. Never commit `.aws-runtime/`, state,
plan files, or generated variable files. Do not upgrade the AWS account automatically.

```sh
python3 scripts/aws/manage.py init-state --profile wmbg-infra
python3 scripts/aws/manage.py plan --profile wmbg-infra
```

Review the Terraform plan and cost assumptions before applying. After approval:

```sh
python3 scripts/aws/manage.py apply --profile wmbg-infra
python3 scripts/aws/manage.py configure-github --profile wmbg-infra
python3 scripts/aws/manage.py seed-secrets --profile wmbg-infra
```

The budget and CloudWatch notifications use the same SNS topic. Without an email subscription, alerts
are published to SNS but are not delivered to an inbox; add the address with `--email` before relying
on email notifications. SNS sends a confirmation message that must be accepted before email delivery.

Secret setup reads the local Gemini key or prompts without echo. Initial owner credentials are stored
in `.aws-runtime/initial-owner.json` with mode 0600. Complete the SNS email confirmation if requested.
Do not import local financial records as part of initialization.

## Initial release

Merge the reviewed PR through GitHub after required checks succeed. AWS deploy runs from the local
terminal after that merge. The command verifies that the exact clean commit is on `main` and its
required CI checks passed, then builds and pushes immutable images from this machine.

Check out the exact, clean main commit whose images passed the build. Then run:

```sh
python3 scripts/aws/manage.py deploy --initialize --profile wmbg-infra
python3 scripts/aws/manage.py deploy --profile wmbg-infra
python3 scripts/aws/manage.py verify --profile wmbg-infra
```

Initialization creates database roles; deployment separately migrates the schema, starts containers,
and bootstraps the owner. Only initialization temporarily grants the host access to the RDS master
secret. The public URL is printed after deployment. Health/login checks alone are not acceptance.

Validate login/logout, secure cookies, CSRF, chat, one image plus text, draft confirmation,
idempotent submission, evidence retrieval, reports, and CSV through the AWS URL with synthetic data.
Confirm private origin isolation and slow Gemini response handling. Record the release SHA and image
digests. Repeat the same terminal release commands for future releases; GitHub Actions remains CI-only.

## Recovery and failures

```sh
python3 scripts/aws/manage.py backup --profile wmbg-infra
python3 scripts/aws/manage.py rollback --schema-compatible --profile wmbg-infra
```

Review migration compatibility before rollback; it changes application images, never the schema.
Backups pause application writers and include the database plus referenced evidence and checksums.
The host timer performs daily backups; failures publish a CloudWatch metric. RDS retains one day of
automated backups to satisfy the account Free Plan limit; encrypted S3 archives retain seven daily
copies. Backup manifest, database dump, and evidence archive hashes were verified. Alert delivery and
recovery objectives require live verification.

Archive restore requires a separate empty database, a separate evidence bucket, a protected
`/wmbg/restore` parameter, and narrowly scoped temporary host permissions. A restore rehearsal
verified a known chat and transaction count using a distinct temporary database on the same RDS
instance because the account Free Plan blocks a second instance. The test database, protected
parameter, IAM policy, and bucket were removed afterward. This does not replace a future rehearsal
against a separate RDS host. Never target the production database. `manage.py restore` rejects the
production database host; to rehearse on the same instance, use a distinct database and an explicitly
reviewed temporary copy of the runtime safety guard, then remove all temporary resources.

When a command reports an SSM command ID, continue observing it with
`manage.py resume-command --command-id ID --profile wmbg-infra` before considering a new execution.
The protected receipt in `.aws-runtime/commands/` binds observation to its original account and region. An
observation timeout does not establish remote failure. Initialization keeps temporary IAM access while remote status is unknown; resumed observation removes
that policy once a terminal result is confirmed. If submission itself fails before returning a command
ID, inspect SSM and the temporary IAM policy explicitly before retrying. Deployment remains a deliberate
local terminal action and is never triggered by a GitHub push.
