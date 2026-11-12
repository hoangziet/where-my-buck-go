"""Exact, positive VND transaction amounts; input is never converted from float."""

import re
from dataclasses import dataclass
from decimal import Decimal


class InvalidMoney(ValueError):
    """A value cannot represent a supported transaction amount."""


@dataclass(frozen=True)
class Money:
    amount: Decimal
    currency: str = "VND"

    def __post_init__(self) -> None:
        if self.currency != "VND":
            raise InvalidMoney("Only VND is supported in v1")
        if not isinstance(self.amount, Decimal) or not self.amount.is_finite():
            raise InvalidMoney("Amount must be an exact Decimal")
        if self.amount <= 0 or self.amount != self.amount.to_integral_value():
            raise InvalidMoney("Amount must be a positive whole number of VND; no rounding is applied")
        if self.amount >= Decimal("1000000000000000000"):
            raise InvalidMoney("Amount is too large")

    @classmethod
    def parse(cls, raw: object, currency: str = "VND") -> "Money":
        """Accept canonical digits or exact Decimal, never float or formatted strings."""
        if isinstance(raw, str) and re.fullmatch(r"(?:0|[1-9][0-9]{0,17})", raw):
            return cls(Decimal(raw), currency)
        if isinstance(raw, Decimal):
            return cls(raw, currency)
        raise InvalidMoney("Use canonical VND digits or Decimal, not float or formatted text")
