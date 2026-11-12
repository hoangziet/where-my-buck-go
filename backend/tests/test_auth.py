"""Auth contract tests without a live database."""

from datetime import datetime, timedelta, timezone

import pytest

from where_my_buck_go.api.app import create_app
from where_my_buck_go.services.auth import AuthService, LoginLimitedError, SessionRecord, UserRecord


class MemoryAuthStore:
    def __init__(self) -> None:
        self.users: dict[str, UserRecord] = {}
        self.sessions: dict[bytes, SessionRecord] = {}
        self.attempts: dict[bytes, int] = {}

    def find_user(self, username: str) -> UserRecord | None:
        return self.users.get(username)

    def create_owner(self, username: str, password_hash: str, now: datetime) -> bool:
        if self.users:
            return False
        self.users[username] = UserRecord("owner-1", username, password_hash)
        return True

    def reset_password(self, username: str, password_hash: str, now: datetime) -> bool:
        user = self.users.get(username)
        if user is None:
            return False
        self.users[username] = UserRecord(user.id, username, password_hash)
        self.sessions = {key: session for key, session in self.sessions.items() if session.user_id != user.id}
        return True

    def reserve_login(self, digest: bytes, now: datetime) -> bool:
        count = self.attempts.get(digest, 0)
        self.attempts[digest] = count + 1
        return count < 10

    def create_session(self, user_id: str, token_digest: bytes, csrf_digest: bytes, expiry: datetime) -> None:
        self.sessions[token_digest] = SessionRecord(user_id, "owner", csrf_digest, expiry)

    def find_session(self, token_digest: bytes, now: datetime) -> SessionRecord | None:
        session = self.sessions.get(token_digest)
        return session if session and session.expires_at > now else None

    def revoke_session(self, token_digest: bytes, now: datetime) -> None:
        self.sessions.pop(token_digest, None)


@pytest.fixture
def setup() -> tuple[AuthService, MemoryAuthStore]:
    store = MemoryAuthStore()
    service = AuthService(store, b"test-hmac-key-must-be-at-least-32-bytes")
    assert service.bootstrap("owner", "very-long-password-123")
    return service, store


def test_bootstrap_only_once(setup: tuple[AuthService, MemoryAuthStore]) -> None:
    service, _ = setup
    assert not service.bootstrap("other", "very-long-password-123")


def test_password_reset_revokes_sessions(setup: tuple[AuthService, MemoryAuthStore]) -> None:
    service, _ = setup
    old_session = service.login("owner", "very-long-password-123", "192.0.2.1")
    assert old_session is not None
    assert not service.reset_password("missing", "new-long-password-123")
    assert service.session(old_session.token) is not None
    assert service.reset_password("owner", "new-long-password-123")
    assert service.session(old_session.token) is None
    assert service.login("owner", "very-long-password-123", "192.0.2.2") is None
    assert service.login("owner", "new-long-password-123", "192.0.2.3") is not None


def test_change_password_verifies_current_and_revokes_sessions(
    setup: tuple[AuthService, MemoryAuthStore],
) -> None:
    service, _ = setup
    session = service.login("owner", "very-long-password-123", "192.0.2.1")
    assert session is not None
    assert not service.change_password("owner", "wrong-current-password", "new-long-password-123")
    assert service.session(session.token) is not None
    with pytest.raises(ValueError):
        service.change_password("owner", "very-long-password-123", "short")
    assert service.change_password("owner", "very-long-password-123", "new-long-password-123")
    assert service.session(session.token) is None
    assert service.login("owner", "very-long-password-123", "192.0.2.2") is None
    assert service.login("owner", "new-long-password-123", "192.0.2.3") is not None


def test_login_rate_limit_and_no_plain_ip(setup: tuple[AuthService, MemoryAuthStore]) -> None:
    service, store = setup
    for _ in range(10):
        assert service.login("owner", "bad", "192.0.2.9") is None
    with pytest.raises(LoginLimitedError):
        service.login("owner", "very-long-password-123", "192.0.2.9")
    assert all(isinstance(key, bytes) and len(key) == 32 for key in store.attempts)
    assert service.login("owner", "very-long-password-123", "192.0.2.10") is not None


def test_session_expiry_and_logout(setup: tuple[AuthService, MemoryAuthStore]) -> None:
    service, store = setup
    result = service.login("owner", "very-long-password-123", "127.0.0.1")
    assert result is not None
    from where_my_buck_go.services.auth import digest_secret

    session = service.session(result.token)
    assert session and session.expires_at > datetime.now(timezone.utc) + timedelta(hours=11)
    store.sessions[digest_secret(result.token)] = SessionRecord(session.user_id, session.username,
                                                                session.csrf_digest, datetime.now(timezone.utc))
    assert service.session(result.token) is None
    service.logout(result.token)
    assert service.session(result.token) is None


def test_http_cookie_csrf_permissions_and_revocation(setup: tuple[AuthService, MemoryAuthStore]) -> None:
    service, _ = setup
    app = create_app(service, production=True)
    client = app.test_client()
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/logout").status_code == 401
    assert client.post("/api/auth/login", json={"username": "owner", "password": "bad"}).status_code == 401
    response = client.post("/api/auth/login", json={"username": "owner", "password": "very-long-password-123"})
    assert response.status_code == 200
    assert "__Host-wmbg_session=" in response.headers.getlist("Set-Cookie")[0]
    assert "Secure" in response.headers.getlist("Set-Cookie")[0]
    assert "HttpOnly" in response.headers.getlist("Set-Cookie")[0]
    assert "SameSite=Strict" in response.headers.getlist("Set-Cookie")[0]
    assert response.headers["Cache-Control"] == "no-store"
    assert client.get("/api/auth/me").json == {"username": "owner"}
    assert client.post("/api/auth/login", json={"username": "owner", "password": "bad"}).status_code == 403
    assert client.post("/api/auth/logout").status_code == 403
    assert client.post("/api/auth/logout", headers={"X-CSRF-Token": "wrong"}).status_code == 403
    csrf = response.json["csrfToken"]
    assert client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf}).status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/register", json={}).status_code == 401


def test_change_password_endpoint(setup: tuple[AuthService, MemoryAuthStore]) -> None:
    service, _ = setup
    app = create_app(service, production=True)
    client = app.test_client()
    login = client.post("/api/auth/login", json={"username": "owner", "password": "very-long-password-123"})
    csrf = login.json["csrfToken"]
    assert client.post("/api/auth/change-password",
                       json={"currentPassword": "very-long-password-123", "newPassword": "new-long-password-123"},
                       ).status_code == 403
    assert client.post("/api/auth/change-password", json={"currentPassword": "wrong", "newPassword": "x" * 20},
                       headers={"X-CSRF-Token": csrf}).status_code == 401
    assert client.post("/api/auth/change-password", json={"currentPassword": "very-long-password-123",
                                                           "newPassword": "short"},
                       headers={"X-CSRF-Token": csrf}).status_code == 400
    response = client.post("/api/auth/change-password",
                           json={"currentPassword": "very-long-password-123", "newPassword": "new-long-password-123"},
                           headers={"X-CSRF-Token": csrf})
    assert response.status_code == 200 and response.json == {"ok": True}
    assert client.get("/api/auth/me").status_code == 401
    relogged = client.post("/api/auth/login", json={"username": "owner", "password": "new-long-password-123"})
    assert relogged.status_code == 200
