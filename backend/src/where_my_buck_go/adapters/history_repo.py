"""PostgreSQL storage for chat history and pinned Q&A ranges."""

from datetime import date, datetime
from uuid import uuid4

from sqlalchemy import delete, insert, select
from sqlalchemy.engine import Engine

from where_my_buck_go.adapters.db import chat_messages, chats, pinned_queries
from where_my_buck_go.services.history import ChatSummary, HistoryStore, MessageRecord, PinRecord


class PostgresHistoryStore(HistoryStore):
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def create_chat(self, owner: str, chat_id: str, title: str, now: datetime) -> None:
        with self.engine.begin() as conn:
            conn.execute(insert(chats).values(id=chat_id, owner_id=owner, title=title, created_at=now))

    def append_message(
        self, owner: str, chat_id: str, role: str, text: str, now: datetime,
        debug_trace: list[dict[str, str]] | None = None,
    ) -> None:
        with self.engine.begin() as conn:
            conn.execute(insert(chat_messages).values(
                id=str(uuid4()), chat_id=chat_id, owner_id=owner, role=role, text=text,
                debug_trace=debug_trace, created_at=now,
            ))

    def chat_exists(self, owner: str, chat_id: str) -> bool:
        with self.engine.connect() as conn:
            row = conn.execute(select(chats.c.id).where(
                chats.c.id == chat_id, chats.c.owner_id == owner,
            )).first()
        return row is not None

    def list_chats(self, owner: str) -> list[ChatSummary]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(chats).where(chats.c.owner_id == owner).order_by(
                chats.c.created_at.desc(),
            ).limit(50)).mappings().all()
        return [ChatSummary(row["id"], row["title"], row["created_at"]) for row in rows]

    def list_messages(self, owner: str, chat_id: str) -> list[MessageRecord]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(chat_messages).where(
                chat_messages.c.chat_id == chat_id, chat_messages.c.owner_id == owner,
            ).order_by(chat_messages.c.created_at)).mappings().all()
        return [MessageRecord(row["role"], row["text"], row["created_at"], row["debug_trace"]) for row in rows]

    def create_pin(self, owner: str, pin_id: str, title: str, start: date, end: date, now: datetime) -> None:
        with self.engine.begin() as conn:
            conn.execute(insert(pinned_queries).values(
                id=pin_id, owner_id=owner, title=title, start_date=start, end_date=end, created_at=now,
            ))

    def list_pins(self, owner: str) -> list[PinRecord]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(pinned_queries).where(pinned_queries.c.owner_id == owner).order_by(
                pinned_queries.c.created_at,
            )).mappings().all()
        return [PinRecord(row["id"], row["title"], row["start_date"], row["end_date"]) for row in rows]

    def delete_pin(self, owner: str, pin_id: str) -> bool:
        with self.engine.begin() as conn:
            result = conn.execute(delete(pinned_queries).where(
                pinned_queries.c.id == pin_id, pinned_queries.c.owner_id == owner,
            ))
        return result.rowcount > 0
