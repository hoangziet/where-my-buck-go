"""Google OAuth 2.0 adapter."""

import json
import os
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlencode

import httpx

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"


class GoogleAuthError(Exception):
    """Failure communicating with Google OAuth service."""


class GoogleAuthClient:
    def __init__(
        self,
        client_id: str = "",
        client_secret: str = "",
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.client_id = client_id.strip()
        self.client_secret = client_secret.strip()
        self.transport = transport

    @property
    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def get_authorization_url(self, redirect_uri: str, state: str) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "prompt": "select_account",
            "access_type": "online",
        }
        return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"

    def exchange_code(self, code: str, redirect_uri: str) -> dict[str, Any]:
        """Exchanges an authorization code for user profile information."""
        try:
            with httpx.Client(transport=self.transport, timeout=10.0) as client:
                resp = client.post(
                    GOOGLE_TOKEN_URL,
                    data={
                        "code": code,
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "redirect_uri": redirect_uri,
                        "grant_type": "authorization_code",
                    },
                )
                if resp.status_code != 200:
                    raise GoogleAuthError(f"Token exchange failed ({resp.status_code}): {resp.text}")
                token_data = resp.json()
                access_token = token_data.get("access_token")
                id_token = token_data.get("id_token")

                if access_token:
                    user_resp = client.get(
                        GOOGLE_USERINFO_URL,
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
                    if user_resp.status_code == 200:
                        return cast(dict[str, Any], user_resp.json())

                if id_token:
                    return self.verify_id_token(id_token)

                raise GoogleAuthError("Token response missing access_token and id_token")
        except httpx.HTTPError as exc:
            raise GoogleAuthError(f"HTTP connection to Google failed: {exc}") from exc

    def verify_id_token(self, id_token: str) -> dict[str, Any]:
        """Validates an ID token using Google's tokeninfo endpoint."""
        try:
            with httpx.Client(transport=self.transport, timeout=10.0) as client:
                resp = client.get(
                    GOOGLE_TOKENINFO_URL,
                    params={"id_token": id_token},
                )
                if resp.status_code != 200:
                    raise GoogleAuthError(f"Token verification failed ({resp.status_code}): {resp.text}")
                info = cast(dict[str, Any], resp.json())
                aud = info.get("aud")
                if self.client_id and aud != self.client_id:
                    raise GoogleAuthError(f"Token audience '{aud}' does not match client ID")
                return info
        except httpx.HTTPError as exc:
            raise GoogleAuthError(f"HTTP connection to Google failed: {exc}") from exc


def google_auth_from_environment(
    root_dir: Path | None = None,
    transport: httpx.BaseTransport | None = None,
) -> GoogleAuthClient:
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")

    if not (client_id and client_secret):
        search_dir = root_dir or Path(__file__).resolve().parents[4]
        for candidate in search_dir.glob("client_secret*.json"):
            try:
                data = json.loads(candidate.read_text(encoding="utf-8"))
                web_config = data.get("web") or data.get("installed") or {}
                if "client_id" in web_config and "client_secret" in web_config:
                    client_id = web_config["client_id"]
                    client_secret = web_config["client_secret"]
                    break
            except Exception:
                continue

    return GoogleAuthClient(client_id, client_secret, transport=transport)
