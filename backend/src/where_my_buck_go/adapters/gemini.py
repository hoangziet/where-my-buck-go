"""Gemini adapter backed by the official google-genai SDK. A function call is data, never an executable command."""

import re
from typing import cast

import httpx
from google import genai
from google.genai import errors, types

DEFAULT_MODEL = "gemini-3.1-flash-lite"
_MODEL_NAME = re.compile(r"[a-zA-Z0-9_.-]+\Z")
_MAX_IMAGE_BYTES = 4_000_000
_TIMEOUT_MS = 20_000


class GeminiError(Exception):
    """A safe-to-display status without API keys, prompts, or provider response bodies."""


class GeminiClient:
    def __init__(self, api_key: str, model: str = DEFAULT_MODEL) -> None:
        if not api_key:
            raise ValueError("GEMINI_API_KEY is required")
        if not _MODEL_NAME.fullmatch(model):
            raise ValueError("Invalid Gemini model name")
        self.model = model
        self._client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                timeout=_TIMEOUT_MS,
                retry_options=types.HttpRetryOptions(
                    attempts=3,
                    initial_delay=0.5,
                    max_delay=2.0,
                    http_status_codes=[408, 429, 500, 502, 503, 504],
                ),
            ),
        )

    def call_function(
        self, prompt: str, name: str, parameters: dict[str, object],
        *, image: bytes | None = None, mime_type: str | None = None,
    ) -> dict[str, object]:
        """Request exactly one function call; never execute it or trust its arguments."""
        if not prompt or len(prompt) > 10_000 or not _MODEL_NAME.fullmatch(name):
            raise ValueError("Invalid prompt or function name")
        if (image is None) != (mime_type is None):
            raise ValueError("Image and MIME type must be provided together")
        if image is not None and (not image or len(image) > _MAX_IMAGE_BYTES or
                                  mime_type not in ("image/png", "image/jpeg")):
            raise ValueError("Only PNG and JPEG images up to 4 MB are supported")
        parts = [types.Part.from_text(text=prompt)]
        if image is not None and mime_type is not None:
            parts.append(types.Part.from_bytes(data=image, mime_type=mime_type))
        declaration = types.FunctionDeclaration(
            name=name, description="Return structured information for validation, without taking any action.",
            parameters=cast(types.Schema, parameters),
        )
        config = types.GenerateContentConfig(
            tools=[types.Tool(function_declarations=[declaration])],
            tool_config=types.ToolConfig(function_calling_config=types.FunctionCallingConfig(
                mode=types.FunctionCallingConfigMode.ANY, allowed_function_names=[name],
            )),
            temperature=0,
        )
        try:
            response = self._client.models.generate_content(model=self.model, contents=parts, config=config)
        except errors.APIError as error:
            raise GeminiError(
                f"Gemini returned HTTP {error.code} after retrying temporary failures"
            ) from None
        except httpx.TransportError:
            raise GeminiError("Gemini is unreachable after retrying temporary failures") from None
        return self._function_args(response, name)

    @staticmethod
    def _function_args(response: types.GenerateContentResponse, name: str) -> dict[str, object]:
        calls = response.function_calls
        if not calls or len(calls) != 1 or calls[0].name != name:
            raise GeminiError("Gemini returned a different or missing function call")
        args = calls[0].args
        if not isinstance(args, dict) or not all(isinstance(key, str) for key in args):
            raise GeminiError("Gemini returned invalid function arguments")
        return args
