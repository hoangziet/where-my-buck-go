"""Clickable, owner-scoped Telegram commands and compact draft previews."""

import base64
import binascii
from uuid import UUID


def draft_command(action: str, proposal_id: str) -> str:
    prefix = {"confirm": "c", "discard": "d"}[action]
    code = base64.b32encode(UUID(proposal_id).bytes).decode("ascii").rstrip("=")
    return f"/{prefix}_{code}"


def parse_draft_command(text: str) -> tuple[str, str] | None:
    parts = text.split(maxsplit=1)
    if not parts:
        return None
    command = parts[0].split("@", maxsplit=1)[0]
    if len(command) != 29 or command[:3] not in ("/c_", "/d_"):
        return None
    try:
        identifier = str(UUID(bytes=base64.b32decode(command[3:] + "======", casefold=True)))
    except (ValueError, binascii.Error):
        return None
    return ("confirm" if command[1] == "c" else "discard", identifier)


def draft_preview(proposal: dict[str, object]) -> str:
    identifier = proposal.get("id")
    if not isinstance(identifier, str):
        raise ValueError("Draft ID is missing")
    amount = proposal.get("amount")
    amount_text = (
        f"{int(amount):,} VND".replace(",", ".")
        if isinstance(amount, str) and amount.isdigit() else "Missing"
    )
    direction = "Income" if proposal.get("direction") == "income" else "Expense"
    date = proposal.get("occurredDate") or "Date missing"
    time = proposal.get("occurredTime") or ""
    lines = [
        f"Draft: {proposal.get('description') or 'Untitled'}",
        f"{direction}: {amount_text}",
        f"Category: {proposal.get('category') or 'Other'}",
        f"Date: {date} {time}".rstrip(),
    ]
    if proposal.get("canConfirm") is True:
        lines.append(f"Confirm: {draft_command('confirm', identifier)}")
    else:
        lines.append("Complete the missing details in the app before confirming.")
    lines.append(f"Discard: {draft_command('discard', identifier)}")
    return "\n".join(lines)
