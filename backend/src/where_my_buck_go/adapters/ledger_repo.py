"""PostgreSQL ledger unit of work: row locks, idempotency and owner-scoped reads."""

import hashlib
from collections.abc import Callable, Sequence
from datetime import date, datetime
from typing import cast
from uuid import uuid4

from sqlalchemy import func, insert, select, update
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.engine.row import RowMapping

from where_my_buck_go.adapters.db import evidence, idempotency, proposals, transaction_revisions, transactions
from where_my_buck_go.domain.ledger import LedgerFields, ProposalRecord, TransactionRecord, VersionConflict
from where_my_buck_go.domain.money import Money
from where_my_buck_go.domain.transaction_time import TransactionTime
from where_my_buck_go.services.ledger import (
    EvidenceRecord,
    IdempotencyConflict,
    LedgerResult,
    LedgerSession,
    LedgerStore,
)


def _fields(row: RowMapping) -> LedgerFields:
    amount = Money(row["amount"], row["currency"]) if row["amount"] is not None else None
    return LedgerFields(amount, row["direction"], row["description"],
                        TransactionTime(row["occurred_date"], row["occurred_time"], row["period"],
                                        row["time_source"]), row["category"])


def _values(fields: LedgerFields) -> dict[str, object]:
    occurred = fields.occurred
    return {
        "amount": fields.money.amount if fields.money else None,
        "currency": fields.money.currency if fields.money else "VND",
        "direction": fields.direction, "description": fields.description, "category": fields.category,
        "occurred_date": occurred.occurred_date, "occurred_time": occurred.occurred_time,
        "period": occurred.period, "time_source": occurred.source,
    }


def _transaction(row: RowMapping) -> TransactionRecord:
    return TransactionRecord(row["id"], row["owner_id"], row["version"],
                             _fields(row), row["deleted_at"] is not None)


def _proposal(row: RowMapping) -> ProposalRecord:
    return ProposalRecord(row["id"], row["owner_id"], row["version"], row["operation"],
                          row["target_id"], row["base_version"], _fields(row), row["result_deleted"],
                          row["state"], row["confirmed_transaction_id"])


class PostgresLedgerSession(LedgerSession):
    def __init__(self, conn: Connection) -> None:
        self.conn = conn

    def proposal(self, owner: str, identifier: str, *, lock: bool = False) -> ProposalRecord | None:
        statement = select(proposals).where(proposals.c.id == identifier, proposals.c.owner_id == owner)
        if lock:
            statement = statement.with_for_update()
        row = self.conn.execute(statement).mappings().first()
        return _proposal(row) if row else None

    def transaction(self, owner: str, identifier: str, *, lock: bool = False) -> TransactionRecord | None:
        statement = select(transactions).where(transactions.c.id == identifier, transactions.c.owner_id == owner)
        if lock:
            statement = statement.with_for_update()
        row = self.conn.execute(statement).mappings().first()
        return _transaction(row) if row else None

    def revision(self, identifier: str, version: int) -> TransactionRecord | None:
        row = self.conn.execute(select(transaction_revisions).where(
            transaction_revisions.c.transaction_id == identifier,
            transaction_revisions.c.version == version,
        )).mappings().first()
        return TransactionRecord(identifier, "", version, _fields(row), row["deleted_at"] is not None) if row else None

    def insert_proposal(self, proposal: ProposalRecord, now: datetime) -> None:
        self.conn.execute(insert(proposals).values(
            id=proposal.id, owner_id=proposal.owner_id, operation=proposal.operation,
            target_id=proposal.target_id, base_version=proposal.base_version,
            version=proposal.version, state=proposal.state, result_deleted=proposal.result_deleted,
            confirmed_transaction_id=proposal.confirmed_transaction_id, created_at=now,
            **_values(proposal.fields),
        ))

    def revise_proposal(self, proposal: ProposalRecord, expected: int) -> None:
        result = self.conn.execute(update(proposals).where(
            proposals.c.id == proposal.id, proposals.c.owner_id == proposal.owner_id,
            proposals.c.version == expected,
        ).values(version=proposal.version, state=proposal.state, result_deleted=proposal.result_deleted,
                 confirmed_transaction_id=proposal.confirmed_transaction_id, **_values(proposal.fields)))
        if result.rowcount != 1:
            raise VersionConflict("Proposal changed during the write")

    def insert_transaction(self, transaction: TransactionRecord, now: datetime) -> None:
        self.conn.execute(insert(transactions).values(
            id=transaction.id, owner_id=transaction.owner_id, version=transaction.version,
            deleted_at=now if transaction.deleted else None, created_at=now, **_values(transaction.fields),
        ))

    def revise_transaction(self, before: TransactionRecord, after: TransactionRecord, now: datetime) -> None:
        self.conn.execute(insert(transaction_revisions).values(
            transaction_id=before.id, version=before.version,
            deleted_at=now if before.deleted else None, **_values(before.fields),
        ))
        result = self.conn.execute(update(transactions).where(
            transactions.c.id == before.id, transactions.c.owner_id == before.owner_id,
            transactions.c.version == before.version,
        ).values(version=after.version, deleted_at=now if after.deleted else None, **_values(after.fields)))
        if result.rowcount != 1:
            raise VersionConflict("Transaction changed during the write")

    def insert_evidence(self, owner: str, proposal_id: str, reference: EvidenceRecord) -> None:
        self.conn.execute(insert(evidence).values(
            id=reference.id, owner_id=owner, proposal_id=proposal_id, transaction_id=None,
            storage_key=reference.storage_key, sha256_digest=reference.digest, kind=reference.kind,
        ))

    def attach_evidence(self, owner: str, proposal_id: str, transaction_id: str) -> None:
        self.conn.execute(update(evidence).where(
            evidence.c.owner_id == owner, evidence.c.proposal_id == proposal_id,
        ).values(transaction_id=transaction_id))


class PostgresLedgerStore(LedgerStore):
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def execute(self, owner: str, key: str, fingerprint: bytes,
                operation: Callable[[LedgerSession], LedgerResult]) -> LedgerResult:
        with self.engine.begin() as conn:
            lock = int.from_bytes(hashlib.sha256((owner + key).encode()).digest()[:8], "big", signed=True)
            conn.exec_driver_sql("SELECT pg_advisory_xact_lock(%s)", (lock,))
            row = conn.execute(select(idempotency).where(
                idempotency.c.owner_id == owner, idempotency.c.key == key,
            )).mappings().first()
            if row:
                if row["fingerprint"] != fingerprint:
                    raise IdempotencyConflict("Idempotency key already belongs to a different request")
                saved = row["result"]
                return LedgerResult(saved["body"], saved["status"])
            result: LedgerResult = operation(PostgresLedgerSession(conn))
            conn.execute(insert(idempotency).values(
                id=str(uuid4()), owner_id=owner, key=key, fingerprint=fingerprint,
                result={"body": result.body, "status": result.status},
            ))
            return result

    def read_proposal(self, owner: str, identifier: str) -> ProposalRecord | None:
        with self.engine.connect() as conn:
            return PostgresLedgerSession(conn).proposal(owner, identifier)

    def list_proposals(self, owner: str) -> list[ProposalRecord]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(proposals).where(
                proposals.c.owner_id == owner, proposals.c.state == "draft",
            ).order_by(proposals.c.created_at.desc(), proposals.c.id.desc()).limit(200)).mappings().all()
        return [_proposal(row) for row in rows]

    def read_transaction(self, owner: str, identifier: str) -> TransactionRecord | None:
        with self.engine.connect() as conn:
            return PostgresLedgerSession(conn).transaction(owner, identifier)

    def list_transactions(self, owner: str) -> list[TransactionRecord]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(transactions).where(
                transactions.c.owner_id == owner, transactions.c.deleted_at.is_(None),
            ).order_by(
                transactions.c.occurred_date.desc(), transactions.c.occurred_time.desc(),
            ).limit(200)).mappings().all()
        return [_transaction(row) for row in rows]

    def read_evidence(self, owner: str, identifier: str) -> EvidenceRecord | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(evidence).where(
                evidence.c.id == identifier, evidence.c.owner_id == owner,
            )).mappings().first()
        return EvidenceRecord(row["id"], row["storage_key"], row["sha256_digest"], row["kind"]) if row else None

    def list_evidence(self, owner: str, *, proposal_id: str | None = None,
                      transaction_id: str | None = None) -> list[str]:
        if (proposal_id is None) == (transaction_id is None):
            raise ValueError("Supply exactly one evidence parent")
        parent = (evidence.c.proposal_id == proposal_id if proposal_id is not None else
                  evidence.c.transaction_id == transaction_id)
        with self.engine.connect() as conn:
            rows: Sequence[str] = conn.execute(select(evidence.c.id).where(
                evidence.c.owner_id == owner, parent,
            )).scalars().all()
        return list(rows)

    def aggregate(self, owner: str, start: date, end: date) -> dict[str, str]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(transactions.c.direction, func.sum(transactions.c.amount)).where(
                transactions.c.owner_id == owner, transactions.c.deleted_at.is_(None),
                transactions.c.occurred_date >= start, transactions.c.occurred_date <= end,
            ).group_by(transactions.c.direction)).all()
        totals = {"income": "0", "expense": "0"}
        for direction, amount in rows:
            if direction in totals:
                totals[direction] = str(amount)
        return totals

    def monthly_totals(self, owner: str, start: date, end: date) -> list[dict[str, str]]:
        month = func.date_trunc("month", transactions.c.occurred_date)
        with self.engine.connect() as conn:
            rows = conn.execute(select(month, transactions.c.direction, func.sum(transactions.c.amount)).where(
                transactions.c.owner_id == owner, transactions.c.deleted_at.is_(None),
                transactions.c.occurred_date >= start, transactions.c.occurred_date <= end,
            ).group_by(month, transactions.c.direction).order_by(month)).all()
        by_month: dict[str, dict[str, str]] = {}
        cursor = start.replace(day=1)
        last = end.replace(day=1)
        while cursor <= last:
            label = cursor.strftime("%Y-%m")
            by_month[label] = {"month": label, "income": "0", "expense": "0"}
            cursor = date(cursor.year + cursor.month // 12, cursor.month % 12 + 1, 1)
        for bucket, direction, amount in rows:
            label = cast(datetime, bucket).strftime("%Y-%m")
            entry = by_month.setdefault(label, {"month": label, "income": "0", "expense": "0"})
            if direction in ("income", "expense"):
                entry[direction] = str(amount)
        return [by_month[label] for label in sorted(by_month)]

    def category_totals(self, owner: str, start: date, end: date) -> dict[str, str]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(transactions.c.category, func.sum(transactions.c.amount)).where(
                transactions.c.owner_id == owner, transactions.c.deleted_at.is_(None),
                transactions.c.direction == "expense",
                transactions.c.occurred_date >= start, transactions.c.occurred_date <= end,
            ).group_by(transactions.c.category)).all()
        return {cast(str, category): str(amount) for category, amount in rows}
