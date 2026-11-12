"""Store safe operation and SQL traces with assistant chat messages.

Revision ID: 0005_chat_debug_trace
Revises: 0004_chat_history
"""

import sqlalchemy as sa
from alembic import op

revision = "0005_chat_debug_trace"
down_revision = "0004_chat_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_messages", sa.Column("debug_trace", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "debug_trace")
