"""Deployment guards: immutable releases, credential handling, and safe recovery."""

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


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
