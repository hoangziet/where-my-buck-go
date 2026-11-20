"""Add a separate salary transaction category.

Revision ID: 0009_salary_category
Revises: 0008_salary_mode
"""

from alembic import op

revision = "0009_salary_category"
down_revision = "0008_salary_mode"
branch_labels = None
depends_on = None

_CATEGORIES = (
    "('food_drink', 'transport', 'bills', 'shopping', 'entertainment', "
    "'housing', 'income', 'salary', 'other')"
)


def upgrade() -> None:
    for table in ("transactions", "transaction_revisions", "proposals"):
        op.drop_constraint(f"ck_{table}_category", table, type_="check")
        op.create_check_constraint(f"ck_{table}_category", table, f"category in {_CATEGORIES}")


def downgrade() -> None:
    for table in ("transactions", "transaction_revisions", "proposals"):
        op.drop_constraint(f"ck_{table}_category", table, type_="check")
        op.create_check_constraint(
            f"ck_{table}_category", table,
            "category in ('food_drink', 'transport', 'bills', 'shopping', 'entertainment', "
            "'housing', 'income', 'other')",
        )
