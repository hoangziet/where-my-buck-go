"""Personal Telegram bot connection and webhook endpoints."""

import hashlib
import hmac
import secrets
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any, cast
from uuid import NAMESPACE_URL, uuid5

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from flask import Blueprint, Response, current_app, g, request
from flask import jsonify as flask_jsonify
from sqlalchemy.engine import Engine

from where_my_buck_go.adapters.gemini import GeminiError
from where_my_buck_go.adapters.telegram_format import has_markdown_table, telegram_text_fallback
from where_my_buck_go.adapters.telegram_repo import PostgresTelegramStore, TelegramConnection
from where_my_buck_go.services.chat import ChatService
from where_my_buck_go.services.history import HistoryService
from where_my_buck_go.services.ledger import LedgerService, NotFound

jsonify = cast(Callable[..., Response], flask_jsonify)


def telegram_blueprint(
    engine: Engine,
    chat: ChatService | None,
    history: HistoryService | None,
    ledger: LedgerService,
    encryption_key: bytes,
) -> Blueprint:
    api = Blueprint("telegram", __name__, url_prefix="/api")
    store = PostgresTelegramStore(engine)
    cipher = AESGCM(hashlib.sha256(b"wmbg-telegram-token:" + encryption_key).digest())

    def owner() -> str:
        return cast(str, g.session.user_id)

    def encrypt(value: str) -> bytes:
        nonce = secrets.token_bytes(12)
        return nonce + cipher.encrypt(nonce, value.encode("utf-8"), b"telegram-bot-token")

    def decrypt(value: bytes) -> str:
        return cipher.decrypt(value[:12], value[12:], b"telegram-bot-token").decode("utf-8")

    def telegram_call(token: str, method: str, payload: dict[str, object] | None = None) -> dict[str, Any]:
        response = httpx.post(f"https://api.telegram.org/bot{token}/{method}", json=payload or {}, timeout=15)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict) or not data.get("ok"):
            raise ValueError("Telegram rejected the request")
        result = data.get("result")
        return result if isinstance(result, dict) else {}

    @api.route("/settings/telegram", methods=["GET"])
    def get_connection() -> Response:
        connection = store.get(owner())
        return jsonify(connected=bool(connection), botUsername=connection.bot_username if connection else None,
                       paired=bool(connection and connection.telegram_chat_id))

    @api.route("/settings/telegram", methods=["POST"])
    def connect() -> tuple[Response, int] | Response:
        body = request.get_json(silent=True)
        token = body.get("botToken") if isinstance(body, dict) else None
        if not isinstance(token, str) or not 20 <= len(token) <= 256 or ":" not in token:
            return jsonify(error="Enter a valid Telegram bot token."), 400
        try:
            bot = telegram_call(token, "getMe")
            username = bot.get("username")
            if not isinstance(username, str) or not username:
                return jsonify(error="Telegram did not return a bot username."), 400
            webhook_secret = secrets.token_urlsafe(32)
            pairing_code = secrets.token_urlsafe(9)
            expires = datetime.now(timezone.utc) + timedelta(minutes=15)
            endpoint = f"{request.scheme}://{request.host}/api/integrations/telegram/webhook"
            telegram_call(token, "setWebhook", {"url": endpoint, "secret_token": webhook_secret,
                                                     "allowed_updates": ["message"]})
        except (httpx.HTTPError, ValueError):
            return jsonify(error="Could not connect to Telegram. Check the bot token and try again."), 400
        connection = TelegramConnection(
            owner_id=owner(), encrypted_bot_token=encrypt(token), bot_username=username,
            webhook_secret_digest=hashlib.sha256(webhook_secret.encode()).digest(),
            pairing_code_digest=hashlib.sha256(pairing_code.encode()).digest(), pairing_expires_at=expires,
            telegram_chat_id=None, app_chat_id=None, connected_at=datetime.now(timezone.utc),
        )
        store.save(connection)
        return jsonify(connected=True, botUsername=username, pairingCode=pairing_code,
                       pairingExpiresAt=expires.isoformat()), 201

    @api.route("/settings/telegram", methods=["DELETE"])
    def disconnect() -> Response:
        connection = store.get(owner())
        if connection:
            try:
                telegram_call(decrypt(connection.encrypted_bot_token), "deleteWebhook")
            except (httpx.HTTPError, ValueError):
                pass
            store.delete(owner())
        return jsonify(disconnected=True)

    @api.route("/settings/telegram/pairing", methods=["POST"])
    def new_pairing_code() -> tuple[Response, int] | Response:
        pairing_code = secrets.token_urlsafe(9)
        expires = datetime.now(timezone.utc) + timedelta(minutes=15)
        digest = hashlib.sha256(pairing_code.encode()).digest()
        if not store.replace_pairing_code(owner(), digest, expires):
            return jsonify(error="Connect a bot that has not been paired yet."), 409
        connection = store.get(owner())
        return jsonify(botUsername=connection.bot_username if connection else None,
                       pairingCode=pairing_code, pairingExpiresAt=expires.isoformat())

    @api.route("/integrations/telegram/webhook", methods=["POST"])
    def webhook() -> tuple[Response, int] | Response:
        raw_secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if not raw_secret:
            return jsonify(error="Unauthorized"), 401
        secret_digest = hashlib.sha256(raw_secret.encode()).digest()
        connection = store.get_by_webhook_secret(secret_digest)
        if connection is None:
            return jsonify(error="Unauthorized"), 401
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify(ok=True)
        message = payload.get("message")
        if not isinstance(message, dict):
            return jsonify(ok=True)
        sender = message.get("chat")
        text = message.get("text")
        update_id = payload.get("update_id")
        if (not isinstance(sender, dict) or sender.get("type") != "private" or
                not isinstance(sender.get("id"), (str, int))):
            return jsonify(ok=True)
        telegram_chat_id = str(sender["id"])
        token = decrypt(connection.encrypted_bot_token)
        if not connection.telegram_chat_id:
            command = text.strip().split(maxsplit=1) if isinstance(text, str) else []
            pairing_digest = hashlib.sha256(command[1].encode()).digest() if len(command) == 2 else b""
            if (len(command) != 2 or command[0] != "/connect" or
                    not hmac.compare_digest(connection.pairing_code_digest,
                                             pairing_digest) or
                    datetime.now(timezone.utc) > connection.pairing_expires_at):
                telegram_call(token, "sendMessage", {
                    "chat_id": telegram_chat_id,
                    "text": (
                        "Open app Settings, connect your personal bot, then send /connect "
                        "followed by the pairing code."
                    ),
                })
                return jsonify(ok=True)
            if not store.pair(connection.owner_id, telegram_chat_id, pairing_digest, datetime.now(timezone.utc)):
                telegram_call(token, "sendMessage", {
                    "chat_id": telegram_chat_id,
                    "text": "Pairing code expired or already used. Generate a new one in app Settings.",
                })
                return jsonify(ok=True)
            telegram_call(token, "sendMessage", {"chat_id": telegram_chat_id,
                          "text": "Telegram is connected. You can now send expense notes here."})
            return jsonify(ok=True)
        if isinstance(text, str) and text.startswith("/connect"):
            telegram_call(token, "sendMessage", {"chat_id": telegram_chat_id,
                          "text": "This private chat is already connected to your app."})
            return jsonify(ok=True)
        if telegram_chat_id != connection.telegram_chat_id or not isinstance(text, str):
            return jsonify(ok=True)
        if not isinstance(update_id, int):
            return jsonify(ok=True)
        if chat is None or history is None:
            telegram_call(token, "sendMessage", {"chat_id": telegram_chat_id, "text": "Chat is not configured."})
            return jsonify(ok=True)

        now = datetime.now(timezone.utc)
        if text.startswith("/confirm "):
            proposal_id = text.split(maxsplit=1)[1].strip()
            try:
                proposal = ledger.proposal_details(connection.owner_id, proposal_id)
                if proposal.get("state") == "confirmed":
                    message_text = "This transaction was already confirmed."
                elif proposal.get("state") != "draft" or not isinstance(proposal.get("version"), int):
                    message_text = "This draft is no longer available to confirm."
                else:
                    version = proposal.get("version")
                    if not isinstance(version, int):
                        raise ValueError("Draft version is invalid")
                    result = ledger.confirm(connection.owner_id, str(uuid5(NAMESPACE_URL, f"tg:{update_id}")),
                                            proposal_id, version, now)
                    message_text = "Transaction confirmed." if result.status < 300 else "Could not confirm this draft."
            except (NotFound, ValueError, TypeError):
                message_text = "Draft not found or it cannot be confirmed. Review it in the app."
            telegram_call(token, "sendMessage", {"chat_id": telegram_chat_id, "text": message_text})
            return jsonify(ok=True)
        if text.startswith("/discard "):
            proposal_id = text.split(maxsplit=1)[1].strip()
            try:
                proposal = ledger.proposal_details(connection.owner_id, proposal_id)
                if proposal.get("state") == "discarded":
                    message_text = "This draft was already discarded."
                elif proposal.get("state") != "draft" or not isinstance(proposal.get("version"), int):
                    message_text = "This draft is no longer available to discard."
                else:
                    version = proposal.get("version")
                    if not isinstance(version, int):
                        raise ValueError("Draft version is invalid")
                    ledger.discard(connection.owner_id, str(uuid5(NAMESPACE_URL, f"tg:{update_id}")),
                                   proposal_id, version, now)
                    message_text = "Draft discarded."
            except (NotFound, ValueError, TypeError):
                message_text = "Draft not found."
            telegram_call(token, "sendMessage", {"chat_id": telegram_chat_id, "text": message_text})
            return jsonify(ok=True)

        previous = history.messages(connection.owner_id, connection.app_chat_id) if connection.app_chat_id else []
        context: list[dict[str, str]] = []
        for item in (previous or [])[-8:]:
            role, previous_text = item.get("role"), item.get("text")
            if isinstance(role, str) and role in ("user", "assistant") and isinstance(previous_text, str):
                context.append({"role": role, "text": previous_text})
        pending_ids: list[str] = []
        for item in ledger.open_proposals(connection.owner_id):
            draft_id = item.get("id")
            if item.get("state") == "draft" and isinstance(draft_id, str):
                pending_ids.append(draft_id)
        pending_ids = pending_ids[-5:]
        try:
            result = chat.respond(connection.owner_id, str(uuid5(NAMESPACE_URL, f"tg:{update_id}")), text,
                                  now, context, connection.app_chat_id,
                                  pending_proposal_ids=pending_ids)
            response_text = result.body.get("message")
            chat_id = result.body.get("chatId")
            if isinstance(chat_id, str):
                store.update_app_chat(connection.owner_id, chat_id)
            if isinstance(response_text, str):
                proposals = result.body.get("proposals")
                if not isinstance(proposals, list) and isinstance(result.body.get("proposal"), dict):
                    proposals = [result.body["proposal"]]
                if isinstance(proposals, list):
                    commands = [f"/confirm {item['id']} · /discard {item['id']}" for item in proposals
                                if isinstance(item, dict) and isinstance(item.get("id"), str)]
                    if commands:
                        response_text += (
                            "\n\nReview each draft in the app. Confirm or discard individually:\n"
                            + "\n".join(commands)
                        )
            else:
                response_text = "I could not process that message. Please try again."
        except GeminiError as error:
            response_text = str(error)
        except Exception as error:
            current_app.logger.error("Telegram message processing failed: %s", type(error).__name__)
            response_text = "Something went wrong while processing this message. Please try again later."
        if has_markdown_table(response_text):
            try:
                telegram_call(token, "sendRichMessage", {
                    "chat_id": telegram_chat_id,
                    "rich_message": {"markdown": response_text[:16000]},
                })
            except httpx.HTTPStatusError as error:
                if error.response.status_code not in (400, 404):
                    raise
                telegram_call(token, "sendMessage", {
                    "chat_id": telegram_chat_id,
                    "text": telegram_text_fallback(response_text)[:4000],
                })
        else:
            telegram_call(token, "sendMessage", {"chat_id": telegram_chat_id, "text": response_text[:4000]})
        return jsonify(ok=True)

    return api
