"""Preview and confirmation rules; independent of persistence, HTTP and AI."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from where_my_buck_go.domain.money import Money
from where_my_buck_go.domain.transaction_time import TransactionTime, resolve_transaction_time

Direction = Literal["income", "expense"]
Operation = Literal["create", "edit", "delete", "undo"]
Category = Literal["food_drink", "transport", "bills", "shopping", "entertainment", "housing", "income", "other"]
CATEGORIES: tuple[Category, ...] = (
    "food_drink", "transport", "bills", "shopping", "entertainment", "housing", "income", "other",
)


class InvalidProposal(ValueError):
    """A preview cannot be created or confirmed with these details."""


class VersionConflict(Exception):
    """A proposal or its target has changed since the preview."""


@dataclass(frozen=True)
class LedgerFields:
    money: Money | None
    direction: Direction
    description: str
    occurred: TransactionTime
    category: Category

    def __post_init__(self) -> None:
        if self.direction not in ("income", "expense"):
            raise InvalidProposal("Direction must be income or expense")
        if not isinstance(self.description, str) or not 1 <= len(self.description.strip()) <= 200:
            raise InvalidProposal("Description must be 1-200 characters")
        if self.category not in CATEGORIES:
            raise InvalidProposal("Category must be one of " + ", ".join(CATEGORIES))


@dataclass(frozen=True)
class TransactionRecord:
    id: str
    owner_id: str
    version: int
    fields: LedgerFields
    deleted: bool


@dataclass(frozen=True)
class ProposalRecord:
    id: str
    owner_id: str
    version: int
    operation: Operation
    target_id: str | None
    base_version: int | None
    fields: LedgerFields
    result_deleted: bool
    state: str
    confirmed_transaction_id: str | None


def intake_fields(
    amount: object, currency: str, direction: str, description: str, category: str,
    date_text: str | None, period: str | None, time_text: str | None, received_at: datetime,
) -> LedgerFields:
    if direction not in ("income", "expense"):
        raise InvalidProposal("Direction must be income or expense")
    if direction == "income":
        selected: Direction = "income"
    else:
        selected = "expense"
    if category not in CATEGORIES:
        raise InvalidProposal("Category must be one of " + ", ".join(CATEGORIES))
    money = None if amount is None or amount == "" else Money.parse(amount, currency)
    return LedgerFields(money, selected, description,
                        resolve_transaction_time(date_text, period, time_text, received_at), category)


def confirmable(proposal: ProposalRecord, target: TransactionRecord | None) -> None:
    if proposal.state != "draft":
        raise VersionConflict("Proposal was already confirmed")
    if not proposal.fields.occurred.can_confirm or proposal.fields.money is None:
        raise InvalidProposal("Date or amount is missing; complete the draft before confirmation")
    if proposal.operation == "create":
        if proposal.target_id is not None or target is not None:
            raise InvalidProposal("Create must not target an existing transaction")
        return
    if target is None or target.id != proposal.target_id or target.version != proposal.base_version:
        raise VersionConflict("Transaction changed since preview")
    if proposal.operation in ("edit", "delete") and target.deleted:
        raise VersionConflict("Cannot edit or delete an already deleted transaction")


def discardable(proposal: ProposalRecord) -> None:
    if proposal.state != "draft":
        raise VersionConflict("Proposal is no longer open")
