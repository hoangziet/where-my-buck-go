"""Session and login policies, independent of HTTP and persistence."""

from datetime import datetime, timedelta, timezone

SESSION_LIFETIME = timedelta(hours=12)
LOGIN_WINDOW = timedelta(minutes=15)
LOGIN_LIMIT = 10


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def session_expiry(now: datetime) -> datetime:
    return now + SESSION_LIFETIME


def login_window_start(now: datetime) -> datetime:
    return now - LOGIN_WINDOW
