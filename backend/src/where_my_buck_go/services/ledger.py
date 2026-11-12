"""Ledger use cases; routes and SQL adapters only transport validated state."""

import hashlib
import hmac
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol
from uuid import uuid4

from where_my_buck_go.domain.ledger import (
    InvalidProposal,
    LedgerFields,
    Operation,
    ProposalRecord,
    TransactionRecord,
    VersionConflict,
    confirmable,
    intake_fields,
)


class NotFound(Exception):
    """Resource does not exist for this owner."""


class IdempotencyConflict(Exception):
    """The key belongs to a different request."""


@dataclass(frozen=True)
class EvidenceRecord:
    id: str
    storage_key: str
    digest: bytes
    kind: str


@dataclass(frozen=True)
class LedgerResult:
    body: dict[str, object]
    status: int


class LedgerSession(Protocol):
    def proposal(self, owner: str, identifier: str, *, lock: bool = False) -> ProposalRecord | None: ...
    def transaction(self, owner: str, identifier: str, *, lock: bool = False) -> TransactionRecord | None: ...
    def revision(self, identifier: str, version: int) -> TransactionRecord | None: ...
    def insert_proposal(self, proposal: ProposalRecord, now: datetime) -> None: ...
    def revise_proposal(self, proposal: ProposalRecord, expected: int) -> None: ...
    def insert_transaction(self, transaction: TransactionRecord, now: datetime) -> None: ...
    def revise_transaction(self, before: TransactionRecord, after: TransactionRecord, now: datetime) -> None: ...
    def insert_evidence(self, owner: str, proposal_id: str, evidence: EvidenceRecord) -> None: ...
    def attach_evidence(self, owner: str, proposal_id: str, transaction_id: str) -> None: ...


class LedgerStore(Protocol):
    def execute(self, owner: str, key: str, fingerprint: bytes,
                operation: Callable[[LedgerSession], LedgerResult]) -> LedgerResult: ...
    def read_proposal(self, owner: str, identifier: str) -> ProposalRecord | None: ...
    def list_proposals(self, owner: str) -> list[ProposalRecord]: ...
    def read_transaction(self, owner: str, identifier: str) -> TransactionRecord | None: ...
    def list_transactions(self, owner: str) -> list[TransactionRecord]: ...
    def read_evidence(self, owner: str, identifier: str) -> EvidenceRecord | None: ...
    def list_evidence(self, owner: str, *, proposal_id: str | None = None,
                      transaction_id: str | None = None) -> list[str]: ...
    def aggregate(self, owner: str, start: date, end: date) -> dict[str, str]: ...
    def monthly_totals(self, owner: str, start: date, end: date) -> list[dict[str, str]]: ...
    def category_totals(self, owner: str, start: date, end: date) -> dict[str, str]: ...


class EvidenceStore(Protocol):
    def put_text(self, content: str) -> EvidenceRecord: ...
    def get_text(self, key: str) -> str: ...
    def put_image(self, raw: bytes, mime: str) -> EvidenceRecord: ...
    def get_binary(self, key: str) -> bytes: ...
    def discard(self, key: str) -> None: ...


def proposal_view(proposal: ProposalRecord) -> dict[str, object]:
    fields = proposal.fields
    return {
        "id": proposal.id, "version": proposal.version, "state": proposal.state,
        "operation": proposal.operation, "targetId": proposal.target_id,
        "baseVersion": proposal.base_version, "resultDeleted": proposal.result_deleted,
        "amount": str(fields.money.amount) if fields.money else None,
        "currency": fields.money.currency if fields.money else "VND",
        "direction": fields.direction, "description": fields.description, "category": fields.category,
        "occurredDate": fields.occurred.occurred_date.isoformat() if fields.occurred.occurred_date else None,
        "occurredTime": fields.occurred.occurred_time.strftime("%H:%M"),
        "period": fields.occurred.period, "timeSource": fields.occurred.source,
        "canConfirm": fields.occurred.can_confirm and fields.money is not None and proposal.state == "draft",
        "confirmedTransactionId": proposal.confirmed_transaction_id,
    }


def transaction_view(transaction: TransactionRecord) -> dict[str, object]:
    fields = transaction.fields
    if fields.money is None:
        raise InvalidProposal("Confirmed transaction must have an amount")
    return {
        "id": transaction.id, "version": transaction.version, "deleted": transaction.deleted,
        "amount": str(fields.money.amount), "currency": fields.money.currency,
        "direction": fields.direction, "description": fields.description, "category": fields.category,
        "occurredDate": fields.occurred.require_local_datetime().date().isoformat(),
        "occurredTime": fields.occurred.occurred_time.strftime("%H:%M"),
        "period": fields.occurred.period, "timeSource": fields.occurred.source,
    }


class LedgerService:
    def __init__(self, store: LedgerStore, evidence: EvidenceStore) -> None:
        self.store = store
        self.evidence = evidence

    @staticmethod
    def _fingerprint(action: str, body: dict[str, object]) -> bytes:
        payload = json.dumps([action, body], sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(payload.encode("utf-8")).digest()

    def execute_with_evidence(
        self, owner: str, key: str, action: str, body: dict[str, object],
        operation: Callable[[LedgerSession, list[str]], LedgerResult],
    ) -> LedgerResult:
        written: list[str] = []
        try:
            return self.store.execute(owner, key, self._fingerprint(action, body),
                                      lambda tx: operation(tx, written))
        except BaseException:
            for storage_key in written:
                self.evidence.discard(storage_key)
            raise

    def create(self, owner: str, key: str, body: dict[str, object], now: datetime) -> LedgerResult:
        def create_in(tx: LedgerSession, written: list[str]) -> LedgerResult:
            return self.create_in_transaction(tx, owner, body, now, written)
        return self.execute_with_evidence(owner, key, "create", body, create_in)

    def create_in_transaction(
        self, tx: LedgerSession, owner: str, body: dict[str, object], now: datetime, written: list[str],
    ) -> LedgerResult:
        fields = self._fields(body, now)
        proposal = ProposalRecord(str(uuid4()), owner, 1, "create", None, None, fields, False, "draft", None)
        evidence = self.evidence.put_text(self._source(body))
        written.append(evidence.storage_key)
        tx.insert_proposal(proposal, now)
        tx.insert_evidence(owner, proposal.id, evidence)
        return LedgerResult({**proposal_view(proposal), "evidenceIds": [evidence.id]}, 201)

    def create_from_image(
        self, owner: str, key: str, fields: LedgerFields, raw: bytes, mime: str, now: datetime,
    ) -> LedgerResult:
        fingerprint_body: dict[str, object] = {
            "imageSha256": hashlib.sha256(raw).hexdigest(), "description": fields.description,
            "amount": str(fields.money.amount) if fields.money else None, "category": fields.category,
        }

        def create_in(tx: LedgerSession, written: list[str]) -> LedgerResult:
            proposal = ProposalRecord(str(uuid4()), owner, 1, "create", None, None, fields, False, "draft", None)
            evidence = self.evidence.put_image(raw, mime)
            written.append(evidence.storage_key)
            tx.insert_proposal(proposal, now)
            tx.insert_evidence(owner, proposal.id, evidence)
            return LedgerResult({**proposal_view(proposal), "evidenceIds": [evidence.id]}, 201)
        return self.execute_with_evidence(owner, key, "create-image", fingerprint_body, create_in)

    def propose_change(self, owner: str, key: str, body: dict[str, object], now: datetime) -> LedgerResult:
        def create_in(tx: LedgerSession, written: list[str]) -> LedgerResult:
            return self.change_in_transaction(tx, owner, body, now, written)
        return self.execute_with_evidence(owner, key, "propose-change", body, create_in)

    def change_in_transaction(
        self, tx: LedgerSession, owner: str, body: dict[str, object], now: datetime, written: list[str],
    ) -> LedgerResult:
        requested = body.get("operation")
        if requested == "edit":
            operation: Operation = "edit"
        elif requested == "delete":
            operation = "delete"
        elif requested == "undo":
            operation = "undo"
        else:
            raise InvalidProposal("Operation must be edit, delete or undo")
        target_id = body["targetId"]
        if not isinstance(target_id, str):
            raise InvalidProposal("Target ID is required")
        target = tx.transaction(owner, target_id, lock=True)
        if target is None:
            raise NotFound
        if target.version != body["expectedVersion"]:
            raise VersionConflict("Transaction changed since preview")
        proposal = self._change_proposal(tx, target, operation, body, now)
        evidence = self.evidence.put_text(self._source(body))
        written.append(evidence.storage_key)
        tx.insert_proposal(proposal, now)
        tx.insert_evidence(owner, proposal.id, evidence)
        return LedgerResult({**proposal_view(proposal), "evidenceIds": [evidence.id]}, 201)

    def amend(self, owner: str, key: str, identifier: str, body: dict[str, object], now: datetime) -> LedgerResult:
        def amend_in(tx: LedgerSession, written: list[str]) -> LedgerResult:
            proposal = tx.proposal(owner, identifier, lock=True)
            if proposal is None:
                raise NotFound
            if proposal.state != "draft" or proposal.version != body["expectedVersion"]:
                raise VersionConflict("Draft changed since preview")
            if proposal.operation not in ("create", "edit"):
                raise InvalidProposal("Only create and edit drafts can change their fields")
            updated = ProposalRecord(proposal.id, owner, proposal.version + 1, proposal.operation,
                                     proposal.target_id, proposal.base_version, self._fields(body, now),
                                     False, "draft", None)
            evidence = self.evidence.put_text(self._source(body))
            written.append(evidence.storage_key)
            tx.revise_proposal(updated, proposal.version)
            tx.insert_evidence(owner, proposal.id, evidence)
            return LedgerResult({**proposal_view(updated), "evidenceIds": [evidence.id]}, 200)
        return self.execute_with_evidence(owner, key, f"amend:{identifier}", body, amend_in)

    def confirm(self, owner: str, key: str, identifier: str, expected: int, now: datetime) -> LedgerResult:
        body: dict[str, object] = {"expectedVersion": expected}

        def confirm_in(tx: LedgerSession, written: list[str]) -> LedgerResult:
            proposal = tx.proposal(owner, identifier, lock=True)
            if proposal is None:
                raise NotFound
            if proposal.version != expected:
                raise VersionConflict("Draft changed since preview")
            target = tx.transaction(owner, proposal.target_id, lock=True) if proposal.target_id else None
            confirmable(proposal, target)
            if target is None:
                result = TransactionRecord(str(uuid4()), owner, 1, proposal.fields, False)
                tx.insert_transaction(result, now)
            else:
                result = TransactionRecord(target.id, owner, target.version + 1,
                                           proposal.fields, proposal.result_deleted)
                tx.revise_transaction(target, result, now)
            updated = ProposalRecord(proposal.id, owner, proposal.version + 1, proposal.operation,
                                     proposal.target_id, proposal.base_version, proposal.fields,
                                     proposal.result_deleted, "confirmed", result.id)
            tx.revise_proposal(updated, proposal.version)
            tx.attach_evidence(owner, proposal.id, result.id)
            return LedgerResult({"proposal": proposal_view(updated), "transaction": transaction_view(result)}, 200)
        return self.execute_with_evidence(owner, key, f"confirm:{identifier}", body, confirm_in)

    def read_evidence(self, owner: str, identifier: str) -> tuple[str, bytes]:
        evidence = self.store.read_evidence(owner, identifier)
        if evidence is None:
            raise NotFound
        if evidence.kind == "text":
            content = self.evidence.get_text(evidence.storage_key).encode("utf-8")
        else:
            content = self.evidence.get_binary(evidence.storage_key)
        if not hmac.compare_digest(hashlib.sha256(content).digest(), evidence.digest):
            raise InvalidProposal("Evidence integrity check failed")
        return evidence.kind, content

    def proposal_details(self, owner: str, identifier: str) -> dict[str, object]:
        proposal = self.store.read_proposal(owner, identifier)
        if proposal is None:
            raise NotFound
        return {**proposal_view(proposal), "evidenceIds": self.store.list_evidence(owner, proposal_id=identifier)}

    def open_proposals(self, owner: str) -> list[dict[str, object]]:
        return [{**proposal_view(item), "evidenceIds": self.store.list_evidence(owner, proposal_id=item.id)}
                for item in self.store.list_proposals(owner)]

    def summary(self, owner: str, start: date, end: date) -> dict[str, object]:
        totals = self.store.aggregate(owner, start, end)
        return {"start": start.isoformat(), "end": end.isoformat(), "totals": totals,
                "months": self.store.monthly_totals(owner, start, end),
                "categories": self.store.category_totals(owner, start, end)}

    def transaction_details(self, owner: str, identifier: str) -> dict[str, object]:
        transaction = self.store.read_transaction(owner, identifier)
        if transaction is None:
            raise NotFound
        return {**transaction_view(transaction),
                "evidenceIds": self.store.list_evidence(owner, transaction_id=identifier)}

    @staticmethod
    def _source(body: dict[str, object]) -> str:
        text = body.get("evidenceText")
        if not isinstance(text, str) or not 1 <= len(text.encode("utf-8")) <= 10_000:
            raise InvalidProposal("Original text evidence is required (up to 10 KB)")
        return text

    @staticmethod
    def _fields(body: dict[str, object], now: datetime) -> LedgerFields:
        currency, direction, description, category = (body.get("currency", "VND"), body.get("direction"),
                                                        body.get("description"), body.get("category"))
        if (not isinstance(currency, str) or not isinstance(direction, str) or
                not isinstance(description, str) or not isinstance(category, str)):
            raise InvalidProposal("Currency, direction, description and category must be text")
        return intake_fields(body.get("amount"), currency, direction, description, category,
                             LedgerService._optional_text(body.get("occurredDate")),
                             LedgerService._optional_text(body.get("period")),
                             LedgerService._optional_text(body.get("occurredTime")), now)

    @staticmethod
    def _optional_text(value: object) -> str | None:
        if value is None or isinstance(value, str):
            return value
        raise InvalidProposal("Date, period and time must be text or null")

    def _change_proposal(
        self, tx: LedgerSession, target: TransactionRecord, operation: Operation,
        body: dict[str, object], now: datetime,
    ) -> ProposalRecord:
        if operation in ("edit", "delete") and target.deleted:
            raise VersionConflict("Transaction is deleted")
        if operation == "edit":
            fields = self._fields(body, now)
            deleted = False
        elif operation == "delete":
            fields, deleted = target.fields, True
        else:
            previous = tx.revision(target.id, target.version - 1) if target.version > 1 else None
            if target.version > 1 and previous is None:
                raise VersionConflict("Previous revision is missing")
            fields = previous.fields if previous else target.fields
            deleted = previous.deleted if previous else True
        return ProposalRecord(str(uuid4()), target.owner_id, 1, operation, target.id, target.version,
                              fields, deleted, "draft", None)
