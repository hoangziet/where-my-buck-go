"""Keep receipt images linked to their original chat messages.

Revision ID: 0006_chat_image_evidence
Revises: 0005_chat_debug_trace
"""

import sqlalchemy as sa
from alembic import op

revision = "0006_chat_image_evidence"
down_revision = "0005_chat_debug_trace"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column("evidence_id", sa.String(36), sa.ForeignKey("evidence.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chat_messages", "evidence_id")
