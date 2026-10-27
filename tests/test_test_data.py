"""Test-data controls and golden scenario expectations."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aml_guardian.api import app

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "synthetic-scenarios.json").read_text())
EXPECTED = {s["scenario"]: s for s in FIXTURE["scenarios"]}


def test_controls_are_hidden_unless_enabled(monkeypatch):
    monkeypatch.delenv("AML_ENABLE_TEST_DATA_CONTROLS", raising=False)
    with TestClient(app) as client:
        assert client.post("/api/v1/test-data/seed", json={}).status_code == 404
        assert client.delete("/api/v1/test-data/cases").status_code == 404
        assert client.get("/api/v1/cases").json() == []


def test_seed_runs_real_graph_and_matches_golden_fixture(monkeypatch):
    monkeypatch.setenv("AML_ENABLE_TEST_DATA_CONTROLS", "1")
    with TestClient(app) as client:
        client.post("/api/v1/cases", json={"scenario": "routine"})
        response = client.post("/api/v1/test-data/seed", json={})
        assert response.status_code == 201
        seeded = response.json()
        assert [c["scenario"] for c in seeded] == list(EXPECTED)
        assert len(client.get("/api/v1/cases").json()) == 4  # reset removed the earlier case
        for case in seeded:
            expected = EXPECTED[case["scenario"]]
            assert case["account"] == expected["account"]
            assert case["score"] == expected["score"]
            assert case["recommendation"] == expected["recommendation"]
            assert case["status"] == expected["status"]
            assert sum(t["amount"] for t in case["transactions"]
                       if t["target"] == case["account"]) == expected["incoming"]
            assert sum(t["amount"] for t in case["transactions"]
                       if t["source"] == case["account"]) == expected["outgoing"]
            assert [e["node"] for e in case["events"]
                    if e["phase"] == "started"] == expected["route"]


def test_seed_can_append_and_reset_clears(monkeypatch):
    monkeypatch.setenv("AML_ENABLE_TEST_DATA_CONTROLS", "1")
    with TestClient(app) as client:
        client.post("/api/v1/test-data/seed", json={"scenarios": ["review"]})
        client.post("/api/v1/test-data/seed", json={"scenarios": ["routine", "routine"], "reset": False})
        assert len(client.get("/api/v1/cases").json()) == 3
        assert client.delete("/api/v1/test-data/cases").json() == {"removed": 3}
        assert client.get("/api/v1/cases").json() == []


@pytest.mark.parametrize("body", [
    {"scenarios": []},
    {"scenarios": ["customer"]},
    {"scenarios": ["routine"] * 9},
    {"scenarios": ["routine"], "account": "real"},
])
def test_seed_accepts_only_fixed_scenarios(monkeypatch, body):
    monkeypatch.setenv("AML_ENABLE_TEST_DATA_CONTROLS", "1")
    with TestClient(app) as client:
        assert client.post("/api/v1/test-data/seed", json=body).status_code == 422


def test_reset_refuses_while_investigations_run(monkeypatch):
    monkeypatch.setenv("AML_ENABLE_TEST_DATA_CONTROLS", "1")
    monkeypatch.setattr("aml_guardian.api.CaseStore.reset.__defaults__", (0.1,))
    with TestClient(app) as client:
        store = app.state.store
        seeded = client.post("/api/v1/test-data/seed", json={"scenarios": ["routine"]}).json()[0]
        with store.lock:
            store.cases[seeded["id"]].status = "running"
        assert client.delete("/api/v1/test-data/cases").status_code == 409
        with store.lock:
            store.cases[seeded["id"]].status = "completed"
        assert client.delete("/api/v1/test-data/cases").json() == {"removed": 1}
