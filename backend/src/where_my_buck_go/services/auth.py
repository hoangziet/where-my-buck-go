"""Authentication use cases and storage contract."""

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from argon2 import PasswordHasher, Type
from argon2.exceptions import VerifyMismatchError

from where_my_buck_go.domain.auth import session_expiry, utc_now


@dataclass(frozen=True)
class UserRecord:
    id: str
    username: str
    password_hash: str


@dataclass(frozen=True)
class SessionRecord:
    user_id: str
    username: str
    csrf_digest: bytes
    expires_at: datetime


class AuthStore(Protocol):
    def find_user(self, username: str) -> UserRecord | None: ...
    def create_owner(self, username: str, password_hash: str, now: datetime) -> bool: ...
    def reset_password(self, username: str, password_hash: str, now: datetime) -> bool: ...
    def reserve_login(self, digest: bytes, now: datetime) -> bool: ...
    def create_session(self, user_id: str, token_digest: bytes, csrf_digest: bytes, expiry: datetime) -> None: ...
    def find_session(self, token_digest: bytes, now: datetime) -> SessionRecord | None: ...
    def revoke_session(self, token_digest: bytes, now: datetime) -> None: ...


def digest_secret(value: str) -> bytes:
    return hashlib.sha256(value.encode("utf-8")).digest()


@dataclass(frozen=True)
class LoginResult:
    token: str
    csrf: str
    username: str


class AuthService:
    def __init__(self, store: AuthStore, hmac_key: bytes) -> None:
        if len(hmac_key) < 32:
            raise ValueError("AUTH_HMAC_KEY must contain at least 32 bytes")
        self.store = store
        self.hmac_key = hmac_key
        self.hasher = PasswordHasher(type=Type.ID)
        self.dummy_hash = self.hasher.hash("dummy password for unknown usernames")

    def bootstrap(self, username: str, password: str) -> bool:
        if not 3 <= len(username) <= 128 or len(password) < 12:
            raise ValueError("Username must be 3-128 characters and password at least 12 characters")
        return self.store.create_owner(username, self.hasher.hash(password), utc_now())

    def reset_password(self, username: str, password: str) -> bool:
        if len(password) < 12:
            raise ValueError("Password must be at least 12 characters")
        return self.store.reset_password(username, self.hasher.hash(password), utc_now())

    def login(self, username: str, password: str, address: str) -> LoginResult | None:
        now = utc_now()
        address_digest = hmac.digest(self.hmac_key, address.encode("utf-8"), "sha256")
        if not self.store.reserve_login(address_digest, now):
            raise LoginLimitedError
        user = self.store.find_user(username)
        try:
            self.hasher.verify(user.password_hash if user else self.dummy_hash, password)
        except VerifyMismatchError:
            return None
        if user is None:
            return None
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        self.store.create_session(user.id, digest_secret(token), digest_secret(csrf), session_expiry(now))
        return LoginResult(token, csrf, user.username)

    def session(self, token: str) -> SessionRecord | None:
        if not token or len(token) > 128:
            return None
        return self.store.find_session(digest_secret(token), utc_now())

    def check_csrf(self, session: SessionRecord, csrf: str) -> bool:
        return bool(csrf) and hmac.compare_digest(session.csrf_digest, digest_secret(csrf))

    def logout(self, token: str) -> None:
        self.store.revoke_session(digest_secret(token), utc_now())


class LoginLimitedError(Exception):
    """Login address has exceeded its rolling window."""
