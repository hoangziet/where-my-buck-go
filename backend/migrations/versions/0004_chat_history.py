"""Persisted chat history and pinned Q&A ranges for the dashboard.

Revision ID: 0004_chat_history
Revises: 0003_category
"""

import sqlalchemy as sa
from alembic import op

revision = "0004_chat_history"
down_revision = "0003_category"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chats",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_chats_owner_created", "chats", ["owner_id", "created_at"])
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("chat_id", sa.String(36), sa.ForeignKey("chats.id"), nullable=False),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("text", sa.String(2000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_chat_messages_chat", "chat_messages", ["chat_id", "created_at"])
    op.create_table(
        "pinned_queries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_pinned_queries_owner", "pinned_queries", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_pinned_queries_owner", table_name="pinned_queries")
    op.drop_table("pinned_queries")
    op.drop_index("ix_chat_messages_chat", table_name="chat_messages")
    op.drop_table("chat_messages")
    op.drop_index("ix_chats_owner_created", table_name="chats")
    op.drop_table("chats")
