"""Add an opt-in salary visibility mode to user settings.

Revision ID: 0008_salary_mode
Revises: 0007_telegram_connections
"""

import sqlalchemy as sa
from alembic import op

revision = "0008_salary_mode"
down_revision = "0007_telegram_connections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("salary_mode_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("users", "salary_mode_enabled")
