"""PostgreSQL engine and schema."""

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    MetaData,
    Numeric,
    String,
    Table,
    Time,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.engine import Engine

metadata = MetaData()

users = Table(
    "users", metadata,
    Column("id", String(36), primary_key=True),
    Column("username", String(128), nullable=False, unique=True),
    Column("password_hash", String(512), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

sessions = Table(
    "sessions", metadata,
    Column("id", String(36), primary_key=True),
    Column("user_id", String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("token_digest", LargeBinary(32), nullable=False, unique=True),
    Column("csrf_digest", LargeBinary(32), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("revoked_at", DateTime(timezone=True), nullable=True),
)
Index("ix_sessions_user_id", sessions.c.user_id)

login_attempts = Table(
    "login_attempts", metadata,
    Column("id", String(36), primary_key=True),
    Column("address_digest", LargeBinary(32), nullable=False),
    Column("attempted_at", DateTime(timezone=True), nullable=False),
)
Index("ix_login_attempts_address_time", login_attempts.c.address_digest, login_attempts.c.attempted_at)

transactions = Table(
    "transactions", metadata,
    Column("id", String(36), primary_key=True),
    Column("owner_id", String(36), ForeignKey("users.id"), nullable=False),
    Column("version", Integer, nullable=False),
    Column("amount", Numeric(18, 0), nullable=False),
    Column("currency", String(3), nullable=False),
    Column("direction", String(7), nullable=False),
    Column("description", String(200), nullable=False),
    Column("category", String(20), nullable=False),
    Column("occurred_date", Date, nullable=False),
    Column("occurred_time", Time, nullable=False),
    Column("period", String(10), nullable=False),
    Column("time_source", String(8), nullable=False),
    Column("deleted_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True), nullable=False),
)
Index("ix_transactions_owner_date", transactions.c.owner_id, transactions.c.occurred_date)

transaction_revisions = Table(
    "transaction_revisions", metadata,
    Column("transaction_id", String(36), ForeignKey("transactions.id"), primary_key=True),
    Column("version", Integer, primary_key=True),
    Column("amount", Numeric(18, 0), nullable=False),
    Column("currency", String(3), nullable=False),
    Column("direction", String(7), nullable=False),
    Column("description", String(200), nullable=False),
    Column("category", String(20), nullable=False),
    Column("occurred_date", Date, nullable=False),
    Column("occurred_time", Time, nullable=False),
    Column("period", String(10), nullable=False),
    Column("time_source", String(8), nullable=False),
    Column("deleted_at", DateTime(timezone=True)),
)

proposals = Table(
    "proposals", metadata,
    Column("id", String(36), primary_key=True),
    Column("owner_id", String(36), ForeignKey("users.id"), nullable=False),
    Column("operation", String(8), nullable=False),
    Column("target_id", String(36), ForeignKey("transactions.id")),
    Column("base_version", Integer),
    Column("result_deleted", Boolean, nullable=False),
    Column("version", Integer, nullable=False),
    Column("state", String(10), nullable=False),
    Column("amount", Numeric(18, 0)),
    Column("currency", String(3)),
    Column("direction", String(7)),
    Column("description", String(200)),
    Column("category", String(20)),
    Column("occurred_date", Date),
    Column("occurred_time", Time),
    Column("period", String(10)),
    Column("time_source", String(8)),
    Column("confirmed_transaction_id", String(36), ForeignKey("transactions.id")),
    Column("created_at", DateTime(timezone=True), nullable=False),
)
Index("ix_proposals_owner", proposals.c.owner_id)

evidence = Table(
    "evidence", metadata,
    Column("id", String(36), primary_key=True),
    Column("owner_id", String(36), ForeignKey("users.id"), nullable=False),
    Column("proposal_id", String(36), ForeignKey("proposals.id"), nullable=False),
    Column("transaction_id", String(36), ForeignKey("transactions.id")),
    Column("storage_key", String(36), nullable=False, unique=True),
    Column("sha256_digest", LargeBinary(32), nullable=False),
    Column("kind", String(10), nullable=False),
)
Index("ix_evidence_owner_transaction", evidence.c.owner_id, evidence.c.transaction_id)

idempotency = Table(
    "idempotency", metadata,
    Column("id", String(36), primary_key=True),
    Column("owner_id", String(36), ForeignKey("users.id"), nullable=False),
    Column("key", String(36), nullable=False),
    Column("fingerprint", LargeBinary(32), nullable=False),
    Column("result", JSON, nullable=False),
    UniqueConstraint("owner_id", "key", name="uq_idempotency_owner_key"),
)

chats = Table(
    "chats", metadata,
    Column("id", String(36), primary_key=True),
    Column("owner_id", String(36), ForeignKey("users.id"), nullable=False),
    Column("title", String(200), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)
Index("ix_chats_owner_created", chats.c.owner_id, chats.c.created_at)

chat_messages = Table(
    "chat_messages", metadata,
    Column("id", String(36), primary_key=True),
    Column("chat_id", String(36), ForeignKey("chats.id"), nullable=False),
    Column("owner_id", String(36), ForeignKey("users.id"), nullable=False),
    Column("role", String(10), nullable=False),
    Column("text", String(2000), nullable=False),
    Column("debug_trace", JSON),
    Column("created_at", DateTime(timezone=True), nullable=False),
)
Index("ix_chat_messages_chat", chat_messages.c.chat_id, chat_messages.c.created_at)

pinned_queries = Table(
    "pinned_queries", metadata,
    Column("id", String(36), primary_key=True),
    Column("owner_id", String(36), ForeignKey("users.id"), nullable=False),
    Column("title", String(200), nullable=False),
    Column("start_date", Date, nullable=False),
    Column("end_date", Date, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)
Index("ix_pinned_queries_owner", pinned_queries.c.owner_id)


def engine_for(url: str, *, connect_args: dict[str, str] | None = None) -> Engine:
    if not url.startswith("postgresql+psycopg://"):
        raise ValueError("DATABASE_URL must use postgresql+psycopg://")
    engine = create_engine(url, pool_pre_ping=True, connect_args=connect_args or {})

    @event.listens_for(engine, "before_cursor_execute")
    def capture_sql(_conn: object, _cursor: object, statement: str, _parameters: object,
                    _context: object, _executemany: bool) -> None:
        from where_my_buck_go.services.debug_trace import record_sql

        record_sql(statement)

    return engine
