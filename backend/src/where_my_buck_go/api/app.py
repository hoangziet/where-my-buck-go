"""HTTP boundary: cookies, request validation, CSRF, static frontend."""

import os
from pathlib import Path
from typing import Any

from flask import Flask, Response, g, jsonify, request, send_from_directory
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from where_my_buck_go.adapters.auth_repo import PostgresAuthStore
from where_my_buck_go.adapters.db import engine_for
from where_my_buck_go.adapters.gemini import DEFAULT_MODEL, GeminiClient
from where_my_buck_go.adapters.history_repo import PostgresHistoryStore
from where_my_buck_go.adapters.ledger_repo import PostgresLedgerStore
from where_my_buck_go.adapters.local_evidence import LocalEvidenceStore
from where_my_buck_go.api.ledger import ledger_blueprint
from where_my_buck_go.services.auth import AuthService, LoginLimitedError, SessionRecord
from where_my_buck_go.services.chat import ChatService
from where_my_buck_go.services.history import HistoryService
from where_my_buck_go.services.ledger import LedgerService


def create_app(service: AuthService | None = None, *, production: bool | None = None,
               ledger: LedgerService | None = None, chat: ChatService | None = None,
               history: HistoryService | None = None) -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 4_100_000
    is_production = production if production is not None else os.environ.get("APP_ENV") == "production"
    cookie_name = "__Host-wmbg_session" if is_production else "wmbg_session"
    csrf_cookie_name = "__Host-wmbg_csrf" if is_production else "wmbg_csrf"
    if service is None:
        url = os.environ["DATABASE_URL"]
        engine = engine_for(url)
        service = AuthService(PostgresAuthStore(engine), os.environ["AUTH_HMAC_KEY"].encode("utf-8"))
    else:
        engine = None
    if ledger is None and engine is not None:
        root = Path(__file__).resolve().parents[4]
        directory = Path(os.environ.get("EVIDENCE_DIR", root / ".local-evidence"))
        ledger = LedgerService(PostgresLedgerStore(engine), LocalEvidenceStore(directory, production=is_production))
    if history is None and engine is not None and ledger is not None:
        history = HistoryService(PostgresHistoryStore(engine), ledger.store)
    if ledger is not None:
        if chat is None and os.environ.get("GEMINI_API_KEY"):
            chat = ChatService(GeminiClient(os.environ["GEMINI_API_KEY"],
                                                  os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)), ledger, history)
        app.register_blueprint(ledger_blueprint(ledger, chat, history))

    @app.after_request
    def prevent_auth_caching(response: Response) -> Response:
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.before_request
    def authenticate() -> Response | tuple[Response, int] | None:
        if not request.path.startswith("/api/") or request.path == "/api/health":
            return None
        token = request.cookies.get(cookie_name, "")
        session = service.session(token)
        if request.path == "/api/auth/login" and session is None:
            return None
        if session is None:
            return jsonify(error="Unauthorized"), 401
        g.session = session
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if not service.check_csrf(session, request.headers.get("X-CSRF-Token", "")):
                return jsonify(error="Invalid CSRF token"), 403
        return None

    @app.post("/api/auth/login")
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
        response.set_cookie(cookie_name, result.token, max_age=12 * 60 * 60, httponly=True,
                            secure=is_production, samesite="Strict", path="/")
        response.set_cookie(csrf_cookie_name, result.csrf, max_age=12 * 60 * 60, httponly=False,
                            secure=is_production, samesite="Strict", path="/")
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/auth/me")
    def me() -> Response:
        session: SessionRecord = g.session
        return jsonify(username=session.username)

    @app.post("/api/auth/logout")
    def logout() -> Response:
        service.logout(request.cookies.get(cookie_name, ""))
        response = jsonify(ok=True)
        response.delete_cookie(cookie_name, path="/", secure=is_production, httponly=True, samesite="Strict")
        response.delete_cookie(csrf_cookie_name, path="/", secure=is_production, samesite="Strict")
        return response

    @app.get("/api/health")
    def health() -> Response | tuple[Response, int]:
        if engine is not None:
            try:
                with engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
            except SQLAlchemyError:
                return jsonify(status="unavailable"), 503
        return jsonify(status="ok")

    static_dir = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parents[4] / "frontend" / "dist"))

    @app.get("/")
    @app.get("/<path:filename>")
    def frontend(filename: str = "index.html") -> Response | tuple[Response, int]:
        if filename.startswith("api/"):
            return jsonify(error="Not found"), 404
        target = static_dir / filename
        if not target.is_file():
            filename = "index.html"
        return send_from_directory(static_dir, filename)

    return app
