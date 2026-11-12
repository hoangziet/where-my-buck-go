"""Owner, revocable sessions and HMAC-address login attempts.

Revision ID: 0001_auth
Revises:
"""

import sqlalchemy as sa
from alembic import op

revision = "0001_auth"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("username", sa.String(128), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(512), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table("sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_digest", sa.LargeBinary(32), nullable=False, unique=True),
        sa.Column("csrf_digest", sa.LargeBinary(32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_table("login_attempts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("address_digest", sa.LargeBinary(32), nullable=False),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_login_attempts_address_time", "login_attempts", ["address_digest", "attempted_at"])


def downgrade() -> None:
    op.drop_index("ix_login_attempts_address_time", table_name="login_attempts")
    op.drop_table("login_attempts")
    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_table("sessions")
    op.drop_table("users")
