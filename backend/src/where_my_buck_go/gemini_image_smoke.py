"""Local read-only image smoke test; no evidence upload or transaction write."""

import argparse
import os
from datetime import date, time
from pathlib import Path

from where_my_buck_go.adapters.gemini import DEFAULT_MODEL, GeminiClient, GeminiError
from where_my_buck_go.domain.image_preview import InvalidImagePreview
from where_my_buck_go.services.image import inspect_image


def image_data(path: Path) -> tuple[bytes, str]:
    with path.open("rb") as source:
        raw = source.read(4_000_001)
    if not raw or len(raw) > 4_000_000:
        raise ValueError("Image must be nonempty and at most 4 MB")
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return raw, "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        return raw, "image/jpeg"
    raise ValueError("Only actual PNG or JPEG files are accepted")


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a receipt image with Gemini without saving it")
    parser.add_argument("image", type=Path)
    parser.add_argument("--expect-amount", help="Optional expected integer VND amount")
    parser.add_argument("--expect-date", help="Optional expected YYYY-MM-DD date")
    parser.add_argument("--expect-time", help="Optional expected HH:MM payment time")
    args = parser.parse_args()
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        parser.error("Set GEMINI_API_KEY in the local environment")
    try:
        image, _ = image_data(args.image)
        preview = inspect_image(GeminiClient(key, os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)), image)
    except (GeminiError, InvalidImagePreview, ValueError, OSError) as error:
        raise SystemExit(f"Image preview failed: {error}") from None
    if ((args.expect_amount is not None and str(preview.amount) != args.expect_amount) or
            (args.expect_date is not None and preview.occurred_date != date.fromisoformat(args.expect_date)) or
            (args.expect_time is not None and preview.occurred_time != time.fromisoformat(args.expect_time))):
        raise SystemExit("Image preview disagrees with expected values; no transaction created")
    print(f"Image preview validated ({preview.period}); no transaction created or stored")
