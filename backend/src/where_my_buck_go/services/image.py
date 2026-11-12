"""Read-only image inspection. A preview cannot create or confirm a transaction."""

from where_my_buck_go.domain.image_preview import ImagePreview, validate_image_preview
from where_my_buck_go.services.chat import ChatModel

IMAGE_PROMPT = (
    "Read the attached Vietnamese payment detail screenshot. Extract only the transaction total "
    "(unsigned decimal digits in VND), date and precise time from 'Thời gian thanh toán' or the receipt "
    "itself. Ignore the phone status bar clock and upload time. If a field is absent, return an empty "
    "string; do not guess. One image is one total expense, not line items. Do not include phone numbers "
    "or transaction IDs in the description. Assign exactly one category from: food_drink, transport, bills, "
    "shopping, entertainment, housing, income, other. The function is a read-only preview; do not claim to "
    "save anything."
)
IMAGE_FIELDS: dict[str, object] = {
    "type": "OBJECT", "properties": {
        "amount": {"type": "STRING"}, "currency": {"type": "STRING"},
        "occurred_date": {"type": "STRING", "description": "YYYY-MM-DD, empty when missing"},
        "occurred_time": {"type": "STRING", "description": "HH:MM in 24-hour time, empty when missing"},
        "description": {"type": "STRING", "description": "Short merchant or purchase name, no identifiers"},
        "status": {"type": "STRING", "enum": ["success", "failed", "unknown"]},
        "direction": {"type": "STRING", "enum": ["expense", "income", "unknown"]},
        "category": {"type": "STRING", "enum": ["food_drink", "transport", "bills", "shopping",
                                                  "entertainment", "housing", "income", "other"]},
    },
    "required": ["amount", "currency", "occurred_date", "occurred_time", "description", "status", "direction",
                 "category"],
}


def detect_mime(raw: bytes) -> str:
    if not raw or len(raw) > 4_000_000:
        raise ValueError("Image must be nonempty and at most 4 MB")
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    raise ValueError("Only actual PNG or JPEG files are accepted")


def inspect_image(model: ChatModel, raw: bytes, caption: str | None = None) -> ImagePreview:
    mime_type = detect_mime(raw)
    prompt = IMAGE_PROMPT
    if caption:
        prompt += (
            " The owner also wrote this caption alongside the image: " + caption +
            ". Use it only to clarify the merchant or category; always trust the receipt's own "
            "amount, date and time over the caption."
        )
    args = model.call_function(prompt, "preview_payment_image", IMAGE_FIELDS, image=raw, mime_type=mime_type)
    return validate_image_preview(args)
