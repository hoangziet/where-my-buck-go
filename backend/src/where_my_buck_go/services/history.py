"""Chat history and pinned Q&A ranges; display-only, never consulted for business rules."""

import json
import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol
from uuid import uuid4

from where_my_buck_go.services.ledger import LedgerStore

_SALARY_TERMS = re.compile(
    r"\b(?:salary|salaries|payroll|paycheck|paychecks|payslip|wage|wages|compensation|take.home)\b|"
    r"lương|luong|tiền lương",
    re.IGNORECASE,
)


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
    evidence_id: str | None = None


@dataclass(frozen=True)
class PinRecord:
    id: str
    title: str
    start_date: date
    end_date: date


class HistoryStore(Protocol):
    def create_chat(self, owner: str, chat_id: str, title: str, now: datetime) -> None: ...
    def rename_chat(self, owner: str, chat_id: str, title: str) -> bool: ...
    def delete_chat(self, owner: str, chat_id: str) -> bool: ...
    def append_message(
        self, owner: str, chat_id: str, role: str, text: str, now: datetime,
        debug_trace: list[dict[str, str]] | None = None,
        evidence_id: str | None = None,
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

    def rename_chat(self, owner: str, chat_id: str, title: str) -> bool:
        clean = title.strip()[:200]
        if not clean:
            return False
        return self.store.rename_chat(owner, chat_id, clean)

    def delete_chat(self, owner: str, chat_id: str) -> bool:
        return self.store.delete_chat(owner, chat_id)

    def record_exchange(
        self, owner: str, chat_id: str, user_text: str, assistant_text: str, now: datetime,
        debug_trace: list[dict[str, str]] | None = None,
        user_evidence_id: str | None = None,
    ) -> None:
        self.store.append_message(owner, chat_id, "user", user_text[:2000], now, evidence_id=user_evidence_id)
        if assistant_text:
            self.store.append_message(owner, chat_id, "assistant", assistant_text[:2000], now, debug_trace)

    def chats(self, owner: str) -> list[dict[str, object]]:
        hidden_chat_ids = self._salary_chat_ids(owner)
        return [{"id": item.id, "title": item.title, "createdAt": item.created_at.isoformat()}
                for item in self.store.list_chats(owner) if item.id not in hidden_chat_ids]

    def messages(self, owner: str, chat_id: str) -> list[dict[str, object]] | None:
        if not self.store.chat_exists(owner, chat_id):
            return None
        messages = self.store.list_messages(owner, chat_id)
        if not self._salary_mode_enabled(owner):
            messages = [message for pair in self._message_pairs(messages) if not self._salary_pair(pair)
                        for message in pair]
        return [{"role": item.role, "text": item.text, "createdAt": item.created_at.isoformat(),
                 "debugTrace": item.debug_trace, "evidenceId": item.evidence_id}
                for item in messages]

    def _salary_mode_enabled(self, owner: str) -> bool:
        checker = getattr(self.ledger_store, "salary_mode_enabled", None)
        return bool(checker(owner)) if callable(checker) else False

    def _salary_chat_ids(self, owner: str) -> set[str]:
        if self._salary_mode_enabled(owner):
            return set()
        return {chat.id for chat in self.store.list_chats(owner)
                if any(self._salary_pair(pair) for pair in self._message_pairs(
                    self.store.list_messages(owner, chat.id),
                ))}

    @staticmethod
    def _message_pairs(messages: list[MessageRecord]) -> list[list[MessageRecord]]:
        return [messages[index:index + 2] for index in range(0, len(messages), 2)]

    @staticmethod
    def _salary_pair(messages: list[MessageRecord]) -> bool:
        for message in messages:
            if _SALARY_TERMS.search(message.text):
                return True
            for entry in message.debug_trace or []:
                if entry.get("kind") != "sql":
                    step_text = json.dumps(entry, ensure_ascii=False)
                    if _SALARY_TERMS.search(step_text):
                        return True
        return False

    def pin(self, owner: str, title: str, start: date, end: date, now: datetime) -> dict[str, object]:
        pin_id = str(uuid4())
        self.store.create_pin(owner, pin_id, title.strip()[:80] or "Pinned", start, end, now)
        return self._pin_view(owner, pin_id, title.strip()[:80] or "Pinned", start, end)

    def pins(self, owner: str) -> list[dict[str, object]]:
        pins = self.store.list_pins(owner)
        if not self._salary_mode_enabled(owner):
            pins = [item for item in pins if not _SALARY_TERMS.search(item.title)]
        return [self._pin_view(owner, item.id, item.title, item.start_date, item.end_date) for item in pins]

    def unpin(self, owner: str, pin_id: str) -> bool:
        return self.store.delete_pin(owner, pin_id)

    def _pin_view(self, owner: str, pin_id: str, title: str, start: date, end: date) -> dict[str, object]:
        totals = self.ledger_store.aggregate(owner, start, end)
        return {"id": pin_id, "title": title, "start": start.isoformat(), "end": end.isoformat(),
                "totals": totals}
