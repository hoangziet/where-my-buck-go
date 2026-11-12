"""Safe, request-scoped operation and SQL traces for the chat UI."""

import re
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token

TraceEntry = dict[str, str]
_CURRENT_TRACE: ContextVar["DebugTrace | None"] = ContextVar("debug_trace", default=None)
_MAX_ENTRIES = 60
_MAX_SQL_LENGTH = 2400


class DebugTrace:
    def __init__(self) -> None:
        self.entries: list[TraceEntry] = []
        self.omitted_sql = 0

    def add_step(self, title: str, detail: str) -> None:
        if len(self.entries) < _MAX_ENTRIES:
            self.entries.append({"kind": "step", "title": title, "detail": detail})

    def add_sql(self, statement: str) -> None:
        if len(self.entries) >= _MAX_ENTRIES:
            self.omitted_sql += 1
            return
        # SQLAlchemy sends values separately as bound parameters. Only keep the SQL template.
        normalized = re.sub(r"\s+", " ", statement).strip()
        if len(normalized) > _MAX_SQL_LENGTH:
            normalized = normalized[:_MAX_SQL_LENGTH] + " …"
        self.entries.append({
            "kind": "sql",
            "title": "PostgreSQL",
            "detail": "Bound parameter values are hidden.",
            "sql": normalized,
        })

    def snapshot(self) -> list[TraceEntry]:
        entries = list(self.entries)
        if self.omitted_sql:
            entries.append({
                "kind": "step",
                "title": "Additional SQL omitted",
                "detail": f"{self.omitted_sql} further statements were not shown.",
            })
        return entries


@contextmanager
def capture_debug_trace() -> Iterator[DebugTrace]:
    trace = DebugTrace()
    token: Token[DebugTrace | None] = _CURRENT_TRACE.set(trace)
    try:
        yield trace
    finally:
        _CURRENT_TRACE.reset(token)


def record_step(title: str, detail: str) -> None:
    trace = _CURRENT_TRACE.get()
    if trace is not None:
        trace.add_step(title, detail)


def current_trace() -> DebugTrace | None:
    return _CURRENT_TRACE.get()


def record_sql(statement: str) -> None:
    trace = _CURRENT_TRACE.get()
    if trace is not None:
        trace.add_sql(statement)
