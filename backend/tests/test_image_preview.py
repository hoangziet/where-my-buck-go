"""Untrusted receipt extraction requires explicit payment date and time."""

from decimal import Decimal
from pathlib import Path

import pytest

from where_my_buck_go.domain.image_preview import InvalidImagePreview, validate_image_preview
from where_my_buck_go.gemini_image_smoke import image_data

RECEIPT: dict[str, object] = {
    "amount": "17500", "currency": "VND", "occurred_date": "2026-11-09",
    "occurred_time": "18:36", "description": "Nap data", "status": "success", "direction": "expense",
    "category": "bills",
}


def test_validated_preview_uses_receipt_time_and_exact_money() -> None:
    result = validate_image_preview(RECEIPT)
    assert result.amount == Decimal("17500")
    assert result.occurred_date.isoformat() == "2026-11-09"
    assert result.occurred_time.strftime("%H:%M") == "18:36"
    assert result.period == "tối"


@pytest.mark.parametrize("field,value", [
    ("amount", "17.5"), ("amount", "-17500"), ("amount", "0"),
    ("currency", "USD"), ("occurred_date", ""), ("occurred_date", "2026-02-30"),
    ("occurred_time", ""), ("occurred_time", "24:00"), ("occurred_time", "25:00"),
    ("description", "Nap data 0123456789"), ("status", "failed"), ("direction", "income"),
    ("category", "unknown"),
])
def test_rejects_untrusted_fields(field: str, value: str) -> None:
    with pytest.raises(InvalidImagePreview):
        validate_image_preview({**RECEIPT, field: value})


def test_file_magic_not_extension(tmp_path: Path) -> None:
    image = tmp_path / "screenshot.jpg"
    image.write_bytes(b"\x89PNG\r\n\x1a\n" + b"data")
    _, mime_type = image_data(image)
    assert mime_type == "image/png"
