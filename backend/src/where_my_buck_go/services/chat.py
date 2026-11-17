"""Two-specialist coordinator: read-only Q&A and draft-only transaction intake."""

import json
from datetime import date, datetime, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

from where_my_buck_go.domain.ledger import InvalidProposal, ProposalRecord
from where_my_buck_go.domain.money import InvalidMoney
from where_my_buck_go.domain.transaction_time import (
    LOCAL_ZONE,
    InvalidTransactionTime,
    parse_transaction_date,
    resolve_client_zone,
)
from where_my_buck_go.services.debug_trace import current_trace, record_step
from where_my_buck_go.services.history import HistoryService
from where_my_buck_go.services.ledger import (
    LedgerResult,
    LedgerService,
    LedgerSession,
    proposal_view,
    transaction_view,
)

_ROUTE_FIELDS: dict[str, object] = {
    "type": "OBJECT", "properties": {
        "specialist": {"type": "STRING", "enum": ["qa", "intake", "change", "revise"]},
        "date": {"type": "STRING", "description": "hôm nay, hôm qua, YYYY-MM-DD, or empty"},
        "range": {"type": "STRING", "enum": ["single_day", "today", "yesterday", "this_month",
                                                 "last_month", "custom"]},
        "start": {"type": "STRING", "description": "YYYY-MM-DD for a custom range; otherwise empty"},
        "end": {"type": "STRING", "description": "YYYY-MM-DD for a custom range; otherwise empty"},
    }, "required": ["specialist", "date"],
}
_CATEGORIES = ["food_drink", "transport", "bills", "shopping", "entertainment", "housing", "income", "other"]
_ITEM_PROPERTIES: dict[str, object] = {
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
}
_ITEM_REQUIRED = ["amount", "currency", "direction", "description", "category",
                  "occurredDate", "period", "occurredTime"]
_ITEM: dict[str, object] = {"type": "OBJECT", "properties": _ITEM_PROPERTIES, "required": _ITEM_REQUIRED}
_ITEM_KEYS = set(_ITEM_REQUIRED)
_REVISE_FIELDS: dict[str, object] = {
    "type": "OBJECT",
    "properties": {"proposalId": {"type": "STRING"}, **_ITEM_PROPERTIES},
    "required": ["proposalId", *_ITEM_REQUIRED],
}
MAX_PENDING_PROPOSALS = 5
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
        client_timezone: str | None = None,
        pending_proposal_ids: list[str] | None = None,
    ) -> LedgerResult:
        pending_ids = pending_proposal_ids or []
        if len(pending_ids) > MAX_PENDING_PROPOSALS or any(
                not isinstance(item, str) or not 1 <= len(item) <= 64 for item in pending_ids):
            raise InvalidProposal(f"At most {MAX_PENDING_PROPOSALS} pending draft IDs are allowed")
        if not 1 <= len(text) <= 2000 or len(history) > 8:
            raise InvalidProposal("Message must be 1-2000 characters; history at most eight turns")
        if any(not isinstance(item, dict) or set(item) != {"role", "text"} or
               item["role"] not in ("user", "assistant") or
               not isinstance(item["text"], str) or len(item["text"]) > 2000 for item in history):
            raise InvalidProposal("History must contain only bounded user and assistant text")
        body: dict[str, object] = {"text": text, "history": history, "expectedVersion": 0}
        if pending_ids:
            body["pendingProposalIds"] = pending_ids

        def coordinate(tx: LedgerSession, written: list[str]) -> LedgerResult:
            client_zone = resolve_client_zone(client_timezone)
            local_date = now.astimezone(client_zone).date().isoformat()
            pending = self._pending_drafts(tx, owner, pending_ids)
            context = self._conversation_context(history, pending)
            classification = self.model.call_function(
                "Route this message in any language (Vietnamese with/without accents, English, etc.). "
                "Financial questions or summaries -> qa, new income/expense transactions -> intake, "
                "edit/delete/undo requests for saved transactions -> change. "
                + ("If the message only adds or corrects details (date, time, amount, category, description) "
                   "of one of the pending drafts below instead of describing a new transaction -> revise. "
                   if pending else "") +
                "Ambiguous input -> qa. For questions select "
                "today, yesterday, this_month, last_month or a custom date range with YYYY-MM-DD bounds; "
                "for a single date use single_day and date. Do not guess missing dates. "
                f"Local date: {local_date}. {context}Message: " + text,
                "route_message", _ROUTE_FIELDS,
            )
            specialist = classification.get("specialist")
            if specialist == "revise" and not pending:
                specialist = "intake"
            specialist_label = {
                "qa": "a financial question", "intake": "a new transaction", "change": "a transaction change",
                "revise": "a correction to a pending draft",
            }
            label = specialist_label.get(str(specialist), "a question")
            record_step("Classify request", f"Gemini routed this as {label}.", data={"specialist": specialist})
            if specialist == "revise":
                result = self._revise(tx, written, owner, text, now, pending, context, client_zone=client_zone)
            elif specialist == "intake":
                result = self._intake(tx, written, owner, text, now, client_zone=client_zone)
            elif specialist == "change":
                result = self._change(tx, written, owner, text, now, client_zone=client_zone)
            else:
                result = self._answer(owner, text, now, history, classification, client_zone=client_zone)
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
        client_zone: ZoneInfo = LOCAL_ZONE,
    ) -> LedgerResult:
        local_date = now.astimezone(client_zone).date().isoformat()
        parsed = self.model.call_function(
            "Extract each independent income or expense from this message into separate items. "
            "The message can be in any language (Vietnamese with or without accents, English, etc.). "
            "Preserve the user's shared date and time across all items unless they explicitly differ. "
            "Use canonical integer VND digits for 'amount'. "
            "For 'occurredDate': Analyze any relative or explicit date mentioned (e.g. 'hôm nay', 'hom nay', "
            "'today', 'hôm qua', 'hom qua', 'yesterday', 'tối qua', 'last Friday', etc.) and resolve it "
            f"directly into an explicit 'YYYY-MM-DD' date based on today's reference date: {local_date}. "
            "If the message does not state a date or day word, leave 'occurredDate' "
            f"as an empty string (do not invent a date). Never emit a future date beyond {local_date}. "
            "For 'period': Normalize any time-of-day mention across any language (e.g. morning/am/sáng/sang -> "
            "'sáng', noon/lunch/trưa/trua -> 'trưa', afternoon/pm/chiều/chieu -> 'chiều', evening/night/tối/toi "
            "-> 'tối') into exactly one of: 'sáng', 'trưa', 'chiều', 'tối', or empty string if not mentioned. "
            "For 'occurredTime': Extract any explicit clock time (e.g. '7h30', '7:30 am', '19h', '6pm' -> "
            "'18:00') into strict 24-hour HH:MM format; leave empty string if no clock number was stated. "
            "Assign each item exactly one category from: food_drink (ăn uống), transport (đi lại), "
            "bills (hoá đơn, điện nước, internet), shopping (mua sắm), entertainment (giải trí), "
            "housing (nhà ở, thuê nhà), income (mọi khoản thu), other (không rõ). "
            "No confirmation, no SQL, no write action. Message: " + text,
            "parse_transactions", _INTAKE_FIELDS,
        )
        items = parsed.get("items")
        if not isinstance(items, list) or not 1 <= len(items) <= 10:
            raise InvalidProposal("Gemini must return 1-10 independent transaction items")
        record_step(
            "Extract transaction fields",
            f"Gemini returned {len(items)} structured item(s).",
            data={"itemCount": len(items), "items": items},
        )
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
        record_step(
            "Validate draft",
            f"Prepared {len(proposals)} draft(s); {len(errors)} item(s) need correction.",
            data={"draftCount": len(proposals), "errorCount": len(errors)},
        )
        return LedgerResult({"kind": "intake", "proposals": proposals, "errors": errors, "message": message}, 200)

    @staticmethod
    def _pending_drafts(tx: LedgerSession, owner: str, identifiers: list[str]) -> list[ProposalRecord]:
        drafts = (tx.proposal(owner, identifier) for identifier in dict.fromkeys(identifiers))
        return [draft for draft in drafts
                if draft is not None and draft.state == "draft" and draft.operation in ("create", "edit")]

    @staticmethod
    def _conversation_context(history: list[dict[str, str]], pending: list[ProposalRecord]) -> str:
        parts: list[str] = []
        if history:
            parts.append("Recent conversation (oldest first): " + json.dumps(history[-6:], ensure_ascii=False))
        if pending:
            drafts = [{key: proposal_view(draft)[key] for key in (
                "id", "amount", "direction", "description", "category", "occurredDate", "occurredTime", "period",
                "timeSource")} for draft in pending]
            parts.append("Pending drafts awaiting the owner's confirmation: " + json.dumps(drafts, ensure_ascii=False))
        return "".join(part + ". " for part in parts)

    def _revise(
        self, tx: LedgerSession, written: list[str], owner: str, text: str, now: datetime,
        pending: list[ProposalRecord], context: str, client_zone: ZoneInfo = LOCAL_ZONE,
    ) -> LedgerResult:
        local_date = now.astimezone(client_zone).date().isoformat()
        revised = self.model.call_function(
            "The owner's latest message adds or corrects details of one pending draft. Pick that draft's id as "
            "proposalId and return all of its fields, changing only what the message states and keeping every "
            "other field exactly as it is now. Resolve relative dates (hôm nay, hôm qua, tối qua, yesterday) to "
            f"YYYY-MM-DD from today's date {local_date}; never a future date. 'period' is one of sáng, trưa, "
            "chiều, tối or empty; 'occurredTime' is an explicit clock in 24-hour HH:MM or empty (e.g. "
            "'tối qua 7h' -> period 'tối', occurredTime '19:00'). Keep an existing explicit time unless the "
            f"message changes it. Use canonical integer VND digits for amount. {context}Message: " + text,
            "revise_draft", _REVISE_FIELDS,
        )
        proposal_id = revised.get("proposalId")
        target = next((draft for draft in pending if draft.id == proposal_id), None)
        if target is None:
            raise InvalidProposal("Gemini must pick one of the pending drafts")
        fields = {key: value for key, value in revised.items() if key != "proposalId"}
        record_step("Revise pending draft", "Gemini applied the message to a pending draft.",
                    data={"proposalId": target.id, "fields": fields})
        if set(fields) != _ITEM_KEYS:
            raise InvalidProposal("Missing or unexpected draft fields")
        payload: dict[str, object] = {**fields, "evidenceText": text, "expectedVersion": target.version}
        for optional in ("occurredDate", "occurredTime", "period"):
            if payload[optional] == "":
                payload[optional] = None
        try:
            updated = self.ledger.amend_in_transaction(tx, owner, target.id, payload, now, written)
        except (InvalidProposal, InvalidMoney, InvalidTransactionTime) as error:
            return LedgerResult({"kind": "intake", "proposals": [], "errors": [{"index": 0, "error": str(error)}],
                                 "message": "Chưa cập nhật được bản nháp. Kiểm tra lại thông tin."}, 200)
        return LedgerResult({"kind": "intake", "proposals": [updated.body], "errors": [],
                             "revisedProposalIds": [target.id],
                             "message": "Đã cập nhật bản nháp; kiểm tra rồi xác nhận."}, 200)

    def _change(
        self, tx: LedgerSession, written: list[str], owner: str, text: str, now: datetime,
        client_zone: ZoneInfo = LOCAL_ZONE,
    ) -> LedgerResult:
        local_date = now.astimezone(client_zone).date().isoformat()
        match = self.model.call_function(
            "The owner wants to edit, delete or undo a past transaction. The message can be in any language. "
            "Identify the operation and enough of the description to find it among their own transactions. "
            f"For matchDate, resolve to YYYY-MM-DD based on today's date {local_date} if a "
            "relative date (hôm nay, yesterday, etc.) or specific date was mentioned; empty string if the "
            "owner did not say a date. Message: " + text,
            "match_transaction", _CHANGE_MATCH_FIELDS,
        )
        operation = match.get("operation")
        if operation not in ("edit", "delete", "undo"):
            raise InvalidProposal("Gemini must select edit, delete or undo")
        record_step("Identify requested change", f"Gemini selected {operation}.", data={"operation": operation})
        match_description, match_date_text = match.get("matchDescription"), match.get("matchDate")
        if not isinstance(match_description, str) or not isinstance(match_date_text, str):
            raise InvalidProposal("Match fields must be text")
        match_date: date | None = None
        if match_date_text:
            try:
                match_date = parse_transaction_date(match_date_text, now, zone=client_zone)
            except InvalidTransactionTime:
                match_date = None
        candidates = [
            t for t in self.ledger.store.list_transactions(owner)
            if not t.deleted
            and (not match_description or match_description.casefold() in t.fields.description.casefold())
            and (match_date is None or t.fields.occurred.occurred_date == match_date)
        ]
        record_step(
            "Find matching transactions",
            f"Found {len(candidates)} matching transaction(s) in this account.",
            data={"matchCount": len(candidates)},
        )
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
        client_zone: ZoneInfo = LOCAL_ZONE,
    ) -> LedgerResult:
        start, end = self._range(classification, now, client_zone=client_zone)
        totals = self.ledger.store.aggregate(owner, start, end)
        category_expenses = self.ledger.store.category_totals(owner, start, end)
        matching_txs = [
            {
                "date": t.fields.occurred.occurred_date.isoformat(),
                "time": t.fields.occurred.occurred_time.strftime("%H:%M") if t.fields.occurred.occurred_time else None,
                "period": t.fields.occurred.period,
                "amount": str(t.fields.money.amount) if t.fields.money else "0",
                "direction": t.fields.direction,
                "category": t.fields.category,
                "description": t.fields.description,
            }
            for t in self.ledger.store.list_transactions(owner)
            if not t.deleted
            and t.fields.occurred.occurred_date is not None
            and start <= t.fields.occurred.occurred_date <= end
        ][:50]
        record_step(
            "Aggregate account totals",
            f"Read totals from {start.isoformat()} to {end.isoformat()} "
            f"({len(category_expenses)} categories, {len(matching_txs)} transactions).",
            data={
                "range": {"start": start.isoformat(), "end": end.isoformat()},
                "totals": totals,
                "categoryCount": len(category_expenses),
                "categories": category_expenses,
                "transactionCount": len(matching_txs),
            },
        )
        context = json.dumps({
            "question": text,
            "history": history,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "totals_vnd": totals,
            "category_expenses_vnd": category_expenses,
            "transactions": matching_txs,
        }, ensure_ascii=False)
        answer = self.model.call_function(
            "Answer the owner's finance question in natural Vietnamese using ONLY these owner-filtered totals, "
            "category expense breakdowns, and transaction details; do not invent transactions or claim to make "
            "changes. If no data matches their question, say so politely. "
            "When there are relevant transactions or spending details, ALWAYS include a clean Markdown table "
            "(e.g. columns: Ngày | Giờ | Mô tả | Danh mục | Số tiền) to present them clearly. Context: " + context,
            "answer_finance", _ANSWER_FIELDS,
        ).get("answer")
        if not isinstance(answer, str) or not 1 <= len(answer) <= 2000:
            raise InvalidProposal("Gemini returned an invalid read-only answer")
        record_step("Compose response", "Returned an answer using only account-scoped totals and transactions.")
        return LedgerResult({"kind": "qa", "message": answer, "start": start.isoformat(),
                             "end": end.isoformat(), "totals": totals,
                             "categories": category_expenses}, 200)

    @staticmethod
    def _range(
        classification: dict[str, object], now: datetime, client_zone: ZoneInfo = LOCAL_ZONE,
    ) -> tuple[date, date]:
        local = now.astimezone(client_zone).date()
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
                    parsed_start = parse_transaction_date(first, now, zone=client_zone)
                    parsed_end = parse_transaction_date(last, now, zone=client_zone)
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
            selected = parse_transaction_date(date_hint or None, now, zone=client_zone)
        except InvalidTransactionTime:
            selected = None  # An untrusted model hint must not turn a valid question into an error.
        return (selected, selected) if selected else (local.replace(day=1), local)
