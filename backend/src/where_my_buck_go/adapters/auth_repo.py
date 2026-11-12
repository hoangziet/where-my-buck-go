"""PostgreSQL auth repository. No HTTP or credential policy in this module."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.engine import Engine

from where_my_buck_go.adapters.db import login_attempts, sessions, users
from where_my_buck_go.domain.auth import LOGIN_LIMIT, LOGIN_WINDOW
from where_my_buck_go.services.auth import AuthStore, SessionRecord, UserRecord


class PostgresAuthStore(AuthStore):
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def find_user(self, username: str) -> UserRecord | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(users).where(users.c.username == username)).mappings().first()
        return UserRecord(row["id"], row["username"], row["password_hash"]) if row else None

    def create_owner(self, username: str, password_hash: str, now: datetime) -> bool:
        with self.engine.begin() as conn:
            conn.exec_driver_sql("SELECT pg_advisory_xact_lock(8110337)")
            if conn.execute(select(func.count()).select_from(users)).scalar_one() != 0:
                return False
            conn.execute(insert(users).values(id=str(uuid4()), username=username, password_hash=password_hash,
                                              created_at=now))
        return True

    def reset_password(self, username: str, password_hash: str, now: datetime) -> bool:
        with self.engine.begin() as conn:
            user_id = conn.execute(select(users.c.id).where(users.c.username == username)).scalar_one_or_none()
            if user_id is None:
                return False
            conn.execute(update(users).where(users.c.id == user_id).values(password_hash=password_hash))
            conn.execute(update(sessions).where(sessions.c.user_id == user_id,
                                                sessions.c.revoked_at.is_(None)).values(revoked_at=now))
        return True

    def reserve_login(self, digest: bytes, now: datetime) -> bool:
        with self.engine.begin() as conn:
            conn.exec_driver_sql("SELECT pg_advisory_xact_lock(%s)", (int.from_bytes(digest[:8], "big", signed=True),))
            since = now - LOGIN_WINDOW
            count = conn.execute(select(func.count()).select_from(login_attempts).where(
                login_attempts.c.address_digest == digest, login_attempts.c.attempted_at >= since,
            )).scalar_one()
            if count >= LOGIN_LIMIT:
                return False
            conn.execute(insert(login_attempts).values(id=str(uuid4()), address_digest=digest, attempted_at=now))
            conn.execute(delete(login_attempts).where(login_attempts.c.attempted_at < since))
        return True

    def create_session(self, user_id: str, token_digest: bytes, csrf_digest: bytes, expiry: datetime) -> None:
        with self.engine.begin() as conn:
            conn.execute(insert(sessions).values(id=str(uuid4()), user_id=user_id, token_digest=token_digest,
                                                 csrf_digest=csrf_digest, expires_at=expiry))

    def find_session(self, token_digest: bytes, now: datetime) -> SessionRecord | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(sessions.c.user_id, sessions.c.csrf_digest, sessions.c.expires_at,
                                      users.c.username).join(users).where(
                sessions.c.token_digest == token_digest, sessions.c.revoked_at.is_(None),
                sessions.c.expires_at > now,
            )).mappings().first()
        return SessionRecord(row["user_id"], row["username"], row["csrf_digest"], row["expires_at"]) if row else None

    def revoke_session(self, token_digest: bytes, now: datetime) -> None:
        with self.engine.begin() as conn:
            conn.execute(update(sessions).where(sessions.c.token_digest == token_digest,
                                                 sessions.c.revoked_at.is_(None)).values(revoked_at=now))
