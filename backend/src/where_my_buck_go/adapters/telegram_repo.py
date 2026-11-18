"""PostgreSQL storage for the owner's Telegram bot connection."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, insert, select, update
from sqlalchemy.engine import Engine

from where_my_buck_go.adapters.db import telegram_connections


@dataclass(frozen=True)
class TelegramConnection:
    owner_id: str
    encrypted_bot_token: bytes
    bot_username: str
    webhook_secret_digest: bytes
    pairing_code_digest: bytes
    pairing_expires_at: datetime
    telegram_chat_id: str | None
    app_chat_id: str | None
    connected_at: datetime


class PostgresTelegramStore:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def get(self, owner_id: str) -> TelegramConnection | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(telegram_connections).where(
                telegram_connections.c.owner_id == owner_id,
            )).mappings().first()
        return TelegramConnection(**row) if row else None

    def get_first(self) -> TelegramConnection | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(telegram_connections).limit(1)).mappings().first()
        return TelegramConnection(**row) if row else None

    def get_by_webhook_secret(self, digest: bytes) -> TelegramConnection | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(telegram_connections).where(
                telegram_connections.c.webhook_secret_digest == digest,
            )).mappings().first()
        return TelegramConnection(**row) if row else None

    def save(self, connection: TelegramConnection) -> None:
        values = {
            "encrypted_bot_token": connection.encrypted_bot_token,
            "bot_username": connection.bot_username,
            "webhook_secret_digest": connection.webhook_secret_digest,
            "pairing_code_digest": connection.pairing_code_digest,
            "pairing_expires_at": connection.pairing_expires_at,
            "telegram_chat_id": connection.telegram_chat_id,
            "app_chat_id": connection.app_chat_id,
            "connected_at": connection.connected_at,
        }
        with self.engine.begin() as conn:
            existing = conn.execute(select(telegram_connections.c.owner_id).where(
                telegram_connections.c.owner_id == connection.owner_id,
            )).first()
            if existing:
                conn.execute(update(telegram_connections).where(
                    telegram_connections.c.owner_id == connection.owner_id,
                ).values(**values))
            else:
                conn.execute(insert(telegram_connections).values(owner_id=connection.owner_id, **values))

    def pair(self, owner_id: str, telegram_chat_id: str, code_digest: bytes, now: datetime) -> bool:
        with self.engine.begin() as conn:
            result = conn.execute(update(telegram_connections).where(
                telegram_connections.c.owner_id == owner_id,
                telegram_connections.c.pairing_code_digest == code_digest,
                telegram_connections.c.pairing_expires_at >= now,
                telegram_connections.c.telegram_chat_id.is_(None),
            ).values(telegram_chat_id=telegram_chat_id, pairing_code_digest=b""))
        return result.rowcount == 1

    def replace_pairing_code(self, owner_id: str, code_digest: bytes, expires_at: datetime) -> bool:
        with self.engine.begin() as conn:
            result = conn.execute(update(telegram_connections).where(
                telegram_connections.c.owner_id == owner_id,
                telegram_connections.c.telegram_chat_id.is_(None),
            ).values(pairing_code_digest=code_digest, pairing_expires_at=expires_at))
        return result.rowcount == 1

    def update_app_chat(self, owner_id: str, app_chat_id: str) -> None:
        with self.engine.begin() as conn:
            conn.execute(update(telegram_connections).where(
                telegram_connections.c.owner_id == owner_id,
            ).values(app_chat_id=app_chat_id))

    def delete(self, owner_id: str) -> None:
        with self.engine.begin() as conn:
            conn.execute(delete(telegram_connections).where(telegram_connections.c.owner_id == owner_id))
