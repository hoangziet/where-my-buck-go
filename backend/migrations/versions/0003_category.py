"""Expense/income category taxonomy for transactions, revisions and proposals.

Revision ID: 0003_category
Revises: 0002_ledger
"""

import sqlalchemy as sa
from alembic import op

revision = "0003_category"
down_revision = "0002_ledger"
branch_labels = None
depends_on = None

CATEGORIES = ("food_drink", "transport", "bills", "shopping", "entertainment", "housing", "income", "other")
_CHECK = "category in ('" + "', '".join(CATEGORIES) + "')"


def upgrade() -> None:
    op.add_column("transactions", sa.Column("category", sa.String(20), nullable=True))
    op.add_column("transaction_revisions", sa.Column("category", sa.String(20), nullable=True))
    op.add_column("proposals", sa.Column("category", sa.String(20), nullable=True))
    op.execute("UPDATE transactions SET category = 'other' WHERE category IS NULL")
    op.execute("UPDATE transaction_revisions SET category = 'other' WHERE category IS NULL")
    op.alter_column("transactions", "category", nullable=False)
    op.alter_column("transaction_revisions", "category", nullable=False)
    op.create_check_constraint("ck_transactions_category", "transactions", _CHECK)
    op.create_check_constraint("ck_transaction_revisions_category", "transaction_revisions", _CHECK)
    op.create_check_constraint("ck_proposals_category", "proposals", _CHECK)


def downgrade() -> None:
    op.drop_constraint("ck_proposals_category", "proposals", type_="check")
    op.drop_constraint("ck_transaction_revisions_category", "transaction_revisions", type_="check")
    op.drop_constraint("ck_transactions_category", "transactions", type_="check")
    op.drop_column("proposals", "category")
    op.drop_column("transaction_revisions", "category")
    op.drop_column("transactions", "category")
