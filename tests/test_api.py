"""Connected workbench boundaries; no implicit approval or customer intake."""
from time import monotonic, sleep

import pytest
from fastapi.testclient import TestClient

from aml_guardian.api import app


def finish(client, case_id):
    deadline = monotonic() + 10
    while monotonic() < deadline:
        response = client.get(f"/api/v1/cases/{case_id}")
        assert response.status_code == 200
        case = response.json()
        if case["status"] != "running":
            return case
        sleep(0.02)
    pytest.fail("Synthetic investigation did not finish in 10 seconds")


@pytest.mark.parametrize("scenario,recommendation,status", [
    ("structuring", "FILE_SAR", "awaiting_human"),
    ("routine", "CLEAR", "completed"),
    ("screening", "HOLD", "awaiting_human"),
    ("review", "REVIEW", "awaiting_human"),
])
def test_connected_scenarios(scenario, recommendation, status):
    with TestClient(app) as client:
        response = client.post("/api/v1/cases", json={"scenario": scenario})
        assert response.status_code == 202
        case = finish(client, response.json()["id"])
        assert case["status"] == status
        assert case["recommendation"] == recommendation
        assert case["events"]
        assert [e["sequence"] for e in case["events"]] == list(range(1, len(case["events"]) + 1))
        assert all(set(e) == {"sequence", "node", "phase", "timestamp",
                              "summary", "evidence_ids", "duration_ms"} for e in case["events"])
        assert all(e["duration_ms"] >= 0 for e in case["events"] if e["phase"] == "completed")
        assert all(e["duration_ms"] is None for e in case["events"] if e["phase"] == "started")
        assert case["findings"]
        assert "hitl_decision" not in case
        assert len(client.get("/api/v1/cases").json()) == 1


def test_invalid_intake_and_missing_case():
    with TestClient(app) as client:
        assert client.get("/api/v1/cases").json() == []
        assert client.post("/api/v1/cases", json={"scenario": "customer"}).status_code == 422
        assert client.post("/api/v1/cases", json={"scenario": "routine", "account": "real"}).status_code == 422
        assert client.get("/api/v1/cases/missing").status_code == 404
        assert client.post("/api/v1/cases/missing/actions", json={"type": "APPROVE"}).status_code == 404


def test_worker_failure_is_visible(monkeypatch):
    def broken_graph(**_kwargs):
        raise RuntimeError("Test provider failure")
    monkeypatch.setattr("aml_guardian.api.build_graph", broken_graph)
    with TestClient(app) as client:
        created = client.post("/api/v1/cases", json={"scenario": "routine"}).json()
        case = finish(client, created["id"])
        assert case["status"] == "failed"
        assert created["id"] in case["error"]
        assert case["recommendation"] is None


@pytest.mark.parametrize("scenario,score,incoming,outgoing", [
    ("structuring", 100, 38_300, 28_000),
    ("routine", 15, 3000, 0),
    ("screening", 100, 0, 0),
    ("review", 40, 9500, 0),
])
def test_beginner_guide_expected_results(scenario, score, incoming, outgoing):
    with TestClient(app) as client:
        created = client.post("/api/v1/cases", json={"scenario": scenario}).json()
        case = finish(client, created["id"])
        assert case["score"] == score
        assert sum(t["amount"] for t in case["transactions"] if t["target"] == case["account"]) == incoming
        assert sum(t["amount"] for t in case["transactions"] if t["source"] == case["account"]) == outgoing
        if scenario != "routine":
            assert case["events"][-1]["node"] == "hitl_approval"
            assert case["events"][-1]["phase"] == "started"


def test_trace_contributions_and_conditional_routes():
    with TestClient(app) as client:
        cases = {}
        for scenario in ("structuring", "routine", "screening", "review"):
            created = client.post("/api/v1/cases", json={"scenario": scenario}).json()
            cases[scenario] = finish(client, created["id"])
        for case in cases.values():
            completed = [e for e in case["events"] if e["phase"] == "completed"]
            projected = [claim for e in completed for claim in e["summary"]]
            assert all(f["claim"] in projected for f in case["findings"])
            assert len(completed) == 8
            assert len([e for e in case["events"] if e["phase"] == "started"]) == (
                8 if case["scenario"] == "routine" else 9)
        assert "evidence_critic" not in [e["node"] for e in cases["routine"]["events"]]
        assert cases["routine"]["events"][-1]["node"] == "case_close"
        scoring = next(e for e in cases["screening"]["events"]
                       if e["node"] == "risk_scoring" and e["phase"] == "completed")
        assert "bypassed" in scoring["summary"][0]
        critic = next(e for e in cases["review"]["events"]
                      if e["node"] == "evidence_critic" and e["phase"] == "completed")
        assert "0 challenges" in critic["summary"][0]
        assert "does not check factual support" in critic["summary"][0]
