"""VND is exact and never rounded or constructed from float input."""

from decimal import Decimal

import pytest

from where_my_buck_go.domain.money import InvalidMoney, Money


def test_exact_vnd_and_currency() -> None:
    money = Money.parse("17500")
    assert money.amount == Decimal("17500")
    assert money.currency == "VND"
    assert Money.parse(Decimal("50000")).amount == Decimal("50000")


@pytest.mark.parametrize("raw", [
    17_500.0, 17_500, "17.500", "17,500", "17.5", "1e3", "0010", "0", "-100", "",
    Decimal("17.5"), Decimal("NaN"), Decimal("Infinity"),
])
def test_rejects_ambiguous_or_inexact_values(raw: object) -> None:
    with pytest.raises(InvalidMoney):
        Money.parse(raw)


def test_no_other_currency_or_hidden_rounding() -> None:
    with pytest.raises(InvalidMoney, match="Only VND"):
        Money.parse("17500", "USD")
    with pytest.raises(InvalidMoney, match="no rounding"):
        Money.parse(Decimal("17500.01"))


def test_constructor_guards_against_float_bypass() -> None:
    with pytest.raises(InvalidMoney):
        Money(17_500.0)  # type: ignore[arg-type]
