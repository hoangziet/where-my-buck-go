"""Host-side release and recovery operations, invoked through AWS Systems Manager."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import boto3

ROOT = Path('/opt/wmbg')


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def parameter(session, name):
    return json.loads(session.client('ssm').get_parameter(Name=name, WithDecryption=True)['Parameter']['Value'])


def write_env(path, values, *, compose=True):
    lines = []
    for name, value in values.items():
        value = str(value)
        if '\n' in value or '\r' in value or '\x00' in value:
            raise ValueError('Environment values must be single-line strings')
        if compose:
            value = "'" + value.replace('\\', '\\\\').replace("'", "\\'") + "'"
        lines.append(f'{name}={value}')
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as target:
        target.write('\n'.join(lines) + '\n')


def compose(release, *args, **kwargs):
    return run(['docker', 'compose', '--project-name', 'wmbg', '--env-file', str(release/'images.env'),
                '-f', str(release/'compose.aws.yml'), *args], **kwargs)


def configure(release, manifest, session):
    common = {'DB_HOST': manifest['database_host'], 'DB_NAME': manifest['database_name'],
              'AWS_REGION': manifest['region'], 'S3_BUCKET_NAME': manifest['evidence_bucket']}
    for label in ('app', 'migration'):
        secret = parameter(session, f"/{manifest['project']}/{label}")
        write_env(ROOT/f'{label}.env', {**common, **secret})
    write_env(release/'images.env', {**{f'{key.upper()}_IMAGE': value for key, value in manifest['images'].items()},
                                    'AWS_REGION': manifest['region'], 'AWS_PROJECT': manifest['project']})
    token = session.client('ecr').get_authorization_token()['authorizationData'][0]
    import base64
    password = base64.b64decode(token['authorizationToken']).decode().split(':', 1)[1]
    run(['docker', 'login', '--username', 'AWS', '--password-stdin', token['proxyEndpoint']],
        input=password, text=True, stdout=subprocess.DEVNULL)
    compose(release, 'pull', 'backend', 'frontend', 'migrate', 'proxy')


def pg_environment(secret, manifest):
    return {'PGHOST': manifest['database_host'], 'PGDATABASE': manifest['database_name'],
            'PGUSER': secret['DB_USER'], 'PGPASSWORD': secret['DB_PASSWORD'],
            'PGSSLMODE': 'verify-full', 'PGSSLROOTCERT': '/run/certs/rds.pem'}


def archive(release, manifest, session):
    """Pause writers, archive PostgreSQL and referenced objects, then resume."""
    prefix = 'daily/' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    with tempfile.TemporaryDirectory(dir=ROOT) as workdir:
        work = Path(workdir)
        secret = parameter(session, f"/{manifest['project']}/migration")
        write_env(work/'pg.env', pg_environment(secret, manifest), compose=False)
        tool = ['docker', 'run', '--rm', '--network', 'host', '--env-file', str(work/'pg.env'),
                '-v', f'{ROOT}/certs/rds.pem:/run/certs/rds.pem:ro',
                '-v', f'{work}:/backup', manifest['images']['tools']]
        compose(release, 'stop', 'proxy', 'frontend', 'backend')
        try:
            run([*tool, 'pg_dump', '-Fc', '-f', '/backup/database.dump'])
            run([*tool, 'pg_restore', '--list', '/backup/database.dump'], stdout=subprocess.DEVNULL)
            with (work/'evidence.tar').open('wb') as output:
                compose(release, 'run', '--rm', '--no-deps', '-T', 'backend',
                        'wmbg-export-evidence', stdout=output)
            backup = {'version': 1, 'release': manifest['sha'], 'files': {}}
            client = session.client('s3')
            for name in ('database.dump', 'evidence.tar'):
                file = work/name
                with file.open('rb') as source:
                    digest = hashlib.file_digest(source, 'sha256').hexdigest()
                key = f'{prefix}/{name}'
                client.upload_file(str(file), manifest['recovery_bucket'], key,
                                   ExtraArgs={'Metadata': {'sha256': digest}})
                backup['files'][name] = {'key': key, 'sha256': digest}
            client.put_object(Bucket=manifest['recovery_bucket'], Key=f'{prefix}/manifest.json',
                              Body=json.dumps(backup).encode(), ContentType='application/json')
        finally:
            compose(release, 'up', '-d', '--wait', '--wait-timeout', '180')
    print(f'Backup complete: s3://{manifest["recovery_bucket"]}/{prefix}/manifest.json')


def initialize_database(manifest, session):
    """Run only while a temporary bootstrap IAM policy grants administrator access."""
    import psycopg
    from psycopg import sql

    master = json.loads(session.client('secretsmanager').get_secret_value(
        SecretId=manifest['database_secret'])['SecretString'])
    migration = parameter(session, f"/{manifest['project']}/migration")
    app = parameter(session, f"/{manifest['project']}/app")
    with psycopg.connect(host=manifest['database_host'], dbname=manifest['database_name'],
                          user=master['username'], password=master['password'], sslmode='verify-full',
                          sslrootcert=str(ROOT/'certs/rds.pem'), autocommit=True) as connection:
        for credentials in (migration, app):
            name = credentials['DB_USER']
            if not connection.execute('SELECT 1 FROM pg_roles WHERE rolname = %s', (name,)).fetchone():
                connection.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(
                    sql.Identifier(name), sql.Literal(credentials['DB_PASSWORD'])))
        connection.execute(sql.SQL('GRANT {} TO {}').format(sql.Identifier(migration['DB_USER']),
                                                            sql.Identifier(master['username'])))
        connection.execute(sql.SQL('ALTER SCHEMA public OWNER TO {}').format(sql.Identifier(migration['DB_USER'])))
        connection.execute('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
        connection.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(app['DB_USER'])))
        for target, permissions in [('TABLES', 'SELECT, INSERT, UPDATE, DELETE'), ('SEQUENCES', 'USAGE, SELECT')]:
            connection.execute(sql.SQL('ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT {} ON {} TO {}').format(
                sql.Identifier(migration['DB_USER']), sql.SQL(permissions), sql.SQL(target), sql.Identifier(app['DB_USER'])))
            connection.execute(sql.SQL('GRANT {} ON ALL {} IN SCHEMA public TO {}').format(
                sql.SQL(permissions), sql.SQL(target), sql.Identifier(app['DB_USER'])))
    print('Database roles initialized')


def release_app(release, manifest, session):
    configure(release, manifest, session)
    current = ROOT/'current'
    previous = current.resolve() if current.exists() else None
    if previous:
        previous_manifest = json.loads((previous/'release.json').read_text())
        archive(previous, previous_manifest, session)
    # A failed migration leaves the prior application intact and surfaces the failure.
    # Schema rollback is never attempted automatically.
    compose(release, 'run', '--rm', '--no-deps', '-T', 'migrate')
    compose(release, 'up', '-d', '--wait', '--wait-timeout', '180')
    run(['curl', '--fail', '--silent', '--show-error', 'http://127.0.0.1:8080/api/health'],
        stdout=subprocess.DEVNULL)
    pending = ROOT/'current.pending'
    pending.unlink(missing_ok=True)
    pending.symlink_to(release)
    pending.replace(current)
    if previous and previous != release:
        link = ROOT/'previous'
        link.unlink(missing_ok=True)
        link.symlink_to(previous)
    for filename in ('service', 'timer'):
        shutil.copyfile(release/f'deploy/aws/backup.{filename}', f'/etc/systemd/system/wmbg-backup.{filename}')
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', 'wmbg-backup.timer'])
    owner_name = f"/{manifest['project']}/owner"
    try:
        owner = parameter(session, owner_name)
    except session.client('ssm').exceptions.ParameterNotFound:
        owner = None
    if owner:
        with tempfile.TemporaryDirectory(dir=ROOT) as directory:
            path = Path(directory)/'owner.json'
            path.write_text(json.dumps(owner))
            path.chmod(0o600)
            code = (
                "import json,os; from where_my_buck_go.adapters.auth_repo import PostgresAuthStore; "
                "from where_my_buck_go.adapters.db import database_url_from_environment,engine_for; "
                "from where_my_buck_go.services.auth import AuthService; "
                "owner=json.load(open('/run/owner.json')); "
                "service=AuthService(PostgresAuthStore(engine_for(database_url_from_environment())),"
                "os.environ['AUTH_HMAC_KEY'].encode()); "
                "service.bootstrap(owner['username'],owner['password']); print('Owner bootstrap checked')"
            )
            compose(release, 'run', '--rm', '--no-deps', '-T', '--volume', f'{path}:/run/owner.json:ro',
                    'backend', 'python', '-c', code)
        session.client('ssm').delete_parameter(Name=owner_name)
    print(f'Released {manifest["sha"]}')


def restore_archive(release, manifest, session, backup_key, target_host, target_db):
    """Restore only to a separate RDS target; never overwrite the live ledger."""
    if target_host == manifest['database_host']:
        raise ValueError('Restore requires a separate target host')
    recovery = parameter(session, f"/{manifest['project']}/restore")
    target = {**manifest, 'database_host': target_host, 'database_name': target_db}
    if recovery.get('S3_BUCKET_NAME') in (None, manifest['evidence_bucket']):
        raise ValueError('A separate recovery evidence bucket is required')
    client = session.client('s3')
    backup = json.loads(client.get_object(Bucket=manifest['recovery_bucket'], Key=backup_key)['Body'].read())
    with tempfile.TemporaryDirectory(dir=ROOT) as workdir:
        work = Path(workdir)
        for name in ('database.dump', 'evidence.tar'):
            entry = backup['files'][name]
            client.download_file(manifest['recovery_bucket'], entry['key'], str(work/name))
            with (work/name).open('rb') as source:
                if hashlib.file_digest(source, 'sha256').hexdigest() != entry['sha256']:
                    raise ValueError('Recovery archive checksum does not match')
        write_env(work/'pg.env', pg_environment(recovery, target), compose=False)
        run(['docker', 'run', '--rm', '--network', 'host', '--env-file', str(work/'pg.env'),
             '-v', f'{ROOT}/certs/rds.pem:/run/certs/rds.pem:ro', '-v', f'{work}:/backup:ro',
             manifest['images']['tools'], 'pg_restore', '--no-owner', '--no-acl', '--exit-on-error',
             '--dbname', target_db, '/backup/database.dump'])
        # Evidence restoration must use a separate recovery bucket supplied in the protected parameter.
        if recovery.get('S3_BUCKET_NAME') in (None, manifest['evidence_bucket']):
            raise ValueError('A separate recovery evidence bucket is required')
        write_env(work/'restore.env', {**recovery, 'DB_HOST': target_host, 'DB_NAME': target_db,
                  'AWS_REGION': manifest['region'], 'APP_ENV': 'production', 'EVIDENCE_PROVIDER': 's3',
                  'DB_SSLMODE': 'verify-full', 'DB_SSLROOTCERT': '/run/certs/rds.pem'}, compose=False)
        run(['docker', 'run', '--rm', '--network', 'host', '--env-file', str(work/'restore.env'),
             '-v', f'{ROOT}/certs/rds.pem:/run/certs/rds.pem:ro', '-v', f'{work}:/backup:ro',
             manifest['images']['backend'], 'wmbg-restore-evidence', '/backup/evidence.tar'])
    print('Recovery archive restored and evidence checksums verified on the isolated target')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['release', 'initialize', 'backup', 'rollback', 'restore'])
    parser.add_argument('--release', type=Path, default=ROOT/'current')
    parser.add_argument('--schema-compatible', action='store_true')
    parser.add_argument('--backup-key')
    parser.add_argument('--target-host')
    parser.add_argument('--target-db', default='wmbg_restore')
    args = parser.parse_args()
    release = args.release.resolve()
    manifest = json.loads((release/'release.json').read_text())
    session = boto3.Session(region_name=manifest['region'])
    if args.action == 'initialize':
        initialize_database(manifest, session)
    elif args.action == 'release':
        release_app(release, manifest, session)
    elif args.action == 'backup':
        success = 0
        try:
            archive(release, manifest, session)
            success = 1
        finally:
            session.client('cloudwatch').put_metric_data(Namespace='WhereMyBuckGo', MetricData=[{
                'MetricName': 'BackupSuccess', 'Value': success, 'Unit': 'Count',
                'Dimensions': [{'Name': 'Project', 'Value': manifest['project']}],
            }])
    elif args.action == 'restore':
        if not args.backup_key or not args.target_host:
            parser.error('Restore requires --backup-key and --target-host')
        restore_archive(release, manifest, session, args.backup_key, args.target_host, args.target_db)
    else:
        if not args.schema_compatible:
            parser.error('Rollback requires --schema-compatible after reviewing migrations')
        previous = (ROOT/'previous').resolve(strict=True)
        manifest = json.loads((previous/'release.json').read_text())
        configure(previous, manifest, session)
        compose(previous, 'up', '-d', '--wait', '--wait-timeout', '180')
        link = ROOT/'current'
        link.unlink()
        link.symlink_to(previous)
        print(f'Rolled back application images to {manifest["sha"]}; database was not replaced')


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as error:
        # SQL/SDK/subprocess exceptions may contain sensitive connection data.
        print(f'Operation failed ({type(error).__name__}); inspect protected host diagnostics.', file=sys.stderr)
        sys.exit(1)
