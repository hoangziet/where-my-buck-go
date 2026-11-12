"""Two-specialist coordinator: read-only Q&A and draft-only transaction intake."""

import json
from datetime import date, datetime, timedelta
from typing import Protocol

from where_my_buck_go.domain.ledger import InvalidProposal
from where_my_buck_go.domain.money import InvalidMoney
from where_my_buck_go.domain.transaction_time import LOCAL_ZONE, InvalidTransactionTime, parse_transaction_date
from where_my_buck_go.services.debug_trace import current_trace, record_step
from where_my_buck_go.services.history import HistoryService
from where_my_buck_go.services.ledger import LedgerResult, LedgerService, LedgerSession, transaction_view

_ROUTE_FIELDS: dict[str, object] = {
    "type": "OBJECT", "properties": {
        "specialist": {"type": "STRING", "enum": ["qa", "intake", "change"]},
        "date": {"type": "STRING", "description": "hôm nay, hôm qua, YYYY-MM-DD, or empty"},
        "range": {"type": "STRING", "enum": ["single_day", "today", "yesterday", "this_month",
                                                 "last_month", "custom"]},
        "start": {"type": "STRING", "description": "YYYY-MM-DD for a custom range; otherwise empty"},
        "end": {"type": "STRING", "description": "YYYY-MM-DD for a custom range; otherwise empty"},
    }, "required": ["specialist", "date"],
}
_CATEGORIES = ["food_drink", "transport", "bills", "shopping", "entertainment", "housing", "income", "other"]
_ITEM: dict[str, object] = {
    "type": "OBJECT", "properties": {
        "amount": {"type": "STRING", "description": "Canonical VND digits, empty when missing"},
        "currency": {"type": "STRING"}, "direction": {"type": "STRING", "enum": ["income", "expense"]},
        "description": {"type": "STRING"}, "category": {"type": "STRING", "enum": _CATEGORIES},
        "occurredDate": {"type": "STRING"},
        "period": {"type": "STRING",
                  "description": "Time-of-day word only: sáng, trưa, chiều, tối; empty if not mentioned"},
        "occurredTime": {"type": "STRING",
                         "description": "Strict 24-hour HH:MM ONLY if the message states an explicit clock "
                                        "number (e.g. '7h30' -> '07:30', '19h' -> '19:00'); empty otherwise. "
                                        "Never put a time-of-day word here."},
    }, "required": ["amount", "currency", "direction", "description", "category",
                    "occurredDate", "period", "occurredTime"],
}
_ITEM_KEYS = {"amount", "currency", "direction", "description", "category", "occurredDate", "period", "occurredTime"}
_INTAKE_FIELDS: dict[str, object] = {"type": "OBJECT", "properties": {
    "items": {"type": "ARRAY", "items": _ITEM},
}, "required": ["items"]}
_ANSWER_FIELDS: dict[str, object] = {"type": "OBJECT", "properties": {
    "answer": {"type": "STRING"},
}, "required": ["answer"]}
_CHANGE_MATCH_FIELDS: dict[str, object] = {
    "type": "OBJECT", "properties": {
        "operation": {"type": "STRING", "enum": ["edit", "delete", "undo"]},
        "matchDescription": {"type": "STRING",
                             "description": "Keyword(s) from the description to find the transaction; "
                                            "empty if the owner did not say"},
        "matchDate": {"type": "STRING", "description": "hôm nay, hôm qua, YYYY-MM-DD, or empty"},
    }, "required": ["operation", "matchDescription", "matchDate"],
}


class ChatModel(Protocol):
    def call_function(self, prompt: str, name: str, parameters: dict[str, object],
                      *, image: bytes | None = None, mime_type: str | None = None) -> dict[str, object]: ...


class ChatService:
    def __init__(self, model: ChatModel, ledger: LedgerService, history: HistoryService | None = None) -> None:
        self.model = model
        self.ledger = ledger
        self.history = history

    def respond(
        self, owner: str, key: str, text: str, now: datetime, history: list[dict[str, str]],
        chat_id: str | None = None,
    ) -> LedgerResult:
        if not 1 <= len(text) <= 2000 or len(history) > 8:
            raise InvalidProposal("Message must be 1-2000 characters; history at most eight turns")
        if any(not isinstance(item, dict) or set(item) != {"role", "text"} or
               item["role"] not in ("user", "assistant") or
               not isinstance(item["text"], str) or len(item["text"]) > 2000 for item in history):
            raise InvalidProposal("History must contain only bounded user and assistant text")
        body: dict[str, object] = {"text": text, "history": history, "expectedVersion": 0}

        def coordinate(tx: LedgerSession, written: list[str]) -> LedgerResult:
            classification = self.model.call_function(
                "Route this message. Financial questions -> qa, new income/expense -> intake, "
                "edit/delete/undo requests -> change. Ambiguous input -> qa. For questions select "
                "today, yesterday, this_month, last_month or a custom date range with YYYY-MM-DD bounds; "
                "for a single date use single_day and date. Do not guess missing dates. "
                f"Local date: {now.astimezone(LOCAL_ZONE).date().isoformat()}. Message: " + text,
                "route_message", _ROUTE_FIELDS,
            )
            specialist = classification.get("specialist")
            specialist_label = {
                "qa": "a financial question", "intake": "a new transaction", "change": "a transaction change",
            }
            label = specialist_label.get(str(specialist), "a question")
            record_step("Classify request", f"Gemini routed this as {label}.")
            if specialist == "intake":
                result = self._intake(tx, written, owner, text, now)
            elif specialist == "change":
                result = self._change(tx, written, owner, text, now)
            else:
                result = self._answer(owner, text, now, history, classification)
            if self.history is not None:
                actual_chat_id = self.history.start_or_continue(owner, chat_id, text, now)
                assistant_text = result.body.get("message")
                trace = current_trace()
                self.history.record_exchange(owner, actual_chat_id, text,
                                             assistant_text if isinstance(assistant_text, str) else "", now,
                                             debug_trace=trace.snapshot() if trace is not None else None)
                result = LedgerResult({**result.body, "chatId": actual_chat_id}, result.status)
            trace = current_trace()
            if trace is not None:
                result = LedgerResult({**result.body, "debugTrace": trace.snapshot()}, result.status)
            return result

        result = self.ledger.execute_with_evidence(owner, key, "chat", body, coordinate)
        trace = current_trace()
        if trace is not None:
            # On an idempotent replay the coordinator does not run, so retain the trace
            # saved with the original response instead of replacing it with an empty one.
            saved_trace = result.body.get("debugTrace")
            response_trace = trace.snapshot() if trace.entries else saved_trace
            return LedgerResult({**result.body, "debugTrace": response_trace or []}, result.status)
        return result

    def _intake(
        self, tx: LedgerSession, written: list[str], owner: str, text: str, now: datetime,
    ) -> LedgerResult:
        parsed = self.model.call_function(
            "Extract each independent income or expense from this Vietnamese message into separate items. "
            "Preserve the user's shared date and time across all items unless they explicitly differ. "
            "Use canonical integer VND digits. For the date field, prefer passing through the literal word "
            "hôm nay or hôm qua exactly as written when the owner used one of those words — do not compute "
            "an absolute date yourself for them. Only emit an explicit YYYY-MM-DD when the owner stated a "
            "specific date or a different relative date; if you do, it must be on or before "
            f"{now.astimezone(LOCAL_ZONE).date().isoformat()} (today, Asia/Ho_Chi_Minh), never a future or "
            "unrelated year. "
            "A time-of-day word (sáng/trưa/chiều/tối) goes ONLY in 'period', never in 'occurredTime'. "
            "'occurredTime' is strict 24-hour HH:MM and must be left empty unless the message states an "
            "explicit clock number (e.g. '7h30 sáng' -> period 'sáng', occurredTime '07:30'; '19h' -> "
            "occurredTime '19:00'); a bare period word alone keeps occurredTime empty. "
            "Use empty strings for missing amount/date/period/time, never infer a date from message time. "
            "Assign each item exactly one category from: food_drink (ăn uống), transport (đi lại), "
            "bills (hoá đơn, điện nước, internet), shopping (mua sắm), entertainment (giải trí), "
            "housing (nhà ở, thuê nhà), income (mọi khoản thu), other (không rõ). "
            "No confirmation, no SQL, no write action. Message: " + text,
            "parse_transactions", _INTAKE_FIELDS,
        )
        items = parsed.get("items")
        if not isinstance(items, list) or not 1 <= len(items) <= 10:
            raise InvalidProposal("Gemini must return 1-10 independent transaction items")
        record_step("Extract transaction fields", f"Gemini returned {len(items)} structured item(s).")
        proposals: list[dict[str, object]] = []
        errors: list[dict[str, object]] = []
        for index, item in enumerate(items):
            try:
                if not isinstance(item, dict) or set(item) != _ITEM_KEYS:
                    raise InvalidProposal("Missing or unexpected transaction fields")
                payload: dict[str, object] = {**item, "evidenceText": text, "expectedVersion": 0}
                for optional in ("occurredDate", "occurredTime", "period"):
                    if payload[optional] == "":
                        payload[optional] = None
                preview = self.ledger.create_in_transaction(tx, owner, payload, now, written)
                proposals.append(preview.body)
            except (InvalidProposal, InvalidMoney, InvalidTransactionTime) as error:
                errors.append({"index": index, "error": str(error)})
        message = ("Đã tạo bản nháp; từng khoản cần xác nhận riêng." if proposals else
                   "Chưa tạo bản nháp. Kiểm tra lại các khoản không hợp lệ.")
        record_step("Validate draft", f"Prepared {len(proposals)} draft(s); {len(errors)} item(s) need correction.")
        return LedgerResult({"kind": "intake", "proposals": proposals, "errors": errors, "message": message}, 200)

    def _change(
        self, tx: LedgerSession, written: list[str], owner: str, text: str, now: datetime,
    ) -> LedgerResult:
        match = self.model.call_function(
            "The owner wants to edit, delete or undo a past transaction. Identify the operation and enough "
            "of the description to find it among their own transactions. Use hôm nay/hôm qua or YYYY-MM-DD "
            "for matchDate; empty string if the owner did not say a date. Message: " + text,
            "match_transaction", _CHANGE_MATCH_FIELDS,
        )
        operation = match.get("operation")
        if operation not in ("edit", "delete", "undo"):
            raise InvalidProposal("Gemini must select edit, delete or undo")
        record_step("Identify requested change", f"Gemini selected {operation}.")
        match_description, match_date_text = match.get("matchDescription"), match.get("matchDate")
        if not isinstance(match_description, str) or not isinstance(match_date_text, str):
            raise InvalidProposal("Match fields must be text")
        match_date: date | None = None
        if match_date_text:
            try:
                match_date = parse_transaction_date(match_date_text, now)
            except InvalidTransactionTime:
                match_date = None
        candidates = [
            t for t in self.ledger.store.list_transactions(owner)
            if not t.deleted
            and (not match_description or match_description.casefold() in t.fields.description.casefold())
            and (match_date is None or t.fields.occurred.occurred_date == match_date)
        ]
        record_step("Find matching transactions", f"Found {len(candidates)} matching transaction(s) in this account.")
        if not candidates:
            return LedgerResult({
                "kind": "needs_selection", "candidates": [],
                "message": "Không tìm thấy giao dịch phù hợp. Hãy mô tả cụ thể hơn hoặc sửa trực tiếp ở "
                           "trang Transactions.",
            }, 200)
        if len(candidates) > 1:
            shown = candidates[:5]
            return LedgerResult({
                "kind": "needs_selection", "operation": operation,
                "candidates": [transaction_view(item) for item in shown],
                "message": f"Có {len(candidates)} giao dịch khớp; hãy chọn đúng khoản muốn {operation}.",
            }, 200)
        target = candidates[0]
        body: dict[str, object] = {"operation": operation, "targetId": target.id,
                                   "expectedVersion": target.version, "evidenceText": text}
        if operation == "edit":
            current = transaction_view(target)
            edited = self.model.call_function(
                "Apply the owner's requested edit to this transaction, keeping every field the owner did "
                "not ask to change exactly as it is now. Current transaction: " +
                json.dumps(current, ensure_ascii=False) + ". Message: " + text,
                "edit_transaction", _ITEM,
            )
            if not isinstance(edited, dict) or set(edited) != _ITEM_KEYS:
                raise InvalidProposal("Missing or unexpected edit fields")
            body.update(edited)
            for optional in ("occurredDate", "occurredTime", "period"):
                if body[optional] == "":
                    body[optional] = None
        proposal = self.ledger.change_in_transaction(tx, owner, body, now, written)
        message = {"edit": "Đã tạo bản nháp sửa; cần xác nhận riêng.",
                   "delete": "Đã tạo bản nháp xoá; cần xác nhận riêng.",
                   "undo": "Đã tạo bản nháp khôi phục; cần xác nhận riêng."}[operation]
        return LedgerResult({"kind": "change", "proposal": proposal.body, "message": message}, 200)

    def _answer(
        self, owner: str, text: str, now: datetime, history: list[dict[str, str]], classification: dict[str, object],
    ) -> LedgerResult:
        start, end = self._range(classification, now)
        record_step("Aggregate account totals", f"Read totals from {start.isoformat()} to {end.isoformat()}.")
        totals = self.ledger.store.aggregate(owner, start, end)
        context = json.dumps({"question": text, "history": history, "start": start.isoformat(),
                              "end": end.isoformat(), "totals_vnd": totals}, ensure_ascii=False)
        answer = self.model.call_function(
            "Answer the owner's finance question using ONLY these owner-filtered totals; do not invent "
            "transactions or claim to make changes. If no data, say so. Context: " + context,
            "answer_finance", _ANSWER_FIELDS,
        ).get("answer")
        if not isinstance(answer, str) or not 1 <= len(answer) <= 1000:
            raise InvalidProposal("Gemini returned an invalid read-only answer")
        record_step("Compose response", "Returned an answer using only account-scoped totals.")
        return LedgerResult({"kind": "qa", "message": answer, "start": start.isoformat(),
                             "end": end.isoformat(), "totals": totals}, 200)

    @staticmethod
    def _range(classification: dict[str, object], now: datetime) -> tuple[date, date]:
        local = now.astimezone(LOCAL_ZONE).date()
        period = classification.get("range")
        if period == "today":
            return local, local
        if period == "yesterday":
            return local - timedelta(days=1), local - timedelta(days=1)
        if period == "last_month":
            end = local.replace(day=1) - timedelta(days=1)
            return end.replace(day=1), end
        if period == "this_month":
            return local.replace(day=1), local
        if period == "custom":
            first, last = classification.get("start"), classification.get("end")
            if isinstance(first, str) and isinstance(last, str):
                try:
                    parsed_start = parse_transaction_date(first, now)
                    parsed_end = parse_transaction_date(last, now)
                    if (parsed_start is not None and parsed_end is not None and
                            0 <= (parsed_end - parsed_start).days <= 366):
                        return parsed_start, parsed_end
                except InvalidTransactionTime:
                    pass
            return local.replace(day=1), local
        date_hint = classification.get("date")
        if not isinstance(date_hint, str):
            date_hint = ""
        try:
            selected = parse_transaction_date(date_hint or None, now)
        except InvalidTransactionTime:
            selected = None  # An untrusted model hint must not turn a valid question into an error.
        return (selected, selected) if selected else (local.replace(day=1), local)
