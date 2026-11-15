#!/usr/bin/env python3
"""Terminal-only AWS provisioning and GitHub deployment administration."""

import argparse
import getpass
import hashlib
import json
import os
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INFRA = ROOT/'infra/aws'
PRIVATE = ROOT/'.aws-runtime'
REPOSITORY = 'hoangziet/where-my-buck-go'
AWS = shutil.which('aws') or str(Path.home()/'.local/bin/aws')


def command(args, *, payload=None, check=True, capture=True, env=None):
    result = subprocess.run(args, input=payload, text=True, check=False,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None, env=env)
    if check and result.returncode:
        # Keep AWS denial errors actionable without surfacing request bodies or credentials.
        detail = result.stderr or ''
        if 'explicit deny in a service control policy' in detail.lower():
            denied = re.search(r'not authorized to perform: ([^ ]+)', detail)
            action = denied.group(1) if denied else 'the requested AWS action'
            raise RuntimeError(
                f'An AWS-managed project policy explicitly denies {action}. This permission '
                'cannot be changed from the project account; keep deployment in the local AWS CLI session.'
            )
        raise RuntimeError(f'{Path(args[0]).name} {args[1]} failed (exit {result.returncode})')
    return result


def aws(*args, data=None, check=True):
    argv = [AWS, '--no-cli-pager', *args]
    if data is not None:
        with tempfile.NamedTemporaryFile('w', dir=PRIVATE, suffix='.json') as file:
            json.dump(data, file); file.flush()
            result = command([*argv, '--cli-input-json', 'file://'+file.name], check=check)
    else:
        result = command(argv, check=check)
    if result.returncode:
        return None
    return json.loads(result.stdout) if result.stdout.strip() else {}


def gh(path, method='GET', data=None):
    argv = ['gh', 'api', path, '--method', method]
    if data is not None:
        argv += ['--input', '-']
    result = command(argv, payload=json.dumps(data) if data is not None else None)
    return json.loads(result.stdout) if result.stdout.strip() else {}


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2)+'\n')
    path.chmod(0o600)


def outputs():
    return json.loads(command(['terraform', f'-chdir={INFRA}', 'output', '-json', 'deployment']).stdout)


def put_parameter(name, value, overwrite=False):
    return aws('ssm', 'put-parameter', data={'Name': name, 'Value': json.dumps(value),
               'Type': 'SecureString', 'Overwrite': overwrite})


def get_parameter(name):
    result = aws('ssm', 'get-parameter', '--name', name, '--with-decryption', check=False)
    return json.loads(result['Parameter']['Value']) if result else None


def preflight(args):
    identity = aws('sts', 'get-caller-identity')
    repo = gh(f'repos/{REPOSITORY}')
    if not repo['permissions'].get('admin'):
        raise RuntimeError('GitHub repository administration permission is required')
    account = identity['Account']
    result = {'account_id': account, 'region': args.region, 'github_repository': REPOSITORY,
              'credit_usd_owner_reported': 200}
    for tool in ('terraform', 'docker', 'gh'):
        if not shutil.which(tool):
            raise RuntimeError(f'Missing required tool: {tool}')
    engine_versions = aws('rds', 'describe-db-engine-versions', '--engine', 'postgres',
                          '--engine-version', '17')
    versions = {entry['EngineVersion'] for entry in engine_versions['DBEngineVersions']}
    if not versions:
        raise RuntimeError('PostgreSQL 17 is unavailable in this region')
    options = aws('rds', 'describe-orderable-db-instance-options', '--engine', 'postgres',
                  '--db-instance-class', 'db.t4g.micro')
    gp3_versions = {entry['EngineVersion'] for entry in options['OrderableDBInstanceOptions']
                    if entry['StorageType'] == 'gp3'}
    compatible_versions = versions.intersection(gp3_versions)
    if not compatible_versions:
        raise RuntimeError('PostgreSQL 17 on db.t4g.micro with gp3 is unavailable in this region')
    database_engine_version = max(compatible_versions, key=lambda value: tuple(map(int, value.split('.'))))
    result['database_engine_version'] = database_engine_version
    compute_options = aws('ec2', 'describe-instance-type-offerings',
                          '--filters', 'Name=instance-type,Values=t3.small')
    if not compute_options['InstanceTypeOfferings']:
        raise RuntimeError('EC2 t3.small is unavailable in this region')
    # Free Plan services/region restrictions must be resolved before creating resources.
    result['account_plan'] = aws('freetier', 'get-account-plan-state', check=False)
    save(PRIVATE/'preflight.json', result)
    print(f'Access verified: AWS account {account}, region {args.region}, GitHub admin access')


def init_state(args):
    account = aws('sts', 'get-caller-identity')['Account']
    bucket = f'{args.project}-{account}-{args.region}-tfstate'
    if aws('s3api', 'head-bucket', '--bucket', bucket, check=False) is None:
        data = {'Bucket': bucket}
        if args.region != 'us-east-1':
            data['CreateBucketConfiguration'] = {'LocationConstraint': args.region}
        aws('s3api', 'create-bucket', data=data)
    aws('s3api', 'put-public-access-block', data={'Bucket': bucket, 'PublicAccessBlockConfiguration': {
        'BlockPublicAcls': True, 'IgnorePublicAcls': True, 'BlockPublicPolicy': True, 'RestrictPublicBuckets': True}})
    aws('s3api', 'put-bucket-versioning', data={'Bucket': bucket, 'VersioningConfiguration': {'Status': 'Enabled'}})
    aws('s3api', 'put-bucket-encryption', data={'Bucket': bucket, 'ServerSideEncryptionConfiguration': {
        'Rules': [{'ApplyServerSideEncryptionByDefault': {'SSEAlgorithm': 'AES256'}}]}})
    policy = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Deny', 'Principal': '*', 'Action': 's3:*',
        'Resource': [f'arn:aws:s3:::{bucket}', f'arn:aws:s3:::{bucket}/*'],
        'Condition': {'Bool': {'aws:SecureTransport': 'false'}}}]}
    aws('s3api', 'put-bucket-policy', data={'Bucket': bucket, 'Policy': json.dumps(policy)})
    config = INFRA/'backend.hcl'
    config.write_text(f'bucket = "{bucket}"\nkey = "production/terraform.tfstate"\n'
                      f'region = "{args.region}"\nencrypt = true\nuse_lockfile = true\n')
    config.chmod(0o600)
    command(['terraform', f'-chdir={INFRA}', 'init', '-reconfigure', '-input=false',
             '-backend-config=backend.hcl'], capture=False)


def plan(args):
    inventory = json.loads((PRIVATE/'preflight.json').read_text())
    email = args.email
    if not email:
        contact = aws('account', 'get-contact-information', check=False)
        email = contact.get('ContactInformation', {}).get('EmailAddress') if contact else None
    if not email:
        raise RuntimeError('Provide --email for AWS cost alerts')
    config = {'region': args.region, 'project': args.project,
              'budget_email': email,
              'database_engine_version': inventory['database_engine_version']}
    save(INFRA/'deployment.auto.tfvars.json', config)
    command(['terraform', f'-chdir={INFRA}', 'plan', '-input=false', '-out=deployment.tfplan'], capture=False)
    save(PRIVATE/'plan-account.json', {'account_id': inventory['account_id'],
         'sha256': hashlib.sha256((INFRA/'deployment.tfplan').read_bytes()).hexdigest()})


def apply(args):
    approved = json.loads((PRIVATE/'plan-account.json').read_text())
    if aws('sts', 'get-caller-identity')['Account'] != approved['account_id']:
        raise RuntimeError('AWS account differs from the planned account')
    if hashlib.sha256((INFRA/'deployment.tfplan').read_bytes()).hexdigest() != approved['sha256']:
        raise RuntimeError('Saved Terraform plan has changed')
    command(['terraform', f'-chdir={INFRA}', 'apply', '-input=false', 'deployment.tfplan'], capture=False)
    save(PRIVATE/'deployment.json', outputs())


def configure_github(args):
    base = f'repos/{REPOSITORY}'
    rules = gh(base+'/rulesets')
    rule = next((r for r in rules if r['name'] == 'wmbg-main-ci'), None)
    body = {'name': 'wmbg-main-ci', 'target': 'branch', 'enforcement': 'active',
            'conditions': {'ref_name': {'include': ['refs/heads/main'], 'exclude': []}},
            'rules': [{'type': 'deletion'}, {'type': 'non_fast_forward'},
                      {'type': 'pull_request', 'parameters': {'required_approving_review_count': 0,
                       'dismiss_stale_reviews_on_push': True, 'require_code_owner_review': False,
                       'require_last_push_approval': False, 'required_review_thread_resolution': True}},
                      {'type': 'required_status_checks', 'parameters': {
                       'strict_required_status_checks_policy': True,
                       'required_status_checks': [{'context': name} for name in
                           ['backend', 'frontend', 'docker-compose', 'aws-infrastructure']]}}]}
    gh(base+'/rulesets'+('/'+str(rule['id']) if rule else ''), 'PUT' if rule else 'POST', body)
    print('GitHub main pull-request and CI protections configured')


def seed_secrets(args):
    existing = get_parameter(f'/{args.project}/app')
    if existing:
        print('Existing application credentials preserved')
    if not existing:
        key = ''
        env_file = ROOT/'.env'
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if line.startswith('GEMINI_API_KEY='):
                    tokens = shlex.split(line.split('=', 1)[1], comments=True)
                    key = tokens[0] if tokens else ''
        if not key:
            key = getpass.getpass('Gemini API key: ')
        if not key.strip():
            raise ValueError('Gemini API key must not be empty')
        put_parameter(f'/{args.project}/app', {'DB_USER': 'wmbg_app', 'DB_PASSWORD': secrets.token_urlsafe(32),
            'AUTH_HMAC_KEY': secrets.token_urlsafe(48), 'GEMINI_API_KEY': key})
    if not get_parameter(f'/{args.project}/migration'):
        put_parameter(f'/{args.project}/migration', {'DB_USER': 'wmbg_migrator',
                      'DB_PASSWORD': secrets.token_urlsafe(32)})
    if not get_parameter(f'/{args.project}/owner') and not get_parameter(f'/{args.project}/initialized'):
        owner = {'username': 'owner', 'password': secrets.token_urlsafe(24)}
        save(PRIVATE/'initial-owner.json', owner)
        put_parameter(f'/{args.project}/owner', owner)
    print('Secrets configured; initial owner credentials saved to .aws-runtime/initial-owner.json (0600)')


class RemoteCommandPending(RuntimeError):
    """Observation ended without evidence that the remote operation finished."""


class RemoteCommandFailed(RuntimeError):
    """Systems Manager reported a terminal failure."""


def wait_command(identifier, instance):
    for _ in range(180):
        response = aws('ssm', 'get-command-invocation', '--command-id', identifier,
                       '--instance-id', instance, check=False)
        if response and response['Status'] in ('Success', 'Cancelled', 'Failed', 'TimedOut'):
            if response['Status'] != 'Success':
                raise RemoteCommandFailed(f'SSM command {identifier} failed; inspect protected invocation logs')
            print('Remote operation completed')
            return
        time.sleep(5)
    raise RemoteCommandPending(
        f'SSM command {identifier} is not confirmed finished; use resume-command --command-id {identifier}')


def observe_command(receipt):
    """Clean up temporary access only once the remote outcome is known."""
    terminal = False
    try:
        wait_command(receipt['command_id'], receipt['instance_id'])
        terminal = True
        if receipt.get('bootstrap_role'):
            put_parameter(f"/{receipt['project']}/initialized", {'sha': receipt['sha']}, overwrite=True)
    except RemoteCommandFailed:
        terminal = True
        raise
    finally:
        if terminal and receipt.get('bootstrap_role'):
            aws('iam', 'delete-role-policy', '--role-name', receipt['bootstrap_role'],
                '--policy-name', 'temporary-database-bootstrap')


def remote(values, shell, *, bootstrap_role=None, sha=None):
    result = aws('ssm', 'send-command', data={'InstanceIds': [values['instance_id']],
        'DocumentName': 'AWS-RunShellScript', 'TimeoutSeconds': 60,
        'Parameters': {'commands': [shell], 'executionTimeout': ['900']}})
    identifier = result['Command']['CommandId']
    receipt = {'command_id': identifier, 'instance_id': values['instance_id'],
               'account_id': values['account_id'], 'region': values['region'],
               'project': values['project'], 'bootstrap_role': bootstrap_role, 'sha': sha}
    save(PRIVATE/'commands'/f'{identifier}.json', receipt)
    print(f'SSM command: {identifier}', flush=True)
    observe_command(receipt)


def resume_command(args):
    if not args.command_id or not re.fullmatch(r'[0-9a-f-]{36}', args.command_id):
        raise ValueError('Provide a valid --command-id from the original operation')
    receipt = json.loads((PRIVATE/'commands'/f'{args.command_id}.json').read_text())
    if receipt['region'] != args.region:
        raise ValueError('Region differs from the original command')
    if aws('sts', 'get-caller-identity')['Account'] != receipt['account_id']:
        raise ValueError('Account differs from the original command')
    observe_command(receipt)


def deploy(args):
    values = json.loads(os.environ['AWS_DEPLOYMENT']) if os.environ.get('AWS_DEPLOYMENT') else outputs()
    sha = args.sha or command(['git', 'rev-parse', 'HEAD']).stdout.strip()
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('A full Git commit SHA is required')
    if command(['git', 'rev-parse', 'HEAD']).stdout.strip() != sha:
        raise ValueError('Release bundle checkout must match the image commit')
    if command(['git', 'status', '--porcelain', '--', 'compose.aws.yml', 'deploy/aws']).stdout.strip():
        raise ValueError('Commit deployment files before releasing')
    command([sys.executable, str(ROOT/'scripts/aws/check_release.py'), sha], capture=False)
    environment = os.environ.copy()
    environment['AWS_DEPLOYMENT'] = json.dumps(values, separators=(',', ':'))
    environment['RELEASE_SHA'] = sha
    command([sys.executable, str(ROOT/'scripts/aws/build_images.py')], capture=False, env=environment)
    images = {}
    for name, repository in values['repositories'].items():
        result = aws('ecr', 'describe-images', '--repository-name', f"{values['project']}/{name}",
                     '--image-ids', 'imageTag='+sha)
        images[name] = repository+'@'+result['imageDetails'][0]['imageDigest']
    manifest = {**values, 'sha': sha, 'images': images}
    with tempfile.TemporaryDirectory(dir=PRIVATE) as workdir:
        work = Path(workdir)
        save(work/'release.json', manifest)
        archive = work/'release.tar.gz'
        with tarfile.open(archive, 'w:gz') as target:
            for path in ['compose.aws.yml', 'deploy/aws/runtime.py', 'deploy/aws/nginx.conf',
                         'deploy/aws/backup.service', 'deploy/aws/backup.timer']:
                target.add(ROOT/path, arcname=path)
            target.add(work/'release.json', arcname='release.json')
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        key = f'{sha}/{digest}.tar.gz'
        command([AWS, 's3', 'cp', str(archive), f"s3://{values['releases_bucket']}/{key}", '--only-show-errors'])
        bootstrap = f'''set -eu
cloud-init status --wait >/dev/null
python3 - <<'PY'
import boto3, hashlib, pathlib, tarfile
root = pathlib.Path('/opt/wmbg/releases/{sha}')
root.mkdir(parents=True, exist_ok=True)
archive = root/'bundle.tar.gz'
boto3.client('s3', region_name={values['region']!r}).download_file({values['releases_bucket']!r}, {key!r}, str(archive))
if hashlib.sha256(archive.read_bytes()).hexdigest() != {digest!r}:
    raise RuntimeError('Release checksum mismatch')
with tarfile.open(archive) as source:
    source.extractall(root, filter='data')
PY
flock -n /opt/wmbg/operation.lock python3 /opt/wmbg/releases/{sha}/deploy/aws/runtime.py {'initialize' if args.initialize else 'release'} --release /opt/wmbg/releases/{sha}
'''
        if args.initialize:
            policy = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow', 'Action': ['secretsmanager:GetSecretValue'],
                      'Resource': values['database_secret']}]}
            aws('iam', 'put-role-policy', data={'RoleName': values['project']+'-instance',
                'PolicyName': 'temporary-database-bootstrap', 'PolicyDocument': json.dumps(policy)})
            remote(values, bootstrap, bootstrap_role=values['project']+'-instance', sha=sha)
        else:
            remote(values, bootstrap)
            print('Application URL: '+values['public_url'])


def operational(args):
    values = outputs()
    action = args.action
    suffix = ''
    if action == 'rollback':
        if not args.schema_compatible:
            raise ValueError('Review migrations and pass --schema-compatible')
        suffix = ' --schema-compatible'
    if action == 'restore':
        if not args.target_host or not args.backup_key:
            raise ValueError('Restore requires --target-host and --backup-key')
        suffix = ' --target-host '+shlex.quote(args.target_host)+' --backup-key '+shlex.quote(args.backup_key)
    remote(values, 'flock -n /opt/wmbg/operation.lock python3 /opt/wmbg/current/deploy/aws/runtime.py '+action+suffix)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['preflight', 'init-state', 'plan', 'apply', 'configure-github',
                                          'seed-secrets', 'deploy', 'backup', 'rollback', 'restore', 'verify', 'resume-command'])
    parser.add_argument('--region', default='ap-southeast-2')
    parser.add_argument('--project', default='wmbg')
    parser.add_argument('--profile')
    parser.add_argument('--email')
    parser.add_argument('--sha')
    parser.add_argument('--initialize', action='store_true')
    parser.add_argument('--schema-compatible', action='store_true')
    parser.add_argument('--target-host')
    parser.add_argument('--backup-key')
    parser.add_argument('--command-id')
    args = parser.parse_args()
    if args.profile:
        os.environ['AWS_PROFILE'] = args.profile
    os.environ['AWS_DEFAULT_REGION'] = args.region
    os.umask(0o077)
    PRIVATE.mkdir(exist_ok=True, mode=0o700)
    handlers = {'preflight': preflight, 'init-state': init_state, 'plan': plan, 'apply': apply,
                'configure-github': configure_github, 'seed-secrets': seed_secrets, 'deploy': deploy,
                'backup': operational, 'rollback': operational, 'restore': operational, 'resume-command': resume_command}
    if args.action == 'verify':
        values = outputs()
        for path in ['/api/health', '/login']:
            command(['curl', '--fail', '--silent', '--show-error', values['public_url']+path])
        print('AWS URL serves health and login; run authenticated browser acceptance separately')
    else:
        handlers[args.action](args)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, (ValueError, RuntimeError)) else
              f'Operation failed ({type(error).__name__})', file=sys.stderr)
        sys.exit(1)
