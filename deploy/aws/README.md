# AWS Operations Runbook

## Current status

Infrastructure and deployment code are available. No production URL, successful restore rehearsal,
or live deployment is recorded yet. See `AWS_DEPLOYMENT_PLAN.md` for architecture, cost assumptions,
and acceptance gates. Commands below run from the repository root.

## Authenticate and provision

The operator completes AWS login/MFA; no access keys belong in GitHub or the repository.

```sh
aws login --profile wmbg --region ap-southeast-1
python3 scripts/aws/manage.py preflight --profile wmbg
```

Terraform must also resolve this identity. If the installed AWS provider cannot read CLI login sessions,
configure a credential-process profile and use it for the remaining commands:

```sh
aws configure set credential_process 'aws configure export-credentials --profile wmbg --format process' --profile wmbg-infra
aws configure set region ap-southeast-1 --profile wmbg-infra
python3 scripts/aws/manage.py preflight --profile wmbg-infra
python3 scripts/aws/manage.py init-state --profile wmbg-infra
python3 scripts/aws/manage.py plan --profile wmbg-infra --email YOUR_ALERT_EMAIL
```

Inspect the saved Terraform plan, regional prices, account eligibility, and existing resources before
`apply`. The plan is bound to the account and checked by hash. Never commit `.aws-runtime/`, state,
plan files, or generated variable files. Do not upgrade the AWS account automatically.

```sh
python3 scripts/aws/manage.py apply --profile wmbg-infra
python3 scripts/aws/manage.py configure-github --profile wmbg-infra
python3 scripts/aws/manage.py seed-secrets --profile wmbg-infra
```

Secret setup reads the local Gemini key or prompts without echo. Initial owner credentials are stored
in `.aws-runtime/initial-owner.json` with mode 0600. Complete the SNS email confirmation if requested.
Do not import local financial records as part of initialization.

## Initial release

Merge the reviewed PR through GitHub after required checks succeed. The workflow must exist on `main`.
Dispatch `aws-deploy.yml` using `gh workflow run aws-deploy.yml --ref main`; inspect its run with
`gh run view`. With `AWS_READY` unset, this builds images but does not deploy them.

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
digests. After acceptance, enable subsequent releases:

```sh
gh variable set AWS_READY --body true --repo hoangziet/where-my-buck-go
```

## Recovery and failures

```sh
python3 scripts/aws/manage.py backup --profile wmbg-infra
python3 scripts/aws/manage.py rollback --schema-compatible --profile wmbg-infra
```

Review migration compatibility before rollback; it changes application images, never the schema.
Backups pause application writers and include the database plus referenced evidence and checksums.
The host timer performs daily backups; failures publish a CloudWatch metric. RDS also retains seven
days of automated backups. Alert delivery and recovery objectives require live verification.

Archive restore requires a separate empty RDS database, a separate evidence bucket, a protected
`/wmbg/restore` parameter, and narrowly scoped temporary host permissions. Automated target creation
and cleanup remain outstanding. Never direct restore at production. Run `manage.py restore` with
`--target-host` and `--backup-key` only after those prerequisites exist; verify restored data and
checksums before removing the isolated targets.

When a command reports an SSM command ID, continue observing it with
`manage.py resume-command --command-id ID --profile wmbg-infra` before considering a new execution.
The protected receipt in `.aws-runtime/commands/` binds observation to its original account and region. An
observation timeout does not establish remote failure. Initialization keeps temporary IAM access while remote status is unknown; resumed observation removes
that policy once a terminal result is confirmed. If submission itself fails before returning a command
ID, inspect SSM and the temporary IAM policy explicitly before retrying. Keep `AWS_READY` unset/false
until the initial release gates pass; disabling it stops future automated deployments, not the app.
