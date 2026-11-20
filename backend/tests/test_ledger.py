"""Ledger integration: preview is not a write; every confirm is scoped and idempotent."""

import os
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from flask.testing import FlaskClient
from sqlalchemy import create_engine, insert, text

from where_my_buck_go.adapters.auth_repo import PostgresAuthStore
from where_my_buck_go.adapters.db import engine_for, metadata, users
from where_my_buck_go.adapters.gemini import GeminiError
from where_my_buck_go.adapters.history_repo import PostgresHistoryStore
from where_my_buck_go.adapters.ledger_repo import PostgresLedgerStore
from where_my_buck_go.adapters.local_evidence import LocalEvidenceStore
from where_my_buck_go.api.app import create_app
from where_my_buck_go.services.auth import AuthService
from where_my_buck_go.services.chat import ChatService
from where_my_buck_go.services.history import HistoryService
from where_my_buck_go.services.ledger import LedgerService


class FakeChatModel:
    def __init__(self) -> None:
        self.responses: dict[str, dict[str, object] | Exception] = {}
        self.calls: list[tuple[str, str]] = []

    def call_function(self, prompt: str, name: str, parameters: dict[str, object],
                      *, image: bytes | None = None, mime_type: str | None = None) -> dict[str, object]:
        self.calls.append((name, prompt))
        response = self.responses[name]
        if isinstance(response, Exception):
            raise response
        return response


@pytest.fixture
def ledger_client(tmp_path: Path) -> Iterator[tuple[FlaskClient, str, FlaskClient, str]]:
    if not os.environ.get("TEST_DATABASE_URL"):
        pytest.skip("Set TEST_DATABASE_URL for live ledger tests")
    url = os.environ["TEST_DATABASE_URL"]
    schema = "ledger_test_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = engine_for(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        metadata.create_all(engine)
        auth = AuthService(PostgresAuthStore(engine), b"integration-key-at-least-32-bytes-long")
        assert auth.bootstrap("owner", "long-owner-password-123")
        with engine.begin() as conn:
            conn.execute(insert(users).values(id=str(uuid4()), username="other",
                                              password_hash=auth.hasher.hash("long-other-password-123"),
                                              created_at=datetime.now(timezone.utc)))
        ledger = LedgerService(PostgresLedgerStore(engine), LocalEvidenceStore(tmp_path))
        history = HistoryService(PostgresHistoryStore(engine), ledger.store)
        model = FakeChatModel()
        app = create_app(auth, ledger=ledger, chat=ChatService(model, ledger, history), history=history, engine=engine)
        app.extensions["test_chat_model"] = model
        client = app.test_client()
        response = client.post("/api/auth/login", json={"username": "owner", "password": "long-owner-password-123"})
        assert response.status_code == 200
        csrf = response.json["csrfToken"]
        other = app.test_client()
        response = other.post("/api/auth/login", json={"username": "other", "password": "long-other-password-123"})
        assert response.status_code == 200
        yield client, csrf, other, response.json["csrfToken"]
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def headers(csrf: str, key: str | None = None) -> dict[str, str]:
    return {"X-CSRF-Token": csrf, "Idempotency-Key": key or str(uuid4())}


def new_expense(*, date: str | None = "2026-11-09") -> dict[str, object]:
    return {
        "expectedVersion": 0, "amount": "17500", "currency": "VND", "direction": "expense",
        "description": "Nap data", "category": "bills", "occurredDate": date, "occurredTime": "18:36",
        "evidenceText": "Nap data Mobifone, original text",
    }


def create_and_confirm(client: FlaskClient, csrf: str) -> tuple[str, str]:
    proposed = client.post("/api/proposals", json=new_expense(), headers=headers(csrf))
    assert proposed.status_code == 201
    proposal_id = proposed.json["id"]
    confirmed = client.post(f"/api/proposals/{proposal_id}/confirm", json={"expectedVersion": 1},
                            headers=headers(csrf))
    assert confirmed.status_code == 200
    return proposal_id, confirmed.json["transaction"]["id"]


def test_preview_confirm_evidence_and_replay(ledger_client: tuple[FlaskClient, str, FlaskClient, str]) -> None:
    client, csrf, _, _ = ledger_client
    body = new_expense()
    key = str(uuid4())
    proposed = client.post("/api/proposals", json=body, headers=headers(csrf, key))
    assert proposed.status_code == 201
    assert proposed.json["canConfirm"] is True
    assert len(proposed.json["evidenceIds"]) == 1
    assert client.get("/api/transactions").json == {"items": []}
    assert client.get("/api/proposals").json["items"][0]["id"] == proposed.json["id"]
    assert client.post("/api/proposals", json=body, headers=headers(csrf, key)).json == proposed.json
    assert client.post("/api/proposals", json={**body, "amount": "20000"},
                       headers=headers(csrf, key)).status_code == 409
    proposal_id = proposed.json["id"]
    detail = client.get(f"/api/proposals/{proposal_id}").json
    assert len(detail["evidenceIds"]) == 1
    evidence_id = detail["evidenceIds"][0]
    assert client.get(f"/api/evidence/{evidence_id}").text == body["evidenceText"]
    assert client.post(f"/api/proposals/{proposal_id}/confirm", json={"expectedVersion": 1},
                       headers={"Idempotency-Key": str(uuid4())}).status_code == 403
    confirm_key = str(uuid4())
    endpoint = f"/api/proposals/{proposal_id}/confirm"
    confirmed = client.post(endpoint, json={"expectedVersion": 1}, headers=headers(csrf, confirm_key))
    assert confirmed.status_code == 200
    assert client.post(endpoint, json={"expectedVersion": 1}, headers=headers(csrf, confirm_key)).json == confirmed.json
    assert client.get("/api/proposals").json == {"items": []}
    assert client.post(endpoint, json={"expectedVersion": 1}, headers=headers(csrf)).status_code == 409
    transaction = confirmed.json["transaction"]
    assert transaction["version"] == 1 and transaction["amount"] == "17500"
    assert client.get(f'/api/transactions/{transaction["id"]}').json["evidenceIds"] == [evidence_id]


def test_discard_hides_draft_and_is_scoped_and_replayable(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, other, other_csrf = ledger_client
    proposed = client.post("/api/proposals", json=new_expense(), headers=headers(csrf))
    assert proposed.status_code == 201
    proposal_id = proposed.json["id"]
    endpoint = f"/api/proposals/{proposal_id}/discard"
    assert other.post(endpoint, json={"expectedVersion": 1}, headers=headers(other_csrf)).status_code == 404
    discard_key = str(uuid4())
    discarded = client.post(endpoint, json={"expectedVersion": 1}, headers=headers(csrf, discard_key))
    assert discarded.status_code == 200
    assert discarded.json["proposal"]["state"] == "discarded"
    assert discarded.json["proposal"]["canConfirm"] is False
    assert client.get("/api/proposals").json == {"items": []}
    assert client.post(endpoint, json={"expectedVersion": 1}, headers=headers(csrf, discard_key)).json == discarded.json
    assert client.post(endpoint, json={"expectedVersion": 1}, headers=headers(csrf)).status_code == 409
    assert client.post(f"/api/proposals/{proposal_id}/confirm", json={"expectedVersion": 2},
                       headers=headers(csrf)).status_code == 409


def test_missing_date_amend_before_confirm(ledger_client: tuple[FlaskClient, str, FlaskClient, str]) -> None:
    client, csrf, _, _ = ledger_client
    proposed = client.post("/api/proposals", json={**new_expense(date=None), "occurredTime": None},
                           headers=headers(csrf))
    assert proposed.status_code == 201 and proposed.json["canConfirm"] is False
    assert proposed.json["timeSource"] == "default" and proposed.json["occurredTime"] == "07:00"
    identifier = proposed.json["id"]
    assert client.post(f"/api/proposals/{identifier}/confirm", json={"expectedVersion": 1},
                       headers=headers(csrf)).status_code == 400
    amended = client.patch(f"/api/proposals/{identifier}", json={**new_expense(), "expectedVersion": 1},
                           headers=headers(csrf))
    assert amended.status_code == 200 and amended.json["version"] == 2
    assert client.post(f"/api/proposals/{identifier}/confirm", json={"expectedVersion": 1},
                       headers=headers(csrf)).status_code == 409
    assert client.post(f"/api/proposals/{identifier}/confirm", json={"expectedVersion": 2},
                       headers=headers(csrf)).status_code == 200


def test_missing_amount_remains_draft(ledger_client: tuple[FlaskClient, str, FlaskClient, str]) -> None:
    client, csrf, _, _ = ledger_client
    proposed = client.post("/api/proposals", json={**new_expense(), "amount": None}, headers=headers(csrf))
    assert proposed.status_code == 201
    assert proposed.json["amount"] is None and proposed.json["canConfirm"] is False
    identifier = proposed.json["id"]
    assert client.post(f"/api/proposals/{identifier}/confirm", json={"expectedVersion": 1},
                       headers=headers(csrf)).status_code == 400
    amended = client.patch(f"/api/proposals/{identifier}", json={**new_expense(), "expectedVersion": 1},
                           headers=headers(csrf))
    assert amended.json["canConfirm"] is True


def test_undo_of_creation_soft_deletes(ledger_client: tuple[FlaskClient, str, FlaskClient, str]) -> None:
    client, csrf, _, _ = ledger_client
    _, identifier = create_and_confirm(client, csrf)
    undo = client.post("/api/proposals/changes", json={
        "targetId": identifier, "expectedVersion": 1, "operation": "undo", "evidenceText": "Undo this creation",
    }, headers=headers(csrf))
    assert undo.status_code == 201 and undo.json["resultDeleted"] is True
    assert client.get(f"/api/transactions/{identifier}").json["deleted"] is False
    confirmed = client.post(f'/api/proposals/{undo.json["id"]}/confirm', json={"expectedVersion": 1},
                            headers=headers(csrf))
    assert confirmed.json["transaction"]["deleted"] is True
    assert confirmed.json["transaction"]["version"] == 2


def test_edit_delete_undo_and_stale_preview(ledger_client: tuple[FlaskClient, str, FlaskClient, str]) -> None:
    client, csrf, _, _ = ledger_client
    _, identifier = create_and_confirm(client, csrf)
    base = {"targetId": identifier, "expectedVersion": 1, "evidenceText": "Owner requested this change"}
    pending_delete = client.post("/api/proposals/changes", json={**base, "operation": "delete"},
                                 headers=headers(csrf))
    assert pending_delete.status_code == 201
    edit_body = {**base, **new_expense(), "targetId": identifier, "expectedVersion": 1,
                 "amount": "20000", "operation": "edit"}
    edit = client.post("/api/proposals/changes", json=edit_body, headers=headers(csrf))
    assert edit.status_code == 201
    changed = client.post(f'/api/proposals/{edit.json["id"]}/confirm', json={"expectedVersion": 1},
                          headers=headers(csrf))
    assert changed.json["transaction"]["amount"] == "20000"
    assert changed.json["transaction"]["version"] == 2
    assert client.post(f'/api/proposals/{pending_delete.json["id"]}/confirm',
                       json={"expectedVersion": 1}, headers=headers(csrf)).status_code == 409
    undo_edit = client.post("/api/proposals/changes", json={**base, "expectedVersion": 2, "operation": "undo"},
                            headers=headers(csrf))
    assert undo_edit.json["amount"] == "17500" and undo_edit.json["resultDeleted"] is False
    restored = client.post(f'/api/proposals/{undo_edit.json["id"]}/confirm', json={"expectedVersion": 1},
                           headers=headers(csrf))
    assert restored.json["transaction"]["version"] == 3
    delete = client.post("/api/proposals/changes", json={**base, "expectedVersion": 3, "operation": "delete"},
                         headers=headers(csrf))
    deleted = client.post(f'/api/proposals/{delete.json["id"]}/confirm', json={"expectedVersion": 1},
                          headers=headers(csrf))
    assert deleted.json["transaction"]["deleted"] is True
    assert client.get("/api/transactions").json == {"items": []}
    undo_delete = client.post("/api/proposals/changes", json={**base, "expectedVersion": 4, "operation": "undo"},
                              headers=headers(csrf))
    revived = client.post(f'/api/proposals/{undo_delete.json["id"]}/confirm', json={"expectedVersion": 1},
                          headers=headers(csrf))
    assert revived.json["transaction"]["deleted"] is False
    assert revived.json["transaction"]["version"] == 5
    assert len(client.get("/api/transactions").json["items"]) == 1


def test_owner_scope_and_invalid_inputs(ledger_client: tuple[FlaskClient, str, FlaskClient, str]) -> None:
    client, csrf, other, other_csrf = ledger_client
    proposed_id, transaction_id = create_and_confirm(client, csrf)
    assert client.post("/api/proposals", json=new_expense(), headers={"X-CSRF-Token": csrf}).status_code == 400
    assert client.post("/api/proposals", json={**new_expense(), "amount": 17500},
                       headers=headers(csrf)).status_code == 400
    assert client.post("/api/proposals", json={**new_expense(), "expectedVersion": True},
                       headers=headers(csrf)).status_code == 400
    assert client.get(f"/api/proposals/{proposed_id}").status_code == 200
    evidence_id = client.get(f"/api/proposals/{proposed_id}").json["evidenceIds"][0]
    assert other.get(f"/api/proposals/{proposed_id}").status_code == 404
    assert other.get("/api/proposals").json == {"items": []}
    assert other.get(f"/api/transactions/{transaction_id}").status_code == 404
    assert other.get(f"/api/evidence/{evidence_id}").status_code == 404
    assert other.post("/api/proposals/changes", json={
        "operation": "delete", "targetId": transaction_id, "expectedVersion": 1,
        "evidenceText": "Not your transaction",
    }, headers=headers(other_csrf)).status_code == 404
    assert other.get("/api/transactions").json == {"items": []}
    client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf})
    assert client.get(f"/api/transactions/{transaction_id}").status_code == 401


def test_reports_summary_aggregates_owner_scoped_months(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, other, _ = ledger_client
    create_and_confirm(client, csrf)
    income_body = {**new_expense(), "direction": "income", "amount": "5000000"}
    proposed = client.post("/api/proposals", json=income_body, headers=headers(csrf))
    client.post(f'/api/proposals/{proposed.json["id"]}/confirm', json={"expectedVersion": 1}, headers=headers(csrf))

    summary = client.get("/api/reports/summary?months=1").json
    assert summary["totals"] == {"income": "5000000", "expense": "17500"}
    assert summary["months"] == [{"month": "2026-11", "income": "5000000", "expense": "17500"}]
    assert other.get("/api/reports/summary?months=1").json["totals"] == {"income": "0", "expense": "0"}
    assert client.get("/api/reports/summary?months=0").status_code == 400


def test_dashboard_summary_uses_current_period_and_all_time_balance(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, other, _ = ledger_client
    today = datetime.now(timezone.utc).astimezone(ZoneInfo("Asia/Ho_Chi_Minh")).date()
    old_date = today.replace(day=1) - timedelta(days=1)
    old_body = {**new_expense(), "occurredDate": old_date.isoformat(), "amount": "30000"}
    today_body = {**new_expense(), "occurredDate": today.isoformat(), "amount": "17500"}
    for body in (old_body, today_body):
        proposed = client.post("/api/proposals", json=body, headers=headers(csrf))
        assert proposed.status_code == 201
        confirmed = client.post(f'/api/proposals/{proposed.json["id"]}/confirm',
                                json={"expectedVersion": 1}, headers=headers(csrf))
        assert confirmed.status_code == 200

    weekly = client.get("/api/reports/dashboard?period=week").json
    assert weekly["start"] == (today - timedelta(days=today.weekday())).isoformat()
    assert weekly["end"] == today.isoformat()
    assert weekly["totals"]["expense"] == "17500"
    assert weekly["balance"]["expense"] == "47500"
    assert weekly["days"][-1]["date"] == today.isoformat()
    monthly = client.get("/api/reports/dashboard?period=month").json
    assert monthly["start"] == today.replace(day=1).isoformat()
    assert monthly["totals"]["expense"] == "17500"
    assert other.get("/api/reports/dashboard?period=week").json["balance"]["expense"] == "0"
    assert client.get("/api/reports/dashboard?period=year").status_code == 400


def test_simultaneous_replay_writes_one_draft(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str], tmp_path: Path,
) -> None:
    client, csrf, _, _ = ledger_client
    second = client.application.test_client()
    login = second.post("/api/auth/login", json={"username": "owner", "password": "long-owner-password-123"})
    assert login.status_code == 200
    second_csrf = login.json["csrfToken"]
    same_key = str(uuid4())

    def submit(session: FlaskClient, token: str) -> tuple[int, str]:
        response = session.post("/api/proposals", json=new_expense(), headers=headers(token, same_key))
        return response.status_code, response.json["id"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(submit, client, csrf)
        duplicate = pool.submit(submit, second, second_csrf)
        assert first.result() == duplicate.result()
        assert first.result()[0] == 201
    assert len(list(tmp_path.iterdir())) == 1


def test_filesystem_evidence_is_forbidden_in_production(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="requires R2"):
        LocalEvidenceStore(tmp_path, production=True)


def chat_model(client: FlaskClient) -> FakeChatModel:
    return client.application.extensions["test_chat_model"]


def chat_item(amount: str, description: str, day: str = "2026-11-09") -> dict[str, str]:
    return {"amount": amount, "currency": "VND", "direction": "expense", "description": description,
            "category": "food_drink", "occurredDate": day, "occurredTime": "18:36", "period": ""}


def chat_post(client: FlaskClient, csrf: str, text: str, key: str | None = None) -> object:
    return client.post("/api/chat/messages", json={"text": text, "expectedVersion": 0}, headers=headers(csrf, key))


def test_chat_multi_item_drafts_and_replay(ledger_client: tuple[FlaskClient, str, FlaskClient, str]) -> None:
    client, csrf, _, _ = ledger_client
    model = chat_model(client)
    model.responses = {"route_message": {"specialist": "intake", "date": ""},
                       "parse_transactions": {"items": [chat_item("17500", "Data"),
                                                        chat_item("25000", "Cafe")]}}
    key = str(uuid4())
    response = chat_post(client, csrf, "Hôm 9/11 mua data và cà phê", key)
    assert response.status_code == 200
    proposals = response.json["proposals"]
    assert [item["amount"] for item in proposals] == ["17500", "25000"]
    assert all(item["canConfirm"] and item["state"] == "draft" for item in proposals)
    assert client.get("/api/transactions").json == {"items": []}
    replay = chat_post(client, csrf, "Hôm 9/11 mua data và cà phê", key)
    assert {key: value for key, value in replay.json.items() if key != "debugTrace"} == {
        key: value for key, value in response.json.items() if key != "debugTrace"
    }
    assert replay.json["debugTrace"]  # Each attempt reports the SQL for that attempt.
    assert [name for name, _ in model.calls] == ["route_message", "parse_transactions"]
    assert chat_post(client, csrf, "Nội dung khác", key).status_code == 409
    for item in proposals:
        assert client.get(f'/api/evidence/{item["evidenceIds"][0]}').text == "Hôm 9/11 mua data và cà phê"
    first = proposals[0]
    confirmed = client.post(f'/api/proposals/{first["id"]}/confirm', json={"expectedVersion": 1},
                            headers=headers(csrf))
    assert confirmed.status_code == 200
    assert len(client.get("/api/transactions").json["items"]) == 1


def test_chat_missing_fields_and_invalid_items(ledger_client: tuple[FlaskClient, str, FlaskClient, str]) -> None:
    client, csrf, _, _ = ledger_client
    model = chat_model(client)
    model.responses = {"route_message": {"specialist": "intake", "date": ""},
                       "parse_transactions": {"items": [chat_item("", "Cafe", ""),
                                                        chat_item("1.5", "Invalid"),
                                                        {"amount": "100"}]}}
    response = chat_post(client, csrf, "Mua cà phê")
    assert response.status_code == 200
    assert len(response.json["proposals"]) == 1 and len(response.json["errors"]) == 2
    draft = response.json["proposals"][0]
    assert draft["amount"] is None and not draft["canConfirm"]
    assert draft["occurredDate"] == datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date().isoformat()
    assert client.post(f'/api/proposals/{draft["id"]}/confirm', json={"expectedVersion": 1},
                       headers=headers(csrf)).status_code == 400


def test_chat_qa_owner_scoping_and_ambiguous_fallback(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, other, other_csrf = ledger_client
    _, identifier = create_and_confirm(client, csrf)
    model = chat_model(client)
    model.responses = {"route_message": {"specialist": "unknown", "date": "2026-11-09"},
                       "answer_finance": {"answer": "Bạn đã chi 17.500 VND."}}
    question = "Ngày 9/11 tôi đã chi bao nhiêu?"
    response = chat_post(client, csrf, question)
    assert response.json["kind"] == "qa"
    assert response.json["totals"] == {"income": "0", "expense": "17500"}
    assert response.json["categories"] == {"bills": "17500"}
    assert '"category_expenses_vnd"' in model.calls[1][1]
    assert '"bills": "17500"' in model.calls[1][1]
    assert '"Nap data"' in model.calls[1][1]
    other_response = chat_post(other, other_csrf, question)
    assert other_response.json["totals"] == {"income": "0", "expense": "0"}
    assert identifier not in model.calls[-1][1]
    assert '"expense": "0"' in model.calls[-1][1]
    assert [name for name, _ in model.calls] == ["route_message", "answer_finance"] * 2


def test_chat_bad_model_date_hint_falls_back_to_month(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, _, _ = ledger_client
    model = chat_model(client)
    model.responses = {"route_message": {"specialist": "unknown", "date": "not a date"},
                       "answer_finance": {"answer": "Chưa có giao dịch."}}
    response = chat_post(client, csrf, "Tôi chi bao nhiêu?")
    assert response.status_code == 200 and response.json["kind"] == "qa"


def test_chat_custom_range_is_owner_scoped_and_bounded(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, _, _ = ledger_client
    create_and_confirm(client, csrf)
    model = chat_model(client)
    model.responses = {"route_message": {"specialist": "qa", "range": "custom", "date": "",
                                                 "start": "2026-11-01", "end": "2026-11-30"},
                       "answer_finance": {"answer": "Bạn đã chi 17.500 VND."}}
    response = chat_post(client, csrf, "Tổng chi tháng 11/2026?")
    assert response.json["start"] == "2026-11-01" and response.json["end"] == "2026-11-30"
    assert response.json["totals"]["expense"] == "17500"
    model.responses["route_message"] = {"specialist": "qa", "range": "custom", "date": "",
                                        "start": "2020-01-01", "end": "2030-01-01"}
    assert chat_post(client, csrf, "Tất cả giao dịch?").status_code == 200
    assert "2030" not in model.calls[-1][1]


def test_chat_change_never_confirms_and_csrf_is_required(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, _, _ = ledger_client
    _, identifier = create_and_confirm(client, csrf)
    model = chat_model(client)
    model.responses = {"route_message": {"specialist": "change", "date": ""},
                       "match_transaction": {"operation": "delete", "matchDescription": "no such item",
                                            "matchDate": ""}}
    assert client.post("/api/chat/messages", json={"text": "Xóa giao dịch", "expectedVersion": 0},
                       headers={"Idempotency-Key": str(uuid4())}).status_code == 403
    response = chat_post(client, csrf, "Xóa giao dịch")
    assert response.json["kind"] == "needs_selection" and response.json["candidates"] == []
    assert client.get(f"/api/transactions/{identifier}").json["deleted"] is False
    assert [name for name, _ in model.calls] == ["route_message", "match_transaction"]


def test_chat_change_single_match_creates_delete_proposal(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, _, _ = ledger_client
    _, identifier = create_and_confirm(client, csrf)
    model = chat_model(client)
    model.responses = {"route_message": {"specialist": "change", "date": ""},
                       "match_transaction": {"operation": "delete", "matchDescription": "Nap data",
                                            "matchDate": ""}}
    response = chat_post(client, csrf, "Xóa giao dịch nạp data")
    assert response.status_code == 200 and response.json["kind"] == "change"
    proposal = response.json["proposal"]
    assert proposal["operation"] == "delete" and proposal["targetId"] == identifier
    confirmed = client.post(f'/api/proposals/{proposal["id"]}/confirm', json={"expectedVersion": 1},
                            headers=headers(csrf))
    assert confirmed.status_code == 200 and confirmed.json["transaction"]["deleted"] is True


def test_chat_change_multiple_matches_lists_candidates(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, _, _ = ledger_client
    create_and_confirm(client, csrf)
    second = client.post("/api/proposals", json={**new_expense(date="2026-11-08"), "description": "Nap data 2"},
                         headers=headers(csrf))
    client.post(f'/api/proposals/{second.json["id"]}/confirm', json={"expectedVersion": 1}, headers=headers(csrf))
    model = chat_model(client)
    model.responses = {"route_message": {"specialist": "change", "date": ""},
                       "match_transaction": {"operation": "delete", "matchDescription": "Nap data",
                                            "matchDate": ""}}
    response = chat_post(client, csrf, "Xóa giao dịch nạp data")
    assert response.status_code == 200 and response.json["kind"] == "needs_selection"
    assert len(response.json["candidates"]) == 2


def test_chat_change_lone_transaction_unmatched_fails_closed_without_proposal(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, _, _ = ledger_client
    # There is only a single transaction in this account
    _, identifier = create_and_confirm(client, csrf)
    model = chat_model(client)

    # 1. Model response omits targetId and provides no legacy description/date
    model.responses = {
        "route_message": {"specialist": "change", "date": ""},
        "match_transaction": {"operation": "delete"},
    }
    res_omitted = chat_post(client, csrf, "Xóa giao dịch không liên quan")
    assert res_omitted.status_code == 200
    assert res_omitted.json["kind"] == "needs_selection" and res_omitted.json["candidates"] == []
    assert client.get("/api/proposals").json["items"] == []
    assert client.get(f"/api/transactions/{identifier}").json["deleted"] is False

    # 2. Model response returns an unknown targetId not in candidate map
    model.responses = {
        "route_message": {"specialist": "change", "date": ""},
        "match_transaction": {"operation": "delete", "targetId": "unknown-nonexistent-id"},
    }
    res_unknown = chat_post(client, csrf, "Xóa giao dịch mua xe hơi")
    assert res_unknown.status_code == 200
    assert res_unknown.json["kind"] == "needs_selection" and res_unknown.json["candidates"] == []
    assert client.get("/api/proposals").json["items"] == []
    assert client.get(f"/api/transactions/{identifier}").json["deleted"] is False

    # 3. Model response returns empty targetId with no legacy description
    model.responses = {
        "route_message": {"specialist": "change", "date": ""},
        "match_transaction": {"operation": "delete", "targetId": ""},
    }
    res_empty = chat_post(client, csrf, "Xóa gì đó")
    assert res_empty.status_code == 200
    assert res_empty.json["kind"] == "needs_selection" and res_empty.json["candidates"] == []
    assert client.get("/api/proposals").json["items"] == []
    assert client.get(f"/api/transactions/{identifier}").json["deleted"] is False


def test_chat_follow_up_revises_pending_draft(ledger_client: tuple[FlaskClient, str, FlaskClient, str]) -> None:
    client, csrf, other, other_csrf = ledger_client
    model = chat_model(client)
    model.responses = {"route_message": {"specialist": "intake", "date": ""},
                       "parse_transactions": {"items": [{**chat_item("42000", "ăn hủ tiếu", day=""),
                                                         "occurredTime": ""}]}}
    draft = chat_post(client, csrf, "ăn hủ tiếu 42k").json["proposals"][0]
    assert draft["occurredDate"] == datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date().isoformat()
    assert draft["canConfirm"]

    model.responses = {
        "route_message": {"specialist": "revise", "date": ""},
        "revise_draft": {**chat_item("42000", "ăn hủ tiếu", day="2026-11-08"), "proposalId": draft["id"],
                         "period": "tối", "occurredTime": "07:00"},
    }
    history = [{"role": "user", "text": "ăn hủ tiếu 42k"}, {"role": "assistant", "text": "Đã tạo bản nháp"}]
    body = {"text": "tối qua 7h", "expectedVersion": 0, "history": history, "pendingProposalIds": [draft["id"]]}
    response = client.post("/api/chat/messages", json=body, headers=headers(csrf))
    assert response.status_code == 200 and response.json["revisedProposalIds"] == [draft["id"]]
    revised = response.json["proposals"][0]
    assert revised["id"] == draft["id"] and revised["version"] == 2
    assert (revised["occurredDate"], revised["occurredTime"], revised["period"]) == ("2026-11-08", "19:00", "tối")
    assert revised["canConfirm"]
    route_prompt = next(prompt for name, prompt in model.calls if name == "route_message" and "tối qua" in prompt)
    assert draft["id"] in route_prompt and "ăn hủ tiếu 42k" in route_prompt
    stale = client.post(f'/api/proposals/{draft["id"]}/confirm', json={"expectedVersion": 1}, headers=headers(csrf))
    assert stale.status_code == 409
    confirmed = client.post(f'/api/proposals/{draft["id"]}/confirm', json={"expectedVersion": 2},
                            headers=headers(csrf))
    assert confirmed.status_code == 200 and confirmed.json["transaction"]["occurredTime"] == "19:00"

    # Another owner's draft ID is never visible, so "revise" falls back to a new intake.
    other_model = chat_model(other)
    other_model.responses = {"route_message": {"specialist": "revise", "date": ""},
                             "parse_transactions": {"items": [chat_item("10000", "Trà đá")]}}
    foreign = other.post("/api/chat/messages", headers=headers(other_csrf), json={
        "text": "trà đá 10k", "expectedVersion": 0, "pendingProposalIds": [draft["id"]]})
    assert foreign.status_code == 200 and foreign.json["proposals"][0]["description"] == "Trà đá"
    assert draft["id"] not in next(prompt for name, prompt in reversed(other_model.calls) if name == "route_message")
    for invalid in ({**body, "pendingProposalIds": "id"}, {**body, "pendingProposalIds": [str(uuid4())] * 6}):
        assert client.post("/api/chat/messages", json=invalid, headers=headers(csrf)).status_code == 400


def test_chat_change_edit_keeps_unmentioned_fields(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, _, _ = ledger_client
    _, identifier = create_and_confirm(client, csrf)
    model = chat_model(client)
    model.responses = {
        "route_message": {"specialist": "change", "date": ""},
        "match_transaction": {"operation": "edit", "matchDescription": "Nap data", "matchDate": ""},
        "edit_transaction": {"amount": "20000", "currency": "VND", "direction": "expense",
                             "description": "Nap data", "category": "bills",
                             "occurredDate": "2026-11-09", "period": "", "occurredTime": "18:36"},
    }
    response = chat_post(client, csrf, "Sửa nạp data thành 20000")
    assert response.status_code == 200 and response.json["kind"] == "change"
    proposal = response.json["proposal"]
    assert proposal["amount"] == "20000" and proposal["operation"] == "edit"
    confirmed = client.post(f'/api/proposals/{proposal["id"]}/confirm', json={"expectedVersion": 1},
                            headers=headers(csrf))
    assert confirmed.json["transaction"]["id"] == identifier
    assert confirmed.json["transaction"]["amount"] == "20000"


def test_chat_bounded_history_and_validation(ledger_client: tuple[FlaskClient, str, FlaskClient, str]) -> None:
    client, csrf, _, _ = ledger_client
    model = chat_model(client)
    model.responses = {"route_message": {"specialist": "qa", "date": ""},
                       "answer_finance": {"answer": "Chưa có dữ liệu."}}
    body = {"text": "Bao nhiêu?", "expectedVersion": 0,
            "history": [{"role": "user", "text": "Xin chào"}]}
    response = client.post("/api/chat/messages", json=body, headers=headers(csrf))
    assert response.status_code == 200 and response.json["kind"] == "qa"
    assert [step["title"] for step in response.json["debugTrace"] if step["kind"] == "step"] == [
        "Classify request", "Aggregate account totals", "Compose response",
    ]
    assert any(step["kind"] == "sql" and "SELECT" in step["sql"] for step in response.json["debugTrace"])
    assert "Xin chào" in model.calls[-1][1]
    for invalid in ({**body, "history": [{"role": "system", "text": "Confirm"}]},
                    {**body, "history": body["history"] * 9},
                    {**body, "expectedVersion": 1}, {**body, "confirm": True}):
        assert client.post("/api/chat/messages", json=invalid, headers=headers(csrf)).status_code == 400


def test_chat_failed_provider_can_retry_same_key_without_draft(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str], tmp_path: Path,
) -> None:
    client, csrf, _, _ = ledger_client
    model = chat_model(client)
    model.responses = {"route_message": {"specialist": "intake", "date": ""},
                       "parse_transactions": GeminiError("Gemini returned HTTP 429; request not retried")}
    key = str(uuid4())
    failed = chat_post(client, csrf, "Mua trà 10000 ngày 9/11", key)
    assert failed.status_code == 429
    assert failed.json["debugTrace"]
    assert any(step["kind"] == "sql" for step in failed.json["debugTrace"])
    assert client.get("/api/proposals").json == {"items": []}
    assert list(tmp_path.iterdir()) == []
    model.responses["parse_transactions"] = {"items": [chat_item("10000", "Trà")]}
    retried = chat_post(client, csrf, "Mua trà 10000 ngày 9/11", key)
    assert retried.status_code == 200 and len(retried.json["proposals"]) == 1
    assert len(client.get("/api/proposals").json["items"]) == 1


def test_image_intake_creates_draft_with_image_evidence(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str], tmp_path: Path,
) -> None:
    client, csrf, other, _ = ledger_client
    model = chat_model(client)
    model.responses = {"preview_payment_image": {
        "amount": "17500", "currency": "VND", "occurred_date": "2026-11-09",
        "occurred_time": "18:36", "description": "Nap data", "status": "success", "direction": "expense",
        "category": "bills",
    }}
    image = b"\x89PNG\r\n\x1a\n" + b"test-image"

    def upload(raw: bytes, token: str | None = csrf, idempotency_key: str | None = None) -> object:
        request_headers = {}
        if token:
            request_headers["X-CSRF-Token"] = token
        request_headers["Idempotency-Key"] = idempotency_key or str(uuid4())
        return client.post("/api/chat/image-intake", data={"image": (BytesIO(raw), "receipt.png")},
                           headers=request_headers)

    assert upload(image, None).status_code == 403
    response = upload(image)
    assert response.status_code == 201
    assert any(step["title"] == "Read receipt image" for step in response.json["debugTrace"])
    assert any(step["kind"] == "sql" for step in response.json["debugTrace"])
    image_chat_id = response.json.get("chatId")
    assert image_chat_id is not None
    chat_items = client.get(f"/api/chats/{image_chat_id}/messages").json["items"]
    assert len(chat_items) == 2
    assert chat_items[0]["text"] == "[Hóa đơn: Nap data]"
    assert chat_items[1]["text"] == "Đã tạo bản nháp từ ảnh; cần xác nhận riêng."
    proposal = response.json["proposal"]
    assert proposal["amount"] == "17500" and proposal["category"] == "bills" and proposal["canConfirm"] is True
    assert client.get("/api/transactions").json == {"items": []}
    assert len(client.get("/api/proposals").json["items"]) == 1
    assert len(list(tmp_path.iterdir())) == 1
    evidence_id = proposal["evidenceIds"][0]
    fetched = client.get(f"/api/evidence/{evidence_id}")
    assert fetched.status_code == 200 and fetched.content_type == "image/png" and fetched.data == image
    confirmed = client.post(f'/api/proposals/{proposal["id"]}/confirm', json={"expectedVersion": 1},
                            headers=headers(csrf))
    assert confirmed.status_code == 200 and confirmed.json["transaction"]["category"] == "bills"

    assert other.post("/api/chat/image-intake",
                      data={"image": (BytesIO(image), "receipt.png")}).status_code == 403
    assert upload(b"not an image").status_code == 400
    assert upload(image + b"x" * 4_000_000).status_code in (400, 413)
    model.responses["preview_payment_image"] = {**model.responses["preview_payment_image"], "status": "failed"}
    assert upload(image).status_code == 400


def test_image_intake_failed_provider_can_retry_same_key_without_draft(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str], tmp_path: Path,
) -> None:
    client, csrf, _, _ = ledger_client
    model = chat_model(client)
    model.responses = {"preview_payment_image": GeminiError("Gemini is unreachable after retrying temporary failures")}
    image = b"\x89PNG\r\n\x1a\n" + b"test-retry-image"
    key = str(uuid4())

    def upload(idempotency_key: str) -> object:
        return client.post(
            "/api/chat/image-intake",
            data={"image": (BytesIO(image), "receipt.png"), "caption": "Hóa đơn ăn sáng"},
            headers={"X-CSRF-Token": csrf, "Idempotency-Key": idempotency_key},
        )

    failed = upload(key)
    assert getattr(failed, "status_code", None) == 503
    assert client.get("/api/proposals").json == {"items": []}
    assert list(tmp_path.iterdir()) == []

    model.responses["preview_payment_image"] = {
        "amount": "25000", "currency": "VND", "occurred_date": "2026-11-16",
        "occurred_time": "08:00", "description": "Hóa đơn ăn sáng", "status": "success", "direction": "expense",
        "category": "food_drink",
    }
    retried = upload(key)
    assert getattr(retried, "status_code", None) == 201
    assert len(client.get("/api/proposals").json["items"]) == 1
    assert len(list(tmp_path.iterdir())) == 1


def test_chat_history_is_persisted_and_owner_scoped(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, other, other_csrf = ledger_client
    model = chat_model(client)
    model.responses = {"route_message": {"specialist": "qa", "date": ""},
                       "answer_finance": {"answer": "Chưa có dữ liệu."}}
    first = client.post("/api/chat/messages", json={"text": "Bao nhiêu?", "expectedVersion": 0},
                        headers=headers(csrf))
    assert first.status_code == 200
    chat_id = first.json["chatId"]
    second = client.post("/api/chat/messages", json={"text": "Còn tháng trước?", "expectedVersion": 0,
                                                      "chatId": chat_id}, headers=headers(csrf))
    assert second.json["chatId"] == chat_id

    chats_list = client.get("/api/chats").json["items"]
    assert len(chats_list) == 1 and chats_list[0]["id"] == chat_id and chats_list[0]["title"] == "Bao nhiêu?"
    messages = client.get(f"/api/chats/{chat_id}/messages").json["items"]
    assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant"]
    assert messages[0]["text"] == "Bao nhiêu?" and messages[1]["text"] == "Chưa có dữ liệu."
    assert any(step["kind"] == "sql" for step in messages[1]["debugTrace"])

    assert other.get("/api/chats").json == {"items": []}
    assert other.get(f"/api/chats/{chat_id}/messages").status_code == 404

    # Cross-owner rename and delete isolation
    assert other.patch(f"/api/chats/{chat_id}", json={"title": "Hacked"},
                       headers=headers(other_csrf)).status_code == 404
    assert other.delete(f"/api/chats/{chat_id}", headers=headers(other_csrf)).status_code == 404

    # Owner can rename chat
    renamed = client.patch(f"/api/chats/{chat_id}", json={"title": "Đã đổi tên"},
                           headers=headers(csrf))
    assert renamed.status_code == 200
    assert renamed.json == {"id": chat_id, "title": "Đã đổi tên"}
    assert client.get("/api/chats").json["items"][0]["title"] == "Đã đổi tên"

    # Owner can delete chat
    deleted = client.delete(f"/api/chats/{chat_id}", headers=headers(csrf))
    assert deleted.status_code == 200
    assert client.get("/api/chats").json["items"] == []
    assert client.get(f"/api/chats/{chat_id}/messages").status_code == 404


def test_pinned_queries_rerun_aggregate_and_are_owner_scoped(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, other, other_csrf = ledger_client
    create_and_confirm(client, csrf)
    created = client.post("/api/chat/pins", json={"title": "Nov spending", "start": "2026-11-01", "end": "2026-11-30"},
                          headers=headers(csrf))
    assert created.status_code == 201
    assert created.json["totals"] == {"income": "0", "expense": "17500"}
    pin_id = created.json["id"]

    listed = client.get("/api/chat/pins").json["items"]
    assert len(listed) == 1 and listed[0]["id"] == pin_id and listed[0]["title"] == "Nov spending"

    assert other.get("/api/chat/pins").json == {"items": []}
    assert other.delete(f"/api/chat/pins/{pin_id}", headers={"X-CSRF-Token": other_csrf}).status_code == 404
    assert client.delete(f"/api/chat/pins/{pin_id}", headers=headers(csrf)).status_code == 200
    assert client.get("/api/chat/pins").json == {"items": []}
    assert client.post("/api/chat/pins", json={"title": "Bad", "start": "2026-11-30", "end": "2026-11-01"},
                       headers=headers(csrf)).status_code == 400


def test_evidence_http_caching_and_batch_prepopulation(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, other, other_csrf = ledger_client
    create_and_confirm(client, csrf)
    tx_list = client.get("/api/transactions").json["items"]
    assert len(tx_list) == 1
    tx = tx_list[0]
    assert len(tx["evidenceIds"]) == 1
    assert len(tx["evidence"]) == 1
    assert tx["evidence"][0]["kind"] == "text"
    ev_id = tx["evidenceIds"][0]

    # First fetch: 200 OK with ETag and immutable Cache-Control
    res = client.get(f"/api/evidence/{ev_id}")
    assert res.status_code == 200
    assert "ETag" in res.headers
    assert "max-age=604800" in res.headers.get("Cache-Control", "")
    assert "immutable" in res.headers.get("Cache-Control", "")
    etag = res.headers["ETag"]

    # Revalidation: 304 Not Modified when If-None-Match matches ETag
    cached_res = client.get(f"/api/evidence/{ev_id}", headers={"If-None-Match": etag})
    assert cached_res.status_code == 304
    assert cached_res.headers["ETag"] == etag

    # Single transaction details also returns evidence metadata
    detail = client.get(f'/api/transactions/{tx["id"]}').json
    assert detail["evidenceIds"] == [ev_id]
    assert detail["evidence"] == [{"id": ev_id, "kind": "text"}]


def test_chat_message_with_client_timezone_and_debug_trace_data(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, other, other_csrf = ledger_client
    create_and_confirm(client, csrf)
    model = chat_model(client)
    model.responses["route_message"] = {
        "specialist": "qa", "date": "", "range": "this_month", "start": "", "end": "",
    }
    model.responses["answer_finance"] = {"answer": "Bạn đã chi 17.500 VND."}

    res = client.post(
        "/api/chat/messages",
        json={
            "text": "Tháng này tiêu bao nhiêu",
            "history": [],
            "clientTimezone": "Asia/Ho_Chi_Minh",
            "expectedVersion": 0,
        },
        headers=headers(csrf),
    )
    assert res.status_code == 200
    body = res.json
    assert body["kind"] == "qa"
    assert "debugTrace" in body
    trace = body["debugTrace"]
    step_with_data = [e for e in trace if e.get("kind") == "step" and "data" in e]
    assert len(step_with_data) >= 1
    # Check that aggregate step data recorded totals
    agg_steps = [e for e in step_with_data if e.get("title") == "Aggregate account totals"]
    assert len(agg_steps) == 1
    assert "totals" in agg_steps[0]["data"]
    assert agg_steps[0]["data"]["totals"]["expense"] == "17500"


def test_salary_mode_toggle_and_privacy_filtering(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
) -> None:
    client, csrf, _, _ = ledger_client

    # Initially salary mode is disabled
    me_resp = client.get("/api/auth/me")
    assert me_resp.status_code == 200
    assert me_resp.json["salaryModeEnabled"] is False

    # Creating a salary proposal while disabled must fail
    fail_prop = client.post(
        "/api/proposals",
        json={
            "expectedVersion": 0, "amount": "50000000", "currency": "VND", "direction": "income",
            "category": "salary", "description": "Lương tháng 11", "occurredDate": "2026-11-05",
            "occurredTime": "09:00", "evidenceText": "Payroll",
        },
        headers=headers(csrf),
    )
    assert fail_prop.status_code == 400

    # Enable salary mode
    enable_resp = client.put("/api/settings/salary-mode", json={"enabled": True}, headers=headers(csrf))
    assert enable_resp.status_code == 200 and enable_resp.json == {"salaryModeEnabled": True}
    assert client.get("/api/auth/me").json["salaryModeEnabled"] is True

    # Now create and confirm salary transaction
    salary_prop = client.post(
        "/api/proposals",
        json={
            "expectedVersion": 0, "amount": "50000000", "currency": "VND", "direction": "income",
            "category": "salary", "description": "Lương tháng 11", "occurredDate": "2026-11-05",
            "occurredTime": "09:00", "evidenceText": "Payroll",
        },
        headers=headers(csrf),
    )
    assert salary_prop.status_code == 201
    salary_prop_id = salary_prop.json["id"]
    prop_details = client.get(f"/api/proposals/{salary_prop_id}")
    assert prop_details.status_code == 200
    evidence_ids = prop_details.json["evidenceIds"]
    assert len(evidence_ids) >= 1
    evidence_id = evidence_ids[0]

    # Create an open salary draft to test proposal list filtering
    open_draft = client.post(
        "/api/proposals",
        json={
            "expectedVersion": 0, "amount": "10000000", "currency": "VND", "direction": "income",
            "category": "salary", "description": "Thưởng tết", "occurredDate": "2026-11-06",
            "occurredTime": "10:00", "evidenceText": "Bonus",
        },
        headers=headers(csrf),
    )
    assert open_draft.status_code == 201
    salary_draft_id = open_draft.json["id"]

    confirm_resp = client.post(
        f"/api/proposals/{salary_prop_id}/confirm",
        json={"expectedVersion": 1},
        headers=headers(csrf),
    )
    assert confirm_resp.status_code == 200
    salary_tx_id = confirm_resp.json["transaction"]["id"]

    # Also perform a salary chat exchange
    model = chat_model(client)
    model.responses = {
        "route_message": {"specialist": "qa", "date": ""},
        "answer_finance": {"answer": "Lương tháng 11 là 50 triệu."},
    }
    chat_resp = client.post(
        "/api/chat/messages",
        json={"text": "Lương tháng 11 bao nhiêu?", "expectedVersion": 0},
        headers=headers(csrf),
    )
    assert chat_resp.status_code == 200
    salary_chat_id = chat_resp.json["chatId"]

    # While enabled: visible in proposals, evidence, transactions, details, chats, reports
    assert client.get(f"/api/proposals/{salary_prop_id}").status_code == 200
    assert client.get(f"/api/proposals/{salary_draft_id}").status_code == 200
    assert any(p["id"] == salary_draft_id for p in client.get("/api/proposals").json["items"])
    evidence_resp = client.get(f"/api/evidence/{evidence_id}")
    assert evidence_resp.status_code == 200 and "Payroll" in evidence_resp.text
    assert client.get(f"/api/transactions/{salary_tx_id}").status_code == 200
    assert any(t["id"] == salary_tx_id for t in client.get("/api/transactions").json["items"])
    assert any(c["id"] == salary_chat_id for c in client.get("/api/chats").json["items"])
    summary = client.get("/api/reports/summary?months=1").json
    assert summary["totals"]["income"] == "50000000"

    # Disable salary mode
    disable_resp = client.put("/api/settings/salary-mode", json={"enabled": False}, headers=headers(csrf))
    assert disable_resp.status_code == 200 and disable_resp.json == {"salaryModeEnabled": False}
    assert client.get("/api/auth/me").json["salaryModeEnabled"] is False

    # While disabled: hidden in proposals, evidence, transactions, details, chats, reports
    assert client.get(f"/api/proposals/{salary_prop_id}").status_code == 404
    assert client.get(f"/api/proposals/{salary_draft_id}").status_code == 404
    assert not any(p["id"] == salary_draft_id for p in client.get("/api/proposals").json["items"])
    assert not any(p["id"] == salary_prop_id for p in client.get("/api/proposals").json["items"])
    assert client.get(f"/api/evidence/{evidence_id}").status_code == 404
    assert client.get(f"/api/transactions/{salary_tx_id}").status_code == 404
    assert not any(t["id"] == salary_tx_id for t in client.get("/api/transactions").json["items"])
    assert not any(c["id"] == salary_chat_id for c in client.get("/api/chats").json["items"])
    summary_disabled = client.get("/api/reports/summary?months=1").json
    assert summary_disabled["totals"]["income"] == "0"

    # Re-enable salary mode: everything is restored
    client.put("/api/settings/salary-mode", json={"enabled": True}, headers=headers(csrf))
    assert client.get(f"/api/proposals/{salary_prop_id}").status_code == 200
    assert client.get(f"/api/proposals/{salary_draft_id}").status_code == 200
    assert any(p["id"] == salary_draft_id for p in client.get("/api/proposals").json["items"])
    assert client.get(f"/api/evidence/{evidence_id}").status_code == 200
    assert client.get(f"/api/transactions/{salary_tx_id}").status_code == 200
    assert any(t["id"] == salary_tx_id for t in client.get("/api/transactions").json["items"])
    assert any(c["id"] == salary_chat_id for c in client.get("/api/chats").json["items"])
    summary_reopened = client.get("/api/reports/summary?months=1").json
    assert summary_reopened["totals"]["income"] == "50000000"


def test_telegram_semantic_vietnamese_deletion_of_english_transaction(
    ledger_client: tuple[FlaskClient, str, FlaskClient, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, csrf, _, _ = ledger_client

    # Create an income transaction with English description
    proposed = client.post(
        "/api/proposals",
        json={
            "expectedVersion": 0, "amount": "500000", "currency": "VND", "direction": "income",
            "category": "income", "description": "My mom gave me 500k", "occurredDate": "2026-11-20",
            "occurredTime": "10:00", "evidenceText": "Mom sent 500k",
        },
        headers=headers(csrf),
    )
    assert proposed.status_code == 201
    confirm_res = client.post(
        f"/api/proposals/{proposed.json['id']}/confirm",
        json={"expectedVersion": 1},
        headers=headers(csrf),
    )
    assert confirm_res.status_code == 200
    target_tx_id = confirm_res.json["transaction"]["id"]
    assert client.get(f"/api/transactions/{target_tx_id}").json["deleted"] is False

    # Mock Telegram API calls via httpx.post
    sent_messages: list[dict[str, object]] = []
    registered_webhook_secret = {"value": ""}

    def fake_httpx_post(url: str, json: dict[str, object] | None = None, **kwargs: object) -> object:
        from unittest.mock import MagicMock
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        if url.endswith("/getMe"):
            resp.json.return_value = {"ok": True, "result": {"id": 12345, "username": "buck_test_bot"}}
        elif url.endswith("/setWebhook"):
            registered_webhook_secret["value"] = str((json or {}).get("secret_token", ""))
            resp.json.return_value = {"ok": True, "result": True}
        elif url.endswith("/sendMessage"):
            sent_messages.append(json or {})
            resp.json.return_value = {"ok": True, "result": {"message_id": len(sent_messages)}}
        else:
            resp.json.return_value = {"ok": True, "result": {}}
        return resp

    import httpx
    monkeypatch.setattr(httpx, "post", fake_httpx_post)

    # 1. Connect bot in settings
    conn_res = client.post(
        "/api/settings/telegram",
        json={"botToken": "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz12345678"},
        headers=headers(csrf),
    )
    assert conn_res.status_code == 201
    pairing_code = conn_res.json["pairingCode"]
    webhook_secret = registered_webhook_secret["value"]
    assert webhook_secret

    # 2. Pair Telegram chat via webhook /connect command
    pair_res = client.post(
        "/api/integrations/telegram/webhook",
        headers={"X-Telegram-Bot-Api-Secret-Token": webhook_secret},
        json={
            "update_id": 100,
            "message": {
                "message_id": 1,
                "chat": {"id": 888999, "type": "private"},
                "text": f"/connect {pairing_code}",
            },
        },
    )
    assert pair_res.status_code == 200
    assert any("Telegram is connected" in str(m.get("text", "")) for m in sent_messages)

    # 3. User sends Vietnamese semantic deletion request: "Xóa giao dịch mẹ cho 500k"
    model = chat_model(client)
    model.responses = {
        "route_message": {"specialist": "change", "date": ""},
        "match_transaction": {"operation": "delete", "targetId": target_tx_id},
    }

    del_req = client.post(
        "/api/integrations/telegram/webhook",
        headers={"X-Telegram-Bot-Api-Secret-Token": webhook_secret},
        json={
            "update_id": 101,
            "message": {
                "message_id": 2,
                "chat": {"id": 888999, "type": "private"},
                "text": "Xóa giao dịch mẹ cho 500k",
            },
        },
    )
    assert del_req.status_code == 200

    # Verify a delete proposal draft preview was sent to Telegram with /c_ command
    draft_previews = [str(m.get("text", "")) for m in sent_messages if "Confirm: /c_" in str(m.get("text", ""))]
    assert len(draft_previews) >= 1
    preview_text = draft_previews[-1]
    assert "My mom gave me 500k" in preview_text

    # Extract the confirm command (e.g. /c_...)
    import re
    match_cmd = re.search(r"(/c_[a-z0-9A-Z]+)", preview_text)
    assert match_cmd is not None
    confirm_command = match_cmd.group(1)

    # 4. Confirm the deletion via Telegram command
    confirm_tg = client.post(
        "/api/integrations/telegram/webhook",
        headers={"X-Telegram-Bot-Api-Secret-Token": webhook_secret},
        json={
            "update_id": 102,
            "message": {
                "message_id": 3,
                "chat": {"id": 888999, "type": "private"},
                "text": confirm_command,
            },
        },
    )
    assert confirm_tg.status_code == 200
    assert any("Transaction confirmed." in str(m.get("text", "")) for m in sent_messages)

    # Verify transaction is now deleted in database
    tx_status = client.get(f"/api/transactions/{target_tx_id}")
    assert tx_status.status_code == 200
    assert tx_status.json["deleted"] is True
