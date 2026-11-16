"""Safe, request-scoped operation and SQL traces for the chat UI."""

import json
import re
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Any

TraceEntry = dict[str, Any]
_CURRENT_TRACE: ContextVar["DebugTrace | None"] = ContextVar("debug_trace", default=None)
_MAX_ENTRIES = 60
_MAX_SQL_LENGTH = 2400


class DebugTrace:
    def __init__(self) -> None:
        self.entries: list[TraceEntry] = []
        self.omitted_sql = 0

    def add_step(self, title: str, detail: str, data: object = None) -> None:
        if len(self.entries) < _MAX_ENTRIES:
            entry: TraceEntry = {"kind": "step", "title": title, "detail": detail}
            if data is not None:
                entry["data"] = data
            self.entries.append(entry)

    def add_sql(self, statement: str, parameters: object = None) -> None:
        if len(self.entries) >= _MAX_ENTRIES:
            self.omitted_sql += 1
            return
        normalized = re.sub(r"\s+", " ", statement).strip()
        if len(normalized) > _MAX_SQL_LENGTH:
            normalized = normalized[:_MAX_SQL_LENGTH] + " …"
        params_str: str | None = None
        inlined: str | None = None
        if parameters:
            try:
                def default_serializer(o: object) -> str:
                    if isinstance(o, (bytes, bytearray)):
                        return f"<bytes {len(o)}b>"
                    return str(o)
                params_str = json.dumps(parameters, default=default_serializer, ensure_ascii=False)
            except Exception:
                params_str = str(parameters)
            if len(params_str) > 2000:
                params_str = params_str[:2000] + " …"

            if isinstance(parameters, dict):
                inlined_raw = statement
                for k, v in parameters.items():
                    if isinstance(v, (int, float)):
                        rep = str(v)
                    elif v is None:
                        rep = "NULL"
                    elif isinstance(v, (bytes, bytearray)):
                        rep = f"<bytes {len(v)}b>"
                    else:
                        rep = f"'{v}'"
                    inlined_raw = inlined_raw.replace(f"%({k})s", rep)
                inlined = re.sub(r"\s+", " ", inlined_raw).strip()
                if len(inlined) > _MAX_SQL_LENGTH:
                    inlined = inlined[:_MAX_SQL_LENGTH] + " …"

        if isinstance(parameters, (dict, list)) and len(parameters) > 0:
            detail = f"{len(parameters)} parameters bound"
        elif params_str:
            detail = "Parameters bound"
        else:
            detail = "No parameters"

        entry: TraceEntry = {
            "kind": "sql",
            "title": "PostgreSQL",
            "detail": detail,
            "sql": normalized,
        }
        if inlined and inlined != normalized:
            entry["inlinedSql"] = inlined
        if params_str:
            entry["parameters"] = params_str
        self.entries.append(entry)

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


def record_step(title: str, detail: str, data: object = None) -> None:
    trace = _CURRENT_TRACE.get()
    if trace is not None:
        trace.add_step(title, detail, data=data)


def current_trace() -> DebugTrace | None:
    return _CURRENT_TRACE.get()


def record_sql(statement: str, parameters: object = None) -> None:
    trace = _CURRENT_TRACE.get()
    if trace is not None:
        trace.add_sql(statement, parameters)
