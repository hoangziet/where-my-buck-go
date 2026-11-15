"""Database URL configuration behavior."""

from sqlalchemy.engine import make_url

from where_my_buck_go.adapters.db import database_url_from_environment


def test_component_database_configuration_escapes_reserved_password_characters(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("DB_HOST", "db")
    monkeypatch.setenv("DB_PORT", "5432")
    monkeypatch.setenv("DB_NAME", "fingpt")
    monkeypatch.setenv("DB_USER", "fingpt")
    password = "strong/p@ss:word%"
    monkeypatch.setenv("DB_PASSWORD", password)

    url = database_url_from_environment()

    assert "%2F" in url and "%40" in url and "%3A" in url and "%25" in url
    assert make_url(url).password == password


def test_database_url_environment_remains_supported(monkeypatch) -> None:
    legacy_url = "postgresql+psycopg://fingpt:secret@localhost/fingpt"
    monkeypatch.setenv("DATABASE_URL", legacy_url)
    for name in ("DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"):
        monkeypatch.delenv(name, raising=False)

    assert database_url_from_environment() == legacy_url
