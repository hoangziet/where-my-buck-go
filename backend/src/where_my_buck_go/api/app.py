"""HTTP boundary: cookies, request validation, CSRF, static frontend."""

import hmac
import os
import secrets
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal, cast
from urllib.parse import quote

from flask import Flask, Response, g, request, send_from_directory
from flask import jsonify as flask_jsonify
from flask import redirect as flask_redirect
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from where_my_buck_go.adapters.auth_repo import PostgresAuthStore
from where_my_buck_go.adapters.db import database_url_from_environment, engine_for
from where_my_buck_go.adapters.gemini import DEFAULT_MODEL, GeminiClient
from where_my_buck_go.adapters.google_auth import GoogleAuthClient, google_auth_from_environment
from where_my_buck_go.adapters.history_repo import PostgresHistoryStore
from where_my_buck_go.adapters.ledger_repo import PostgresLedgerStore
from where_my_buck_go.adapters.local_evidence import LocalEvidenceStore
from where_my_buck_go.adapters.object_evidence import object_evidence_from_environment
from where_my_buck_go.api.ledger import ledger_blueprint
from where_my_buck_go.domain.auth import SESSION_LIFETIME
from where_my_buck_go.services.auth import AuthService, LoginLimitedError, SessionRecord
from where_my_buck_go.services.chat import ChatService
from where_my_buck_go.services.history import HistoryService
from where_my_buck_go.services.ledger import LedgerService

SESSION_ENDING_PATHS = frozenset({"/api/auth/logout", "/api/auth/change-password"})

def verified_email(user_info: dict[str, Any]) -> str | None:
    """Google identities are trusted only when Google itself verified the email address."""
    email = user_info.get("email")
    if isinstance(email, str) and email and user_info.get("email_verified") in (True, "true", 1):
        return email
    return None


jsonify = cast(Callable[..., Response], flask_jsonify)
redirect = cast(Callable[..., Response], flask_redirect)


def create_app(service: AuthService | None = None, *, production: bool | None = None,
               ledger: LedgerService | None = None, chat: ChatService | None = None,
               history: HistoryService | None = None,
               google_auth: GoogleAuthClient | None = None) -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 4_100_000
    is_production = production if production is not None else os.environ.get("APP_ENV") == "production"
    if is_production:
        from werkzeug.middleware.proxy_fix import ProxyFix

        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)  # type: ignore[method-assign]
    cookie_name = "__Host-wmbg_session" if is_production else "wmbg_session"
    csrf_cookie_name = "__Host-wmbg_csrf" if is_production else "wmbg_csrf"
    oauth_state_cookie_name = "__Host-wmbg_oauth_state" if is_production else "wmbg_oauth_state"
    session_max_age = int(SESSION_LIFETIME.total_seconds())

    def set_session_cookies(response: Response, token: str, csrf: str | None, *,
                            samesite: Literal["Strict", "Lax"], max_age: int = session_max_age) -> None:
        response.set_cookie(cookie_name, token, max_age=max_age, httponly=True,
                            secure=is_production, samesite=samesite, path="/")
        if csrf is not None:
            response.set_cookie(csrf_cookie_name, csrf, max_age=max_age, httponly=False,
                                secure=is_production, samesite=samesite, path="/")

    def clear_auth_cookies(response: Response) -> None:
        set_session_cookies(response, "", "", samesite="Strict", max_age=0)

    def set_oauth_state_cookie(response: Response, state: str, max_age: int) -> None:
        response.set_cookie(oauth_state_cookie_name, state, max_age=max_age, httponly=True,
                            secure=is_production, samesite="Lax", path="/")
    if google_auth is None:
        google_auth = google_auth_from_environment()
    if service is None:
        engine = engine_for(database_url_from_environment())
        service = AuthService(PostgresAuthStore(engine), os.environ["AUTH_HMAC_KEY"].encode("utf-8"))
    else:
        engine = None
    if ledger is None and engine is not None:
        root = Path(__file__).resolve().parents[4]
        evidence = (object_evidence_from_environment() if is_production else
                    LocalEvidenceStore(Path(os.environ.get("EVIDENCE_DIR", root / ".local-evidence"))))
        ledger = LedgerService(PostgresLedgerStore(engine), evidence)
    if history is None and engine is not None and ledger is not None:
        history = HistoryService(PostgresHistoryStore(engine), ledger.store)
    if ledger is not None:
        if chat is None and os.environ.get("GEMINI_API_KEY"):
            chat = ChatService(GeminiClient(os.environ["GEMINI_API_KEY"],
                                                  os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)), ledger, history)
        app.register_blueprint(ledger_blueprint(ledger, chat, history))

    @app.after_request
    def prevent_auth_caching(response: Response) -> Response:
        if request.path.startswith("/api/") and not request.path.startswith("/api/evidence/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.after_request
    def security_headers(response: Response) -> Response:
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        if is_production:
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response

    @app.before_request
    def authenticate() -> Response | tuple[Response, int] | None:
        if not request.path.startswith("/api/") or request.path == "/api/health":
            return None
        token = request.cookies.get(cookie_name, "")
        session = service.session(token)
        if request.path in ("/api/auth/login", "/api/auth/google", "/api/auth/google/callback") and session is None:
            return None
        if session is None:
            return jsonify(error="Unauthorized"), 401
        g.session = session
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if not service.check_csrf(session, request.headers.get("X-CSRF-Token", "")):
                return jsonify(error="Invalid CSRF token"), 403
        if request.path not in SESSION_ENDING_PATHS:
            renewed = service.renew_if_due(token, session)
            if renewed is not None:
                g.session = renewed
                g.session_renewed = True
        return None

    @app.after_request
    def refresh_session_cookies(response: Response) -> Response:
        if not g.get("session_renewed") or response.status_code == 401:
            return response
        set_session_cookies(response, request.cookies.get(cookie_name, ""),
                            request.cookies.get(csrf_cookie_name) or None, samesite="Lax")
        return response

    @app.route("/api/auth/login", methods=["POST"])
    def login() -> Response | tuple[Response, int]:
        data: Any = request.get_json(silent=True)
        if not isinstance(data, dict) or not isinstance(data.get("username"), str) or not isinstance(
            data.get("password"), str
        ) or len(data["username"]) > 128 or len(data["password"]) > 1024:
            return jsonify(error="Invalid credentials"), 400
        try:
            result = service.login(data["username"], data["password"], request.remote_addr or "unknown")
        except LoginLimitedError:
            return jsonify(error="Too many login attempts"), 429
        if result is None:
            return jsonify(error="Invalid credentials"), 401
        response = jsonify(username=result.username, csrfToken=result.csrf)
        set_session_cookies(response, result.token, result.csrf, samesite="Strict")
        response.headers["Cache-Control"] = "no-store"
        return response

    def determine_google_redirect_uri() -> str:
        explicit = os.environ.get("GOOGLE_REDIRECT_URI", "").strip()
        if explicit:
            return explicit
        return f"{request.scheme}://{request.host}/api/auth/google/callback"

    @app.route("/api/auth/google", methods=["GET"])
    def google_auth_start() -> Response:
        if not google_auth.is_configured:
            return redirect(f"/login?error={quote('Google Sign-In is not configured')}")
        state = secrets.token_urlsafe(32)
        redirect_uri = determine_google_redirect_uri()
        auth_url = google_auth.get_authorization_url(redirect_uri, state)
        response = redirect(auth_url)
        set_oauth_state_cookie(response, state, max_age=300)
        return response

    @app.route("/api/auth/google/callback", methods=["GET"])
    def google_auth_callback() -> Response:
        error = request.args.get("error")
        if error:
            return redirect(f"/login?error={quote('Google sign-in was cancelled or failed')}")
        code = request.args.get("code")
        state = request.args.get("state")
        cookie_state = request.cookies.get(oauth_state_cookie_name)
        if not code or not state or not cookie_state or not hmac.compare_digest(state, cookie_state):
            return redirect(f"/login?error={quote('Invalid or expired authentication session')}")

        redirect_uri = determine_google_redirect_uri()
        try:
            email = verified_email(google_auth.exchange_code(code, redirect_uri))
            if email is None:
                return redirect(f"/login?error={quote('Google account email is not verified')}")
            result = service.login_or_register_oauth(email)
        except Exception as exc:
            return redirect(f"/login?error={quote(f'Google authentication failed: {exc}')}")

        response = redirect("/dashboard")
        set_session_cookies(response, result.token, result.csrf, samesite="Lax")
        set_oauth_state_cookie(response, "", max_age=0)
        return response

    @app.route("/api/auth/google", methods=["POST"])
    def google_auth_token() -> Response | tuple[Response, int]:
        data: Any = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(error="Invalid request body"), 400
        credential = data.get("credential")
        if not isinstance(credential, str) or not credential:
            return jsonify(error="credential is required"), 400
        try:
            email = verified_email(google_auth.verify_id_token(credential))
            if email is None:
                return jsonify(error="Google account email is not verified"), 400
            result = service.login_or_register_oauth(email)
        except Exception as exc:
            return jsonify(error=f"Google authentication failed: {exc}"), 400

        response = jsonify(username=result.username, csrfToken=result.csrf)
        set_session_cookies(response, result.token, result.csrf, samesite="Lax")
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.route("/api/auth/me", methods=["GET"])
    def me() -> Response:
        session: SessionRecord = g.session
        return jsonify(username=session.username)

    @app.route("/api/auth/change-password", methods=["POST"])
    def change_password() -> Response | tuple[Response, int]:
        session: SessionRecord = g.session
        data: Any = request.get_json(silent=True)
        if not isinstance(data, dict) or not isinstance(data.get("currentPassword"), str) or not isinstance(
            data.get("newPassword"), str
        ) or len(data["currentPassword"]) > 1024 or len(data["newPassword"]) > 1024:
            return jsonify(error="currentPassword and newPassword are required"), 400
        try:
            changed = service.change_password(session.username, data["currentPassword"], data["newPassword"])
        except ValueError as error:
            return jsonify(error=str(error)), 400
        if not changed:
            return jsonify(error="Current password is incorrect"), 401
        response = jsonify(ok=True)
        clear_auth_cookies(response)
        return response

    @app.route("/api/auth/logout", methods=["POST"])
    def logout() -> Response:
        service.logout(request.cookies.get(cookie_name, ""))
        response = jsonify(ok=True)
        clear_auth_cookies(response)
        return response

    @app.route("/api/health", methods=["GET"])
    def health() -> Response | tuple[Response, int]:
        if engine is not None:
            try:
                with engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
            except SQLAlchemyError:
                return jsonify(status="unavailable"), 503
        return jsonify(status="ok")

    static_dir = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parents[4] / "frontend" / "dist"))

    @app.route("/", methods=["GET"])
    @app.route("/<path:filename>", methods=["GET"])
    def frontend(filename: str = "index.html") -> Response | tuple[Response, int]:
        if filename.startswith("api/"):
            return jsonify(error="Not found"), 404
        target = static_dir / filename
        if not target.is_file():
            filename = "index.html"
        return send_from_directory(static_dir, filename)

    return app
