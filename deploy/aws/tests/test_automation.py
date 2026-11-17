"""Deployment guards: immutable releases, credential handling, and safe recovery."""

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT/file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


runtime = module('aws_runtime', 'deploy/aws/runtime.py')
checks = module('aws_checks', 'scripts/aws/check_release.py')
manager = module('aws_manager', 'scripts/aws/manage.py')


def test_missing_or_newer_failed_checks_cannot_release():
    complete = [{'id': i, 'name': name, 'conclusion': 'success'}
                for i, name in enumerate(sorted(checks.REQUIRED), start=1)]
    assert checks.ready(complete)
    assert not checks.ready(complete[:-1])
    failed = {'id': 99, 'name': 'backend', 'conclusion': 'failure'}
    assert not checks.ready([failed, *complete])
    assert not checks.ready([*complete, {**failed, 'conclusion': None}])


def test_environment_secrets_are_private_and_multiline_is_rejected(tmp_path):
    path = tmp_path/'app.env'
    runtime.write_env(path, {'DB_PASSWORD': "a$b'c\\d"})
    assert path.stat().st_mode & 0o777 == 0o600
    assert path.read_text() == "DB_PASSWORD='a$b\\'c\\\\d'\n"
    with pytest.raises(ValueError, match='single-line'):
        runtime.write_env(path, {'DB_PASSWORD': 'value\nINJECTED=secret'})
    runtime.write_env(path, {'PGPASSWORD': 'a$b'}, compose=False)
    assert path.read_text() == 'PGPASSWORD=a$b\n'


def test_recovery_rejects_live_database_before_accessing_aws():
    with pytest.raises(ValueError, match='separate target'):
        runtime.restore_archive(Path('/unused'), {'database_host': 'live-db'},
                                None, 'backup/key', 'live-db', 'restore')


def test_saved_plan_is_bound_to_aws_account(tmp_path, monkeypatch):
    monkeypatch.setattr(manager, 'PRIVATE', tmp_path)
    (tmp_path/'plan-account.json').write_text(json.dumps({'account_id': 'expected'}))
    monkeypatch.setattr(manager, 'aws', lambda *a, **kw: {'Account': 'different'})
    with pytest.raises(RuntimeError, match='differs'):
        manager.apply(None)


def test_backup_resumes_app_after_dump_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, 'ROOT', tmp_path)
    monkeypatch.setattr(runtime, 'parameter', lambda *a: {'DB_USER': 'backup', 'DB_PASSWORD': 'secret'})
    calls = []
    monkeypatch.setattr(runtime, 'compose', lambda release, *args, **kw: calls.append(args))

    def fail(*args, **kwargs):
        raise RuntimeError('dump failed')

    monkeypatch.setattr(runtime, 'run', fail)
    manifest = {'project': 'wmbg', 'database_host': 'db', 'database_name': 'db', 'images': {'tools': 'tools'}}
    with pytest.raises(RuntimeError, match='dump failed'):
        runtime.archive(tmp_path, manifest, None)
    assert calls[0] == ('stop', 'proxy', 'frontend', 'backend')
    assert calls[-1][:3] == ('up', '-d', '--wait')


def test_existing_credentials_need_no_interactive_prompt(tmp_path, monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setattr(manager, 'PRIVATE', tmp_path)
    monkeypatch.setattr(manager, 'get_parameter', lambda name: {'existing': True})
    monkeypatch.setattr(manager.getpass, 'getpass', lambda prompt: pytest.fail('Unexpected prompt'))
    monkeypatch.setattr(manager, 'put_parameter', lambda *a, **kw: pytest.fail('Unexpected secret write'))
    manager.seed_secrets(SimpleNamespace(project='wmbg'))


def test_interrupted_secret_setup_preserves_credentials_and_creates_owner(tmp_path, monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setattr(manager, 'PRIVATE', tmp_path)
    monkeypatch.setattr(manager, 'get_parameter', lambda name: {'existing': True}
                        if name.endswith(('/app', '/migration')) else None)
    writes = []
    monkeypatch.setattr(manager, 'put_parameter', lambda name, value: writes.append((name, value)))
    manager.seed_secrets(SimpleNamespace(project='wmbg'))
    assert [name for name, _ in writes] == ['/wmbg/owner']
    assert json.loads((tmp_path/'initial-owner.json').read_text()) == writes[0][1]


def test_deployment_rejects_bundle_from_another_commit_before_ecr(monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setenv('AWS_DEPLOYMENT', '{}')
    monkeypatch.setattr(manager, 'command', lambda args: SimpleNamespace(stdout='b' * 40))
    monkeypatch.setattr(manager, 'aws', lambda *a, **kw: pytest.fail('Unexpected AWS call'))
    with pytest.raises(ValueError, match='checkout must match'):
        manager.deploy(SimpleNamespace(sha='a' * 40))


@pytest.mark.parametrize('database_versions,compute_available,expected', [
    ([], True, 'PostgreSQL 17'),
    (['17.7'], False, 'EC2 t3.small'),
])
def test_preflight_rejects_unavailable_capacity(
    tmp_path, monkeypatch, database_versions, compute_available, expected,
):
    from types import SimpleNamespace

    def aws(service, operation, *args, **kwargs):
        if service == 'sts':
            return {'Account': '123456789012'}
        if service == 'rds' and operation == 'describe-db-engine-versions':
            return {'DBEngineVersions': [{'EngineVersion': v} for v in database_versions]}
        if service == 'rds':
            return {'OrderableDBInstanceOptions': [
                {'EngineVersion': version, 'StorageType': 'gp3'} for version in database_versions
            ]}
        if service == 'ec2':
            return {'InstanceTypeOfferings': [{}] if compute_available else []}
        pytest.fail('Preflight continued after unavailable capacity')

    monkeypatch.setattr(manager, 'PRIVATE', tmp_path)
    monkeypatch.setattr(manager, 'aws', aws)
    monkeypatch.setattr(manager, 'gh', lambda *a: {'permissions': {'admin': True}})
    monkeypatch.setattr(manager.shutil, 'which', lambda tool: '/usr/bin/' + tool)
    with pytest.raises(RuntimeError, match=expected):
        manager.preflight(SimpleNamespace(region='ap-southeast-2'))
    assert not (tmp_path/'preflight.json').exists()


def test_observation_timeout_preserves_bootstrap_access(monkeypatch):
    calls = []
    monkeypatch.setattr(manager, 'aws', lambda *a, **kw: calls.append(a))

    def pending(*args):
        raise manager.RemoteCommandPending('still running')

    monkeypatch.setattr(manager, 'wait_command', pending)
    with pytest.raises(manager.RemoteCommandPending):
        manager.observe_command({'command_id': 'id', 'instance_id': 'instance',
                                 'bootstrap_role': 'temporary-role'})
    assert calls == []


def test_terminal_failure_removes_bootstrap_access(monkeypatch):
    calls = []
    monkeypatch.setattr(manager, 'aws', lambda *a, **kw: calls.append(a))

    def failed(*args):
        raise manager.RemoteCommandFailed('failed')

    monkeypatch.setattr(manager, 'wait_command', failed)
    with pytest.raises(manager.RemoteCommandFailed):
        manager.observe_command({'command_id': 'id', 'instance_id': 'instance',
                                 'bootstrap_role': 'temporary-role'})
    assert calls == [('iam', 'delete-role-policy', '--role-name', 'temporary-role',
                      '--policy-name', 'temporary-database-bootstrap')]


def test_remote_receipt_is_saved_before_observation(tmp_path, monkeypatch):
    monkeypatch.setattr(manager, 'PRIVATE', tmp_path)
    monkeypatch.setattr(manager, 'aws', lambda *a, **kw: {'Command': {'CommandId': 'command-id'}})

    def observe(receipt):
        assert json.loads((tmp_path/'commands/command-id.json').read_text()) == receipt
        raise manager.RemoteCommandPending('pending')

    monkeypatch.setattr(manager, 'observe_command', observe)
    with pytest.raises(manager.RemoteCommandPending):
        manager.remote({'instance_id': 'instance', 'account_id': 'account',
                        'region': 'region', 'project': 'project'}, 'true')


def test_aws_org_policy_denial_is_actionable(monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setattr(manager.subprocess, 'run', lambda *a, **kw: SimpleNamespace(
        returncode=254, stderr='not authorized to perform: iam:ListOpenIDConnectProviders with an explicit deny in a service control policy', stdout=''))
    with pytest.raises(RuntimeError, match='AWS-managed project policy'):
        manager.command(['aws', 'iam'])
