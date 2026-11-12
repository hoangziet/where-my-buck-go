"""Deterministic local transaction time rules; never fill missing dates from an upload timestamp."""

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

Period = Literal["sáng", "trưa", "chiều", "tối"]
TimeSource = Literal["explicit", "default"]
LOCAL_ZONE = ZoneInfo("Asia/Ho_Chi_Minh")
_DEFAULT_HOURS: dict[Period, int] = {"sáng": 7, "trưa": 11, "chiều": 15, "tối": 20}


class InvalidTransactionTime(ValueError):
    """An explicit date, time or period is invalid or contradictory."""


def period_for(clock: time) -> Period:
    if clock.tzinfo is not None:
        raise InvalidTransactionTime("Transaction clock must not contain a timezone")
    if 5 <= clock.hour < 11:
        return "sáng"
    if 11 <= clock.hour < 14:
        return "trưa"
    if 14 <= clock.hour < 18:
        return "chiều"
    return "tối"


def parse_period(value: str | None) -> Period | None:
    if value is None:
        return None
    if value == "sáng":
        return "sáng"
    if value == "trưa":
        return "trưa"
    if value == "chiều":
        return "chiều"
    if value == "tối":
        return "tối"
    raise InvalidTransactionTime("Unknown period")


def parse_clock(value: str) -> time:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{2}:[0-9]{2}", value):
        raise InvalidTransactionTime("Clock must use 24-hour HH:MM")
    hour, minute = (int(part) for part in value.split(":"))
    if hour >= 24 or minute >= 60:
        raise InvalidTransactionTime("Clock is out of range")
    return time(hour, minute)


def parse_transaction_date(value: str | None, received_at: datetime) -> date | None:
    """Resolve relative words only against the captured ingress instant, never worker time."""
    if received_at.tzinfo is None or received_at.utcoffset() is None:
        raise InvalidTransactionTime("Ingress instant must be timezone-aware")
    if value is not None and not isinstance(value, str):
        raise InvalidTransactionTime("Date must be text")
    if value is None or value == "":
        return None
    normalized = value.strip().casefold()
    today = received_at.astimezone(LOCAL_ZONE).date()
    if normalized in ("hôm nay", "today"):
        return today
    if normalized in ("hôm qua", "yesterday"):
        return today - timedelta(days=1)
    try:
        if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            return date.fromisoformat(value)
        if re.fullmatch(r"[0-9]{2}/[0-9]{2}/[0-9]{4}", value):
            day, month, year = (int(part) for part in value.split("/"))
            return date(year, month, day)
    except ValueError:
        pass
    raise InvalidTransactionTime("Date must be explicit, 'hôm nay', or 'hôm qua'")


@dataclass(frozen=True)
class TransactionTime:
    occurred_date: date | None
    occurred_time: time
    period: Period
    source: TimeSource

    def __post_init__(self) -> None:
        if self.occurred_date is not None and not isinstance(self.occurred_date, date):
            raise InvalidTransactionTime("Date must be valid")
        if not isinstance(self.occurred_time, time) or period_for(self.occurred_time) != self.period:
            raise InvalidTransactionTime("Clock and period must agree")
        if self.source not in ("explicit", "default"):
            raise InvalidTransactionTime("Unknown clock source")
        if self.source == "default" and self.occurred_time != time(_DEFAULT_HOURS[self.period]):
            raise InvalidTransactionTime("Default clock must match its period")

    @property
    def can_confirm(self) -> bool:
        return self.occurred_date is not None

    def require_local_datetime(self) -> datetime:
        if self.occurred_date is None:
            raise InvalidTransactionTime("A date is required before confirming")
        return datetime.combine(self.occurred_date, self.occurred_time, LOCAL_ZONE)


def resolve_transaction_time(
    date_text: str | None, period: str | None, time_text: str | None, received_at: datetime,
) -> TransactionTime:
    """Return a draft-ready time and provenance; never infer a missing date."""
    occurred_date = parse_transaction_date(date_text, received_at)
    if occurred_date is not None and occurred_date > received_at.astimezone(LOCAL_ZONE).date():
        raise InvalidTransactionTime("Transaction date must not be in the future")
    stated_period = parse_period(period)
    if time_text is not None and time_text != "":
        clock = parse_clock(time_text)
        inferred = period_for(clock)
        if stated_period is not None and stated_period != inferred:
            raise InvalidTransactionTime("Explicit clock conflicts with the stated period; ask the owner")
        return TransactionTime(occurred_date, clock, inferred, "explicit")
    selected: Period = stated_period or "sáng"
    return TransactionTime(occurred_date, time(_DEFAULT_HOURS[selected]), selected, "default")
