"""Validate untrusted image extraction before displaying a read-only proposal."""

import re
from dataclasses import dataclass
from datetime import date, time
from decimal import Decimal

from where_my_buck_go.domain.ledger import CATEGORIES, Category
from where_my_buck_go.domain.money import InvalidMoney, Money
from where_my_buck_go.domain.transaction_time import Period, parse_clock, period_for


class InvalidImagePreview(ValueError):
    """The model did not provide a complete and consistent receipt preview."""


@dataclass(frozen=True)
class ImagePreview:
    amount: Decimal
    occurred_date: date
    occurred_time: time
    description: str
    category: Category

    @property
    def period(self) -> Period:
        return period_for(self.occurred_time)


def validate_image_preview(args: dict[str, object]) -> ImagePreview:
    """Accept only successful VND expenses with an explicit date and payment time."""
    expected = {"amount", "currency", "occurred_date", "occurred_time", "description", "status", "direction",
                "category"}
    if set(args) != expected or args["currency"] != "VND" or args["status"] != "success":
        raise InvalidImagePreview("Image must contain one successful VND payment")
    if args["direction"] != "expense":
        raise InvalidImagePreview("Payment direction is not an expense")
    if args["category"] not in CATEGORIES:
        raise InvalidImagePreview("Category must be one of " + ", ".join(CATEGORIES))
    category: Category = args["category"]
    amount, day, clock, description = (args[key] for key in
                                       ("amount", "occurred_date", "occurred_time", "description"))
    try:
        money = Money.parse(amount, "VND")
    except InvalidMoney:
        raise InvalidImagePreview("Amount must be an explicit positive integer VND amount") from None
    if not isinstance(day, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise InvalidImagePreview("Payment date is missing or invalid")
    if not isinstance(clock, str) or not re.fullmatch(r"\d{2}:\d{2}", clock):
        raise InvalidImagePreview("Payment time is missing or invalid")
    if (not isinstance(description, str) or not description.strip() or len(description) > 120 or
            re.search(r"\d{8,}", description)):
        raise InvalidImagePreview("Description is invalid or includes private identifiers")
    try:
        return ImagePreview(money.amount, date.fromisoformat(day), parse_clock(clock), description.strip(),
                            category)
    except ValueError:
        raise InvalidImagePreview("Payment date or time is invalid") from None
