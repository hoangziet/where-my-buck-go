"""Captured ingress time anchors relative dates but never fills missing dates."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from where_my_buck_go.domain.transaction_time import (
    InvalidTransactionTime,
    TransactionTime,
    period_for,
    resolve_transaction_time,
)

ANCHOR = datetime(2026, 11, 8, 18, 45, tzinfo=timezone.utc)  # 09 Nov, 01:45 in Ho Chi Minh City.


@pytest.mark.parametrize("clock,expected", [
    ("04:59", "tối"), ("05:00", "sáng"), ("10:59", "sáng"),
    ("11:00", "trưa"), ("13:59", "trưa"), ("14:00", "chiều"),
    ("17:59", "chiều"), ("18:00", "tối"), ("23:59", "tối"),
])
def test_period_boundaries(clock: str, expected: str) -> None:
    assert period_for(time.fromisoformat(clock)) == expected


@pytest.mark.parametrize("period,expected_clock", [
    (None, "07:00"), ("sáng", "07:00"), ("trưa", "11:00"),
    ("chiều", "15:00"), ("tối", "20:00"),
])
def test_defaults_are_marked_in_preview(period: str | None, expected_clock: str) -> None:
    result = resolve_transaction_time("09/11/2026", period, None, ANCHOR)
    assert result.occurred_time.strftime("%H:%M") == expected_clock
    assert result.source == "default"
    assert result.can_confirm
    assert result.require_local_datetime().tzinfo == ZoneInfo("Asia/Ho_Chi_Minh")


def test_explicit_clock_preserved_and_period_inferred() -> None:
    result = resolve_transaction_time("2026-11-09", None, "18:36", ANCHOR)
    assert result.source == "explicit"
    assert result.period == "tối"
    assert result.require_local_datetime().isoformat() == "2026-11-09T18:36:00+07:00"


def test_missing_date_stays_draft_even_with_default_clock() -> None:
    result = resolve_transaction_time(None, "sáng", None, ANCHOR)
    assert result.occurred_date is None
    assert result.occurred_time == time(7, 0)
    assert not result.can_confirm
    with pytest.raises(InvalidTransactionTime, match="date is required"):
        result.require_local_datetime()


def test_relative_dates_use_original_anchor_not_worker_time() -> None:
    assert resolve_transaction_time("hôm nay", None, None, ANCHOR).occurred_date == date(2026, 11, 9)
    assert resolve_transaction_time("hôm qua", None, None, ANCHOR).occurred_date == date(2026, 11, 8)
    assert resolve_transaction_time("yesterday", None, None, ANCHOR).occurred_date == date(2026, 11, 8)
    year_boundary = datetime(2026, 12, 31, 18, 0, tzinfo=timezone.utc)
    assert resolve_transaction_time("hôm nay", None, None, year_boundary).occurred_date == date(2027, 1, 1)


@pytest.mark.parametrize("date_text,period,clock", [
    ("2026-02-30", None, None), ("09/13/2026", None, None), ("tối qua", None, None),
    ("2026-11-09", "sáng", "20:00"), ("2026-11-09", "đêm", None),
    ("2026-11-09", None, "24:00"), ("2026-11-09", None, "18:30:00"),
])
def test_invalid_or_conflicting_time_asks_for_correction(
    date_text: str, period: str | None, clock: str | None,
) -> None:
    with pytest.raises(InvalidTransactionTime):
        resolve_transaction_time(date_text, period, clock, ANCHOR)


def test_naive_anchor_and_timezone_clock_are_rejected() -> None:
    with pytest.raises(InvalidTransactionTime):
        resolve_transaction_time("hôm nay", None, None, datetime(2026, 11, 9))
    with pytest.raises(InvalidTransactionTime):
        period_for(time(18, tzinfo=timezone(timedelta(hours=7))))


def test_constructor_cannot_bypass_invariants() -> None:
    with pytest.raises(InvalidTransactionTime):
        TransactionTime(date(2026, 11, 9), time(20), "sáng", "explicit")
    with pytest.raises(InvalidTransactionTime):
        TransactionTime(date(2026, 11, 9), time(8), "sáng", "default")
