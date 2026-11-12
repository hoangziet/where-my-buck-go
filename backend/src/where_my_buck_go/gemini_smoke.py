"""Local-only Gemini connectivity check using harmless text and no business writes."""

import os

from where_my_buck_go.adapters.gemini import DEFAULT_MODEL, GeminiClient, GeminiError


def main() -> None:
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        raise SystemExit("Set GEMINI_API_KEY in your local environment before running the smoke test")
    model = os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)
    client = GeminiClient(key, model)
    parameters: dict[str, object] = {
        "type": "OBJECT",
        "properties": {"kind": {"type": "STRING", "enum": ["greeting", "expense"]}},
        "required": ["kind"],
    }
    try:
        args = client.call_function("Phân loại câu này: Xin chào bạn.", "classify_message", parameters)
    except GeminiError as error:
        raise SystemExit(str(error)) from None
    if set(args) != {"kind"} or args["kind"] != "greeting":
        raise SystemExit("Gemini responded, but its classification did not pass local validation")
    print(f"Gemini structured function call OK: {model} (no transaction created)")
