"""Human review: code-enforced dispositions, four-eyes escalation, durable resume."""
from time import monotonic, sleep

import pytest
from fastapi.testclient import TestClient
from langgraph.types import Command

from aml_guardian import review
from aml_guardian.api import CaseStore, app
from aml_guardian.demo import SAMPLE_ALERT
from aml_guardian.graph import build_graph
from aml_guardian.journal import CaseJournal

RATIONALE = "Sub-threshold deposits from many sources then a round outflow."


def decision(action, reviewer="Ana Analyst", **extra):
    return {"action": action, "reviewer": reviewer, "rationale": RATIONALE,
            "evidence_reviewed": True, **extra}


def settle(client, case_id):
    deadline = monotonic() + 10
    while monotonic() < deadline:
        case = client.get(f"/api/v1/cases/{case_id}").json()
        if case["status"] != "running":
            return case
        sleep(0.02)
    pytest.fail("case did not settle")


def start(client, scenario):
    return settle(client, client.post("/api/v1/cases", json={"scenario": scenario}).json()["id"])


def test_policy_blocks_hold_at_level_one_and_caps_escalation():
    first = review.pending_review("HOLD", [])
    allowed = {o.action: o.allowed for o in first.options}
    assert allowed == {"APPROVE_SAR": False, "DISMISS": False, "ESCALATE": True}
    assert all(o.blocked_reason for o in first.options if not o.allowed)
    entry = review.record(decision("ESCALATE"), "HOLD", [])
    senior = review.pending_review("HOLD", [entry])
    assert senior.level == 2 and senior.previous.reviewer == "Ana Analyst"
    assert {o.action for o in senior.options if o.allowed} == {"APPROVE_SAR", "DISMISS"}


@pytest.mark.parametrize("command,message", [
    (decision("APPROVE_SAR", evidence_reviewed=False), "Confirm"),
    (decision("DISMISS"), "senior reviewer"),
])
def test_policy_rejections_are_readable(command, message):
    with pytest.raises(ValueError, match=message):
        review.validate(review.ReviewCommand.model_validate(command), "HOLD", [])


def test_four_eyes_rejects_same_reviewer_case_insensitively():
    entry = review.record(decision("ESCALATE"), "FILE_SAR", [])
    with pytest.raises(ValueError, match="Four-eyes"):
        review.record(decision("APPROVE_SAR", reviewer="ana  ANALYST"), "FILE_SAR", [entry])


@pytest.mark.parametrize("field,value", [
    ("reviewer", " A "), ("rationale", "reason" + " " * 30),
    ("reviewer", 123), ("rationale", None),
])
def test_required_lengths_apply_after_whitespace_normalization(field, value):
    with pytest.raises(ValueError):
        review.ReviewCommand.model_validate(decision("DISMISS", **{field: value}))


def test_graph_escalation_loops_back_then_closes(tmp_path):
    graph = build_graph(journal=CaseJournal(str(tmp_path / "j.jsonl")))
    config = {"configurable": {"thread_id": "t1"}}
    first = graph.invoke({"alert": SAMPLE_ALERT}, config)
    assert first["__interrupt__"][0].value["level"] == 1
    second = graph.invoke(Command(resume=decision("ESCALATE")), config)
    assert second["__interrupt__"][0].value["level"] == 2
    final = graph.invoke(Command(resume=decision("APPROVE_SAR", reviewer="Sam Senior")), config)
    assert [r["action"] for r in final["reviews"]] == ["ESCALATE", "APPROVE_SAR"]
    assert "Sam Senior" in final["disposition"] and "nothing was filed" in final["disposition"]


def test_api_review_lifecycle_with_escalation():
    with TestClient(app) as client:
        case = start(client, "screening")
        assert case["status"] == "awaiting_human"
        assert case["review"]["level"] == 1
        blocked = client.post(f"/api/v1/cases/{case['id']}/decision", json=decision("DISMISS"))
        assert blocked.status_code == 422 and "senior" in blocked.json()["detail"]

        accepted = client.post(f"/api/v1/cases/{case['id']}/decision", json=decision("ESCALATE"))
        assert accepted.status_code == 202 and accepted.json()["status"] == "running"
        case = settle(client, case["id"])
        assert case["status"] == "awaiting_human" and case["review"]["level"] == 2
        assert case["reviews"][0]["action"] == "ESCALATE"

        same = client.post(f"/api/v1/cases/{case['id']}/decision", json=decision("DISMISS"))
        assert same.status_code == 422 and "Four-eyes" in same.json()["detail"]
        client.post(f"/api/v1/cases/{case['id']}/decision",
                    json=decision("DISMISS", reviewer="Sam Senior"))
        case = settle(client, case["id"])
        assert case["status"] == "completed" and case["review"] is None
        assert "Closed with no further action by Sam Senior" in case["disposition"]
        assert case["events"][-1]["node"] == "case_close"
        checkpoints = [e["phase"] for e in case["events"] if e["node"] == "hitl_approval"]
        assert checkpoints == ["started", "completed", "started", "completed"]
        assert any("Level 1 reviewer Ana Analyst" in s
                   for e in case["events"] for s in e["summary"])
        again = client.post(f"/api/v1/cases/{case['id']}/decision", json=decision("DISMISS", reviewer="X Y"))
        assert again.status_code == 409


def test_api_rejects_decisions_for_clear_cases_and_bad_payloads():
    with TestClient(app) as client:
        routine = start(client, "routine")
        assert routine["review"] is None and routine["disposition"].startswith("Closed automatically")
        assert client.post(f"/api/v1/cases/{routine['id']}/decision",
                           json=decision("APPROVE_SAR")).status_code == 409
        pending = start(client, "review")
        url = f"/api/v1/cases/{pending['id']}/decision"
        assert client.post(url, json={**decision("APPROVE_SAR"), "rationale": "too short"}).status_code == 422
        assert client.post(url, json={**decision("APPROVE_SAR"), "score": 0}).status_code == 422
        assert client.post(url, json=decision("APPROVE_SAR")).status_code == 202
        assert settle(client, pending["id"])["reviews"][0]["level"] == 1


def test_pending_review_survives_store_restart(tmp_path):
    db = str(tmp_path / "g.sqlite")
    store = CaseStore(db)
    created = store.create("structuring")
    first = store.wait(created.id)
    assert first.review and first.review.level == 1
    store.pool.shutdown(wait=True)
    reloaded = CaseStore(db)
    assert reloaded.get(created.id).review.level == 1
    reloaded.decide(created.id, review.ReviewCommand.model_validate(decision("APPROVE_SAR")))
    done = reloaded.wait(created.id)
    assert done.status == "completed" and done.reviews[0].action == "APPROVE_SAR"
    reloaded.pool.shutdown(wait=True)
