"""Optional live-PostgreSQL contract: uses an isolated temporary schema."""

import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text

from where_my_buck_go.adapters.auth_repo import PostgresAuthStore
from where_my_buck_go.adapters.db import metadata
from where_my_buck_go.services.auth import AuthService, LoginLimitedError


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="Set TEST_DATABASE_URL for live PostgreSQL tests")
def test_postgres_owner_sessions_and_rate_limit() -> None:
    url = os.environ["TEST_DATABASE_URL"]
    schema = "wmbg_test_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        metadata.create_all(engine)
        service = AuthService(PostgresAuthStore(engine), b"integration-key-at-least-32-bytes-long")
        assert service.bootstrap("owner", "long-owner-password-123")
        assert not service.bootstrap("other", "long-owner-password-123")
        assert service.login("owner", "bad", "192.0.2.9") is None
        result = service.login("owner", "long-owner-password-123", "192.0.2.9")
        assert result is not None
        session = service.session(result.token)
        assert session is not None and session.username == "owner"
        assert service.check_csrf(session, result.csrf)
        assert not service.check_csrf(session, "different")
        with engine.connect() as conn:
            attempt = conn.execute(text("SELECT address_digest FROM login_attempts LIMIT 1")).scalar_one()
            assert attempt != b"192.0.2.9"
            assert conn.execute(text("SELECT count(*) FROM users")).scalar_one() == 1
        service.logout(result.token)
        assert service.session(result.token) is None
        replacement = service.login("owner", "long-owner-password-123", "192.0.2.10")
        assert replacement is not None
        assert service.reset_password("owner", "replacement-long-password-123")
        assert service.session(replacement.token) is None
        assert service.login("owner", "long-owner-password-123", "192.0.2.11") is None
        assert service.login("owner", "replacement-long-password-123", "192.0.2.12") is not None
        for _ in range(8):
            assert service.login("unknown", "bad", "192.0.2.9") is None
        with pytest.raises(LoginLimitedError):
            service.login("owner", "long-owner-password-123", "192.0.2.9")
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
