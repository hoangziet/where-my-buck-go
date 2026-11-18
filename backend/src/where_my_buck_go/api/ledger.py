"""Ledger HTTP boundary: validate transport shape and bind every request to the session owner."""

from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from typing import cast
from uuid import UUID

from flask import Blueprint, Response, g, request
from flask import jsonify as flask_jsonify
from werkzeug.exceptions import RequestEntityTooLarge

from where_my_buck_go.adapters.gemini import GeminiError
from where_my_buck_go.domain.image_preview import InvalidImagePreview
from where_my_buck_go.domain.ledger import InvalidProposal, LedgerFields, VersionConflict
from where_my_buck_go.domain.money import InvalidMoney, Money
from where_my_buck_go.domain.transaction_time import LOCAL_ZONE, InvalidTransactionTime, TransactionTime
from where_my_buck_go.services.chat import ChatService
from where_my_buck_go.services.debug_trace import capture_debug_trace, record_step
from where_my_buck_go.services.history import HistoryService
from where_my_buck_go.services.image import detect_mime, inspect_image
from where_my_buck_go.services.ledger import (
    IdempotencyConflict,
    LedgerResult,
    LedgerService,
    NotFound,
)

jsonify = cast(Callable[..., Response], flask_jsonify)


def ledger_blueprint(
    service: LedgerService, chat: ChatService | None = None, history: HistoryService | None = None,
) -> Blueprint:
    api = Blueprint("ledger", __name__, url_prefix="/api")

    def owner() -> str:
        return cast(str, g.session.user_id)

    def payload() -> dict[str, object]:
        value: object = request.get_json(silent=True)
        if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
            raise InvalidProposal("Request must be a JSON object")
        return value

    def version(value: dict[str, object], *, create: bool = False) -> int:
        expected = value.get("expectedVersion")
        if not isinstance(expected, int) or isinstance(expected, bool) or expected < 0 or (create and expected != 0):
            raise InvalidProposal("expectedVersion must be a nonnegative integer (0 for create)")
        return expected

    def key() -> str:
        raw = request.headers.get("Idempotency-Key", "")
        try:
            parsed = UUID(raw)
        except ValueError:
            raise InvalidProposal("Idempotency-Key must be a UUID") from None
        if str(parsed) != raw:
            raise InvalidProposal("Idempotency-Key must be a canonical UUID")
        return raw

    def result(value: LedgerResult) -> tuple[Response, int]:
        return jsonify(value.body), value.status

    @api.errorhandler(InvalidProposal)
    @api.errorhandler(InvalidImagePreview)
    @api.errorhandler(InvalidMoney)
    @api.errorhandler(InvalidTransactionTime)
    def bad_request(error: Exception) -> tuple[Response, int]:
        return jsonify(error=str(error)), 400

    @api.errorhandler(VersionConflict)
    @api.errorhandler(IdempotencyConflict)
    def conflict(error: Exception) -> tuple[Response, int]:
        return jsonify(error=str(error)), 409

    @api.errorhandler(NotFound)
    def not_found(error: NotFound) -> tuple[Response, int]:
        return jsonify(error="Not found"), 404

    @api.errorhandler(GeminiError)
    def ai_error(error: GeminiError) -> tuple[Response, int]:
        return jsonify(error=str(error)), 429 if "HTTP 429" in str(error) else 503

    @api.errorhandler(RequestEntityTooLarge)
    def image_too_large(error: RequestEntityTooLarge) -> tuple[Response, int]:
        return jsonify(error="Image request exceeds 4 MB limit"), 413

    @api.route("/proposals", methods=["POST"])
    def create() -> tuple[Response, int]:
        body = payload()
        version(body, create=True)
        return result(service.create(owner(), key(), body, datetime.now(timezone.utc)))

    @api.route("/proposals/changes", methods=["POST"])
    def propose_change() -> tuple[Response, int]:
        body = payload()
        if version(body) < 1 or not isinstance(body.get("targetId"), str):
            raise InvalidProposal("Target ID and a positive expectedVersion are required")
        return result(service.propose_change(owner(), key(), body, datetime.now(timezone.utc)))

    @api.route("/proposals/<identifier>", methods=["PATCH"])
    def amend(identifier: str) -> tuple[Response, int]:
        body = payload()
        if version(body) < 1:
            raise InvalidProposal("Draft expectedVersion must be positive")
        return result(service.amend(owner(), key(), identifier, body, datetime.now(timezone.utc)))

    @api.route("/proposals/<identifier>/confirm", methods=["POST"])
    def confirm(identifier: str) -> tuple[Response, int]:
        body = payload()
        if set(body) != {"expectedVersion"} or version(body) < 1:
            raise InvalidProposal("Confirm requires only a positive expectedVersion")
        return result(service.confirm(owner(), key(), identifier, version(body), datetime.now(timezone.utc)))

    @api.route("/proposals/<identifier>/discard", methods=["POST"])
    def discard(identifier: str) -> tuple[Response, int]:
        body = payload()
        if set(body) != {"expectedVersion"} or version(body) < 1:
            raise InvalidProposal("Discard requires only a positive expectedVersion")
        return result(service.discard(owner(), key(), identifier, version(body), datetime.now(timezone.utc)))

    @api.route("/proposals/<identifier>", methods=["GET"])
    def proposal(identifier: str) -> Response:
        return jsonify(service.proposal_details(owner(), identifier))

    @api.route("/proposals", methods=["GET"])
    def open_proposals() -> Response:
        return jsonify(items=service.open_proposals(owner()))

    @api.route("/transactions", methods=["GET"])
    def transactions() -> Response:
        return jsonify(items=service.list_transactions_with_evidence(owner()))

    @api.route("/reports/summary", methods=["GET"])
    def reports_summary() -> tuple[Response, int] | Response:
        try:
            months = int(request.args.get("months", "6"))
        except ValueError:
            raise InvalidProposal("months must be an integer") from None
        if not 1 <= months <= 24:
            raise InvalidProposal("months must be between 1 and 24")
        today = datetime.now(timezone.utc).astimezone(LOCAL_ZONE).date()
        end = today
        start_month = (end.month - months + 1 - 1) % 12 + 1
        start_year = end.year + (end.month - months + 1 - 1) // 12
        start = date(start_year, start_month, 1)
        return jsonify(service.summary(owner(), start, end))

    @api.route("/reports/dashboard", methods=["GET"])
    def dashboard_summary() -> Response:
        period = request.args.get("period", "month")
        if period not in ("week", "month"):
            raise InvalidProposal("period must be week or month")
        today = datetime.now(timezone.utc).astimezone(LOCAL_ZONE).date()
        start = today - timedelta(days=today.weekday()) if period == "week" else today.replace(day=1)
        return jsonify(service.dashboard_summary(owner(), start, today))

    @api.route("/transactions/<identifier>", methods=["GET"])
    def transaction(identifier: str) -> Response:
        return jsonify(service.transaction_details(owner(), identifier))

    @api.route("/evidence/<identifier>", methods=["GET"])
    def original_evidence(identifier: str) -> Response:
        record = service.store.read_evidence(owner(), identifier)
        if record is None:
            raise NotFound
        etag = f'"{record.digest.hex()}"'
        if_none_match = request.headers.get("If-None-Match")
        cache_control = "private, max-age=604800, immutable"
        if if_none_match and if_none_match.strip() == etag:
            response = Response(status=304)
            response.headers["ETag"] = etag
            response.headers["Cache-Control"] = cache_control
            return response
        kind, content = service.read_evidence(owner(), identifier)
        content_type = "text/plain; charset=utf-8" if kind == "text" else kind
        response = Response(content, content_type=content_type)
        response.headers["ETag"] = etag
        response.headers["Cache-Control"] = cache_control
        return response

    @api.route("/chat/messages", methods=["POST"])
    def chat_message() -> tuple[Response, int]:
        if chat is None:
            return jsonify(error="Gemini chat is not configured"), 503
        body = payload()
        if not set(body) <= {"text", "history", "expectedVersion", "chatId", "clientTimezone", "pendingProposalIds"}:
            raise InvalidProposal("Unexpected chat fields")
        version(body, create=True)
        text = body.get("text")
        chat_history = body.get("history", [])
        chat_id = body.get("chatId")
        client_timezone = body.get("clientTimezone")
        pending_ids = body.get("pendingProposalIds", [])
        if not isinstance(pending_ids, list) or not all(isinstance(item, str) for item in pending_ids):
            raise InvalidProposal("pendingProposalIds must be a list of draft IDs")
        if not isinstance(text, str) or not isinstance(chat_history, list):
            raise InvalidProposal("Chat text and history are required")
        if chat_id is not None and not isinstance(chat_id, str):
            raise InvalidProposal("chatId must be text")
        if client_timezone is not None and not isinstance(client_timezone, str):
            raise InvalidProposal("clientTimezone must be text")
        bounded: list[dict[str, str]] = []
        for item in chat_history:
            if (not isinstance(item, dict) or set(item) != {"role", "text"} or
                    not isinstance(item["role"], str) or not isinstance(item["text"], str)):
                raise InvalidProposal("History must contain role and text strings")
            bounded.append({"role": item["role"], "text": item["text"]})
        with capture_debug_trace() as trace:
            try:
                response = chat.respond(
                    owner(), key(), text, datetime.now(timezone.utc), bounded, chat_id,
                    client_timezone=client_timezone, pending_proposal_ids=pending_ids,
                )
            except GeminiError as error:
                status = 429 if "HTTP 429" in str(error) else 503
                return jsonify(error=str(error), debugTrace=trace.snapshot()), status
            except InvalidProposal as error:
                return jsonify(error=str(error), debugTrace=trace.snapshot()), 400
        return jsonify({**response.body, "debugTrace": trace.snapshot()}), response.status

    @api.route("/chats", methods=["GET"])
    def chats() -> tuple[Response, int]:
        if history is None:
            return jsonify(error="Chat history is not configured"), 503
        return jsonify(items=history.chats(owner())), 200

    @api.route("/chats/<identifier>/messages", methods=["GET"])
    def chat_history_messages(identifier: str) -> tuple[Response, int]:
        if history is None:
            return jsonify(error="Chat history is not configured"), 503
        messages = history.messages(owner(), identifier)
        if messages is None:
            raise NotFound
        return jsonify(items=messages), 200

    @api.route("/chats/<identifier>", methods=["PATCH"])
    def rename_chat(identifier: str) -> tuple[Response, int]:
        if history is None:
            return jsonify(error="Chat history is not configured"), 503
        body = payload()
        title = body.get("title")
        if not isinstance(title, str) or not title.strip() or len(title.strip()) > 200:
            raise InvalidProposal("title must be between 1 and 200 characters")
        if not history.rename_chat(owner(), identifier, title.strip()):
            raise NotFound
        return jsonify(id=identifier, title=title.strip()), 200

    @api.route("/chats/<identifier>", methods=["DELETE"])
    def delete_chat(identifier: str) -> tuple[Response, int]:
        if history is None:
            return jsonify(error="Chat history is not configured"), 503
        if not history.delete_chat(owner(), identifier):
            raise NotFound
        return jsonify(deleted=True), 200

    @api.route("/chat/pins", methods=["POST"])
    def create_pin() -> tuple[Response, int]:
        if history is None:
            return jsonify(error="Chat history is not configured"), 503
        body = payload()
        title, start_text, end_text = body.get("title"), body.get("start"), body.get("end")
        if not isinstance(title, str) or not isinstance(start_text, str) or not isinstance(end_text, str):
            raise InvalidProposal("title, start and end are required")
        try:
            start, end = date.fromisoformat(start_text), date.fromisoformat(end_text)
        except ValueError:
            raise InvalidProposal("start and end must be YYYY-MM-DD") from None
        if end < start:
            raise InvalidProposal("end must not be before start")
        return jsonify(history.pin(owner(), title, start, end, datetime.now(timezone.utc))), 201

    @api.route("/chat/pins", methods=["GET"])
    def list_pins() -> tuple[Response, int]:
        if history is None:
            return jsonify(error="Chat history is not configured"), 503
        return jsonify(items=history.pins(owner())), 200

    @api.route("/chat/pins/<identifier>", methods=["DELETE"])
    def delete_pin(identifier: str) -> tuple[Response, int]:
        if history is None:
            return jsonify(error="Chat history is not configured"), 503
        if not history.unpin(owner(), identifier):
            raise NotFound
        return jsonify(ok=True), 200

    @api.route("/chat/image-intake", methods=["POST"])
    def image_intake() -> tuple[Response, int]:
        if chat is None:
            return jsonify(error="Gemini chat is not configured"), 503
        if set(request.files) != {"image"} or not set(request.form) <= {"caption", "chatId", "clientTimezone"}:
            raise InvalidProposal("One PNG or JPEG image is required")
        caption = request.form.get("caption", "").strip()
        chat_id = (request.form.get("chatId") or "").strip() or None
        client_timezone = (request.form.get("clientTimezone") or "").strip() or None
        if len(caption) > 500:
            raise InvalidProposal("Caption must be at most 500 characters")
        if chat_id is not None and not isinstance(chat_id, str):
            raise InvalidProposal("chatId must be text")
        if client_timezone is not None and len(client_timezone) > 100:
            raise InvalidProposal("clientTimezone must be at most 100 characters")
        idempotency_key = key()
        raw = request.files["image"].read(4_000_001)
        with capture_debug_trace() as trace:
            try:
                mime = detect_mime(raw)
                preview = inspect_image(chat.model, raw, caption or None)
            except GeminiError as error:
                status = 429 if "HTTP 429" in str(error) else 503
                return jsonify(error=str(error), debugTrace=trace.snapshot()), status
            except ValueError as error:
                return jsonify(error=str(error), debugTrace=trace.snapshot()), 400
            record_step(
                "Read receipt image",
                "Extracted amount, date, time, and category for review.",
                data={"amount": str(preview.amount), "category": preview.category, "description": preview.description},
            )
            fields = LedgerFields(
                Money(preview.amount, "VND"), "expense", preview.description,
                TransactionTime(preview.occurred_date, preview.occurred_time, preview.period, "explicit"),
                preview.category,
            )
            draft = service.create_from_image(owner(), idempotency_key, fields, raw, mime, datetime.now(timezone.utc))
            record_step(
                "Prepare draft",
                "Created a review card; no transaction is confirmed.",
                data={"draftId": draft.body.get("id"), "amount": str(preview.amount)},
            )

        actual_chat_id: str | None = None
        if history is not None:
            now = datetime.now(timezone.utc)
            title_hint = caption or (preview.description if hasattr(preview, "description") else "") or "Hóa đơn"
            actual_chat_id = history.start_or_continue(owner(), chat_id, title_hint, now)
            user_msg = caption if caption else f"[Hóa đơn: {preview.description}]"
            assistant_msg = "Đã tạo bản nháp từ ảnh; cần xác nhận riêng."
            evidence_ids = draft.body.get("evidenceIds")
            user_evidence_id = (evidence_ids[0] if isinstance(evidence_ids, list) and evidence_ids
                                and isinstance(evidence_ids[0], str) else None)
            history.record_exchange(
                owner(), actual_chat_id, user_msg, assistant_msg, now,
                debug_trace=trace.snapshot(),
                user_evidence_id=user_evidence_id,
            )

        return jsonify(kind="image_intake", proposal=draft.body,
                       chatId=actual_chat_id,
                       message="Đã tạo bản nháp từ ảnh; cần xác nhận riêng.",
                       debugTrace=trace.snapshot()), draft.status

    return api
