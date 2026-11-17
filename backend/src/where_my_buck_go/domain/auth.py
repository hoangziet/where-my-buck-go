"""Session and login policies, independent of HTTP and persistence."""

from datetime import datetime, timedelta, timezone

# Sessions slide: each use pushes expiry out to a full lifetime again, so an owner who opens the
# app at least once a month stays signed in. Renewal is throttled to limit database writes.
SESSION_LIFETIME = timedelta(days=30)
SESSION_RENEW_INTERVAL = timedelta(days=1)
LOGIN_WINDOW = timedelta(minutes=15)
LOGIN_LIMIT = 10


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def session_expiry(now: datetime) -> datetime:
    return now + SESSION_LIFETIME


def session_needs_renewal(expires_at: datetime, now: datetime) -> bool:
    return expires_at - now < SESSION_LIFETIME - SESSION_RENEW_INTERVAL


def login_window_start(now: datetime) -> datetime:
    return now - LOGIN_WINDOW
