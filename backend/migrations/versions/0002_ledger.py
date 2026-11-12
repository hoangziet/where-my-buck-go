"""Draft proposals, transactions, evidence references and idempotent writes.

Revision ID: 0002_ledger
Revises: 0001_auth
"""

import sqlalchemy as sa
from alembic import op

revision = "0002_ledger"
down_revision = "0001_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "transactions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 0), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("direction", sa.String(7), nullable=False),
        sa.Column("description", sa.String(200), nullable=False),
        sa.Column("occurred_date", sa.Date(), nullable=False),
        sa.Column("occurred_time", sa.Time(), nullable=False),
        sa.Column("period", sa.String(10), nullable=False),
        sa.Column("time_source", sa.String(8), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_transactions_owner_date", "transactions", ["owner_id", "occurred_date"])
    op.create_table(
        "transaction_revisions",
        sa.Column("transaction_id", sa.String(36), sa.ForeignKey("transactions.id"), primary_key=True),
        sa.Column("version", sa.Integer(), primary_key=True),
        sa.Column("amount", sa.Numeric(18, 0), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("direction", sa.String(7), nullable=False),
        sa.Column("description", sa.String(200), nullable=False),
        sa.Column("occurred_date", sa.Date(), nullable=False),
        sa.Column("occurred_time", sa.Time(), nullable=False),
        sa.Column("period", sa.String(10), nullable=False),
        sa.Column("time_source", sa.String(8), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "proposals",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("operation", sa.String(8), nullable=False),
        sa.Column("target_id", sa.String(36), sa.ForeignKey("transactions.id")),
        sa.Column("base_version", sa.Integer()),
        sa.Column("result_deleted", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(10), nullable=False),
        sa.Column("amount", sa.Numeric(18, 0)),
        sa.Column("currency", sa.String(3)),
        sa.Column("direction", sa.String(7)),
        sa.Column("description", sa.String(200)),
        sa.Column("occurred_date", sa.Date()),
        sa.Column("occurred_time", sa.Time()),
        sa.Column("period", sa.String(10)),
        sa.Column("time_source", sa.String(8)),
        sa.Column("confirmed_transaction_id", sa.String(36), sa.ForeignKey("transactions.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_proposals_owner", "proposals", ["owner_id"])
    op.create_table(
        "evidence",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("proposal_id", sa.String(36), sa.ForeignKey("proposals.id"), nullable=False),
        sa.Column("transaction_id", sa.String(36), sa.ForeignKey("transactions.id")),
        sa.Column("storage_key", sa.String(36), nullable=False, unique=True),
        sa.Column("sha256_digest", sa.LargeBinary(32), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
    )
    op.create_index("ix_evidence_owner_transaction", "evidence", ["owner_id", "transaction_id"])
    op.create_table(
        "idempotency",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("key", sa.String(36), nullable=False),
        sa.Column("fingerprint", sa.LargeBinary(32), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.UniqueConstraint("owner_id", "key", name="uq_idempotency_owner_key"),
    )


def downgrade() -> None:
    op.drop_table("idempotency")
    op.drop_index("ix_evidence_owner_transaction", table_name="evidence")
    op.drop_table("evidence")
    op.drop_index("ix_proposals_owner", table_name="proposals")
    op.drop_table("proposals")
    op.drop_table("transaction_revisions")
    op.drop_index("ix_transactions_owner_date", table_name="transactions")
    op.drop_table("transactions")
