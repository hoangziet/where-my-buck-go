"""Store a per-owner Telegram bot connection.

Revision ID: 0007_telegram_connections
Revises: 0006_chat_image_evidence
"""

import sqlalchemy as sa
from alembic import op

revision = "0007_telegram_connections"
down_revision = "0006_chat_image_evidence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "telegram_connections",
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("encrypted_bot_token", sa.LargeBinary(), nullable=False),
        sa.Column("bot_username", sa.String(64), nullable=False),
        sa.Column("webhook_secret_digest", sa.LargeBinary(32), nullable=False),
        sa.Column("pairing_code_digest", sa.LargeBinary(32), nullable=False),
        sa.Column("pairing_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("telegram_chat_id", sa.String(64)),
        sa.Column("app_chat_id", sa.String(36)),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("telegram_connections")
