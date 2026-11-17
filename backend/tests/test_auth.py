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

    def create_user(self, username: str, password_hash: str, now: datetime) -> UserRecord:
        user_id = f"user-{len(self.users) + 1}"
        record = UserRecord(user_id, username, password_hash)
        self.users[username] = record
        return record

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
        username = next((u.username for u in self.users.values() if u.id == user_id), "owner")
        self.sessions[token_digest] = SessionRecord(user_id, username, csrf_digest, expiry)

    def find_session(self, token_digest: bytes, now: datetime) -> SessionRecord | None:
        session = self.sessions.get(token_digest)
        return session if session and session.expires_at > now else None

    def extend_session(self, token_digest: bytes, expiry: datetime, now: datetime) -> bool:
        session = self.find_session(token_digest, now)
        if session is None:
            return False
        self.sessions[token_digest] = SessionRecord(session.user_id, session.username, session.csrf_digest, expiry)
        return True

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
    assert session and session.expires_at > datetime.now(timezone.utc) + timedelta(days=29)
    store.sessions[digest_secret(result.token)] = SessionRecord(session.user_id, session.username,
                                                                session.csrf_digest, datetime.now(timezone.utc))
    assert service.session(result.token) is None
    service.logout(result.token)
    assert service.session(result.token) is None


def test_session_slides_forward_when_used(setup: tuple[AuthService, MemoryAuthStore]) -> None:
    from where_my_buck_go.services.auth import digest_secret

    service, store = setup
    result = service.login("owner", "very-long-password-123", "127.0.0.1")
    assert result is not None
    fresh = service.session(result.token)
    assert fresh is not None
    assert service.renew_if_due(result.token, fresh) is None

    now = datetime.now(timezone.utc)
    store.sessions[digest_secret(result.token)] = SessionRecord(fresh.user_id, fresh.username,
                                                                fresh.csrf_digest, now + timedelta(days=3))
    aging = service.session(result.token)
    assert aging is not None
    renewed = service.renew_if_due(result.token, aging)
    assert renewed is not None and renewed.expires_at > now + timedelta(days=29)
    assert service.session(result.token) == renewed

    store.sessions[digest_secret(result.token)] = SessionRecord(fresh.user_id, fresh.username,
                                                                fresh.csrf_digest, now - timedelta(seconds=1))
    assert service.session(result.token) is None


def test_http_renews_session_cookies_but_not_on_logout(setup: tuple[AuthService, MemoryAuthStore]) -> None:
    service, store = setup
    client = create_app(service, production=True).test_client()
    response = client.post("/api/auth/login", json={"username": "owner", "password": "very-long-password-123"})
    assert "Max-Age=2592000" in response.headers.getlist("Set-Cookie")[0]
    csrf = response.json["csrfToken"]
    assert not client.get("/api/auth/me").headers.getlist("Set-Cookie")

    key = next(iter(store.sessions))
    session = store.sessions[key]
    store.sessions[key] = SessionRecord(session.user_id, session.username, session.csrf_digest,
                                        datetime.now(timezone.utc) + timedelta(days=2))
    renewed = client.get("/api/auth/me")
    cookies = renewed.headers.getlist("Set-Cookie")
    assert renewed.status_code == 200 and len(cookies) == 2
    assert all("Max-Age=2592000" in cookie and "Secure" in cookie for cookie in cookies)
    assert "__Host-wmbg_session=" in cookies[0] and "HttpOnly" in cookies[0]
    assert f"__Host-wmbg_csrf={csrf}" in cookies[1]
    assert store.sessions[key].expires_at > datetime.now(timezone.utc) + timedelta(days=29)

    store.sessions[key] = SessionRecord(session.user_id, session.username, session.csrf_digest,
                                        datetime.now(timezone.utc) + timedelta(days=2))
    logout = client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf})
    assert logout.status_code == 200
    assert all("Max-Age=0" in cookie for cookie in logout.headers.getlist("Set-Cookie"))
    assert key not in store.sessions


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


def test_production_proxy_fix_resolves_client_ip(setup: tuple[AuthService, MemoryAuthStore]) -> None:
    import hmac

    service, store = setup
    app = create_app(service, production=True)
    client = app.test_client()
    client.post("/api/auth/login", json={"username": "owner", "password": "wrong"},
                headers={"X-Forwarded-For": "203.0.113.195"})
    expected_digest = hmac.digest(service.hmac_key, b"203.0.113.195", "sha256")
    assert expected_digest in store.attempts


def test_oauth_login_or_register(setup: tuple[AuthService, MemoryAuthStore]) -> None:
    service, store = setup
    result = service.login_or_register_oauth("user@example.com")
    assert result.username == "user@example.com"
    assert result.token
    assert result.csrf

    result2 = service.login_or_register_oauth("user@example.com")
    assert result2.username == "user@example.com"
    assert len(store.users) == 2

    session = service.session(result2.token)
    assert session is not None
    assert session.username == "user@example.com"


def test_google_auth_routes(setup: tuple[AuthService, MemoryAuthStore]) -> None:
    import re

    import httpx

    from where_my_buck_go.adapters.google_auth import GoogleAuthClient

    service, store = setup

    # 1. Unconfigured client
    unconfigured_app = create_app(service, google_auth=GoogleAuthClient("", ""))
    client = unconfigured_app.test_client()
    resp = client.get("/api/auth/google")
    assert resp.status_code == 302
    assert "error=Google%20Sign-In%20is%20not%20configured" in resp.headers["Location"]

    # 2. Mock transport for Google OAuth
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            return httpx.Response(200, json={"access_token": "mock-token", "id_token": "mock-id-token"})
        if request.url.path == "/oauth2/v3/userinfo":
            return httpx.Response(200, json={"email": "googleuser@example.com", "email_verified": True})
        if request.url.path == "/tokeninfo":
            return httpx.Response(
                200, json={"email": "googleuser@example.com", "email_verified": True, "aud": "test-client-id"}
            )
        return httpx.Response(404)

    mock_transport = httpx.MockTransport(handler)
    google_client = GoogleAuthClient("test-client-id", "test-secret", transport=mock_transport)
    app = create_app(service, google_auth=google_client)
    client = app.test_client()

    # GET /api/auth/google initiates auth and sets state cookie
    start_resp = client.get("/api/auth/google")
    assert start_resp.status_code == 302
    assert "accounts.google.com" in start_resp.headers["Location"]
    assert "state=" in start_resp.headers["Location"]
    cookie_header = start_resp.headers.get("Set-Cookie", "")
    assert "wmbg_oauth_state=" in cookie_header

    match = re.search(r"wmbg_oauth_state=([^;]+)", cookie_header)
    assert match
    state = match.group(1)

    # Callback with missing or invalid state fails
    bad_cb = client.get("/api/auth/google/callback?code=mock-code&state=wrong-state")
    assert bad_cb.status_code == 302
    assert "error=Invalid%20or%20expired%20authentication%20session" in bad_cb.headers["Location"]

    # Callback with valid state succeeds
    good_cb = client.get(f"/api/auth/google/callback?code=mock-code&state={state}")
    assert good_cb.status_code == 302
    assert good_cb.headers["Location"] == "/dashboard"
    cb_cookies = good_cb.headers.get_all("Set-Cookie")
    assert any("wmbg_session=" in c for c in cb_cookies)

    # Calling /api/auth/me with session
    me_resp = client.get("/api/auth/me")
    assert me_resp.status_code == 200
    assert me_resp.json["username"] == "googleuser@example.com"

    # POST /api/auth/google with valid credential from a fresh (unauthenticated) client
    fresh_client = app.test_client()
    post_resp = fresh_client.post("/api/auth/google", json={"credential": "mock-id-token"})
    assert post_resp.status_code == 200
    assert post_resp.json["username"] == "googleuser@example.com"
    assert post_resp.json["csrfToken"]

