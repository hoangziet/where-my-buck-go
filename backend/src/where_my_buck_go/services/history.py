"""Chat history and pinned Q&A ranges; display-only, never consulted for business rules."""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol
from uuid import uuid4

from where_my_buck_go.services.ledger import LedgerStore


@dataclass(frozen=True)
class ChatSummary:
    id: str
    title: str
    created_at: datetime


@dataclass(frozen=True)
class MessageRecord:
    role: str
    text: str
    created_at: datetime
    debug_trace: list[dict[str, str]] | None = None


@dataclass(frozen=True)
class PinRecord:
    id: str
    title: str
    start_date: date
    end_date: date


class HistoryStore(Protocol):
    def create_chat(self, owner: str, chat_id: str, title: str, now: datetime) -> None: ...
    def append_message(
        self, owner: str, chat_id: str, role: str, text: str, now: datetime,
        debug_trace: list[dict[str, str]] | None = None,
    ) -> None: ...
    def chat_exists(self, owner: str, chat_id: str) -> bool: ...
    def list_chats(self, owner: str) -> list[ChatSummary]: ...
    def list_messages(self, owner: str, chat_id: str) -> list[MessageRecord]: ...
    def create_pin(self, owner: str, pin_id: str, title: str, start: date, end: date, now: datetime) -> None: ...
    def list_pins(self, owner: str) -> list[PinRecord]: ...
    def delete_pin(self, owner: str, pin_id: str) -> bool: ...


class HistoryService:
    def __init__(self, store: HistoryStore, ledger_store: LedgerStore) -> None:
        self.store = store
        self.ledger_store = ledger_store

    def start_or_continue(self, owner: str, chat_id: str | None, title_hint: str, now: datetime) -> str:
        if chat_id and self.store.chat_exists(owner, chat_id):
            return chat_id
        new_id = str(uuid4())
        title = title_hint.strip()[:80] or "New chat"
        self.store.create_chat(owner, new_id, title, now)
        return new_id

    def record_exchange(
        self, owner: str, chat_id: str, user_text: str, assistant_text: str, now: datetime,
        debug_trace: list[dict[str, str]] | None = None,
    ) -> None:
        self.store.append_message(owner, chat_id, "user", user_text[:2000], now)
        if assistant_text:
            self.store.append_message(owner, chat_id, "assistant", assistant_text[:2000], now, debug_trace)

    def chats(self, owner: str) -> list[dict[str, object]]:
        return [{"id": item.id, "title": item.title, "createdAt": item.created_at.isoformat()}
                for item in self.store.list_chats(owner)]

    def messages(self, owner: str, chat_id: str) -> list[dict[str, object]] | None:
        if not self.store.chat_exists(owner, chat_id):
            return None
        return [{"role": item.role, "text": item.text, "createdAt": item.created_at.isoformat(),
                 "debugTrace": item.debug_trace}
                for item in self.store.list_messages(owner, chat_id)]

    def pin(self, owner: str, title: str, start: date, end: date, now: datetime) -> dict[str, object]:
        pin_id = str(uuid4())
        self.store.create_pin(owner, pin_id, title.strip()[:80] or "Pinned", start, end, now)
        return self._pin_view(owner, pin_id, title.strip()[:80] or "Pinned", start, end)

    def pins(self, owner: str) -> list[dict[str, object]]:
        return [self._pin_view(owner, item.id, item.title, item.start_date, item.end_date)
                for item in self.store.list_pins(owner)]

    def unpin(self, owner: str, pin_id: str) -> bool:
        return self.store.delete_pin(owner, pin_id)

    def _pin_view(self, owner: str, pin_id: str, title: str, start: date, end: date) -> dict[str, object]:
        totals = self.ledger_store.aggregate(owner, start, end)
        return {"id": pin_id, "title": title, "start": start.isoformat(), "end": end.isoformat(),
                "totals": totals}
