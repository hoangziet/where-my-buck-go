"""The Gemini SDK boundary validates tool calls and retries transient failures."""

from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from google import genai
from google.genai import errors, types

from where_my_buck_go.adapters import gemini
from where_my_buck_go.adapters.gemini import GeminiClient, GeminiError

SCHEMA: dict[str, object] = {"type": "OBJECT", "properties": {"kind": {"type": "STRING"}}}


class FakeModels:
    def __init__(self, response: object = None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def generate_content(self, **kwargs: Any) -> object:
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.response


def fake_sdk(monkeypatch: pytest.MonkeyPatch, models: FakeModels, captured: list[dict[str, object]]) -> None:
    class FakeClient:
        def __init__(self, **kwargs: object) -> None:
            captured.append(kwargs)
            self.models = models

    monkeypatch.setattr(gemini.genai, "Client", FakeClient)


def function_response(args: object, name: str = "classify_message") -> object:
    return SimpleNamespace(function_calls=[SimpleNamespace(name=name, args=args)])


def test_sdk_forces_the_requested_function_and_configures_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    models = FakeModels(function_response({"kind": "greeting"}))
    client_config: list[dict[str, object]] = []
    fake_sdk(monkeypatch, models, client_config)

    result = GeminiClient("dummy-secret", "gemini-3.1-flash-lite").call_function(
        "Xin chào", "classify_message", SCHEMA,
    )

    assert result == {"kind": "greeting"}
    assert len(models.calls) == 1
    options = client_config[0]["http_options"]
    assert options.timeout == 20_000  # type: ignore[attr-defined]
    retry = options.retry_options  # type: ignore[attr-defined]
    assert retry.attempts == 3
    assert retry.http_status_codes == [408, 429, 500, 502, 503, 504]
    config = models.calls[0]["config"]
    call_config = config.tool_config.function_calling_config  # type: ignore[attr-defined]
    assert call_config.mode == "ANY"
    assert call_config.allowed_function_names == ["classify_message"]
    assert models.calls[0]["model"] == "gemini-3.1-flash-lite"
    assert "dummy-secret" not in repr(models.calls[0])


def test_official_sdk_retries_http_504_before_returning_a_function_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_count = 0

    def respond(_request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        if request_count < 3:
            return httpx.Response(504, json={"error": {"message": "temporary provider failure"}})
        return httpx.Response(200, json={
            "candidates": [{
                "content": {
                    "parts": [{"functionCall": {"name": "classify_message", "args": {"kind": "greeting"}}}],
                    "role": "model",
                },
                "finishReason": "STOP",
                "index": 0,
            }],
        })

    original_factory = gemini.genai.Client

    def client_with_mock_transport(**kwargs: object) -> genai.Client:
        options = kwargs["http_options"]
        assert isinstance(options, types.HttpOptions)
        retry = options.retry_options
        assert retry is not None
        retry_options = types.HttpRetryOptions(
            attempts=retry.attempts,
            initial_delay=0,
            max_delay=0,
            jitter=0,
            http_status_codes=retry.http_status_codes,
        )
        http_client = httpx.Client(transport=httpx.MockTransport(respond))
        return original_factory(
            api_key=str(kwargs["api_key"]),
            http_options=types.HttpOptions(
                timeout=options.timeout,
                retry_options=retry_options,
                httpx_client=http_client,
            ),
        )

    monkeypatch.setattr(gemini.genai, "Client", client_with_mock_transport)
    client = GeminiClient("dummy-secret")
    try:
        result = client.call_function("Xin chào", "classify_message", SCHEMA)
    finally:
        client._client.close()

    assert result == {"kind": "greeting"}
    assert request_count == 3


@pytest.mark.parametrize("response", [
    SimpleNamespace(function_calls=None),
    function_response({"kind": "greeting"}, "unexpected_function"),
    function_response("invalid args"),
])
def test_rejects_invalid_model_output(monkeypatch: pytest.MonkeyPatch, response: object) -> None:
    models = FakeModels(response)
    fake_sdk(monkeypatch, models, [])
    with pytest.raises(GeminiError):
        GeminiClient("dummy-secret").call_function("Xin chào", "classify_message", SCHEMA)


def test_provider_error_does_not_leak_body_or_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    private_error = errors.APIError(429, {"error": {"message": "private provider body"}})
    models = FakeModels(error=private_error)
    fake_sdk(monkeypatch, models, [])
    with pytest.raises(GeminiError, match="HTTP 429") as error:
        GeminiClient("dummy-secret").call_function("Xin chào", "classify_message", SCHEMA)
    assert "private" not in str(error.value)
    assert "dummy-secret" not in str(error.value)


def test_transport_error_is_sanitized(monkeypatch: pytest.MonkeyPatch) -> None:
    models = FakeModels(error=httpx.ConnectError("private network detail"))
    fake_sdk(monkeypatch, models, [])
    with pytest.raises(GeminiError, match="unreachable") as error:
        GeminiClient("dummy-secret").call_function("Xin chào", "classify_message", SCHEMA)
    assert "private network detail" not in str(error.value)


def test_model_name_cannot_inject_url_path() -> None:
    with pytest.raises(ValueError):
        GeminiClient("dummy-secret", "../wrong-model")


def test_image_is_passed_as_inline_sdk_part(monkeypatch: pytest.MonkeyPatch) -> None:
    models = FakeModels(function_response({"kind": "greeting"}))
    fake_sdk(monkeypatch, models, [])
    GeminiClient("dummy-secret").call_function(
        "Read image", "classify_message", SCHEMA, image=b"\x89PNG\r\n\x1a\n", mime_type="image/png",
    )
    parts = models.calls[0]["contents"]
    assert parts[0].text == "Read image"
    assert parts[1].inline_data.mime_type == "image/png"
    assert parts[1].inline_data.data == b"\x89PNG\r\n\x1a\n"


def test_rejects_unsupported_image_before_network(monkeypatch: pytest.MonkeyPatch) -> None:
    models = FakeModels(function_response({"kind": "greeting"}))
    fake_sdk(monkeypatch, models, [])
    client = GeminiClient("dummy-secret")
    with pytest.raises(ValueError):
        client.call_function("Read image", "classify_message", SCHEMA, image=b"example", mime_type="image/gif")
    assert models.calls == []
