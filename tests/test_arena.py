from copy import deepcopy
import json

import pytest
from pydantic import ValidationError

from aml_guardian import arena, investigator, llm, registry


@pytest.fixture(autouse=True)
def stub(monkeypatch):
    monkeypatch.setenv("AML_LLM_PROVIDER", "stub")
    monkeypatch.setattr(llm, "model_residency", lambda: "test_not_observed")


@pytest.mark.parametrize("fixture", arena.fixtures(), ids=lambda f: f.id)
def test_planted_defects_and_clean_controls(fixture):
    before = deepcopy(fixture.alert())
    report = arena.compare(fixture)
    assert fixture.alert() == before
    assert report.baseline.initial_calls == 6
    assert report.agent.initial_calls == 2
    for trial in (report.baseline, report.agent):
        assert trial.mode == "scripted"
        assert trial.tool_calls == trial.initial_calls + trial.followup_calls
        assert len(trial.events) == trial.events[-1].sequence
        assert not report.comparison_eligible
        if fixture.defect == "screening_unavailable":
            assert trial.unresolved == 1
            assert trial.coverage == .5
            assert not trial.complete
            assert trial.challenges[0].status == "tool_failed"
            assert all(e.value is None for e in trial.evidence
                       if e.tool == "sanctions_screen")
        else:
            assert trial.complete
            assert trial.coverage == 1
            assert not trial.unresolved
            assert all(c.status == "resolved" for c in trial.challenges)
        active = [f for f in trial.findings if f.status == "active"]
        assert len({f.id for f in active}) == len(active)
        if fixture.defect in ("clean", "injection_attempt"):
            assert not trial.challenges
            assert trial.followup_calls == 0
        else:
            assert trial.challenges
            followups = [e.details["tool"] for e in trial.events
                         if e.kind == "tool_result" and e.details["stage"] == "followup"]
            assert set(followups) == {c.requested_tool for c in trial.challenges}
    metrics = registry.execute("graph_neighbours", {}, fixture.alert()).data
    hits = registry.execute("sanctions_screen", {}, fixture.alert()).data["hits"]
    score = arena.tools.risk_score(metrics, hits)
    assert report.policy_reference.score == score
    assert report.policy_reference.recommendation == arena.tools.decide(score, hits)


def test_budget_and_contract():
    fixture = next(f for f in arena.fixtures() if f.defect == "wrong_number")
    report = arena.trial(fixture, scripted=True, trace_id="test", max_followups=0)
    assert not report.complete
    assert report.challenges[0].status == "budget_exhausted"
    assert report.followup_calls == 0
    with pytest.raises(ValidationError):
        arena.ArenaFinding(id="x", revision=1, kind="metric_equals", tool="graph_neighbours",
                           path="structuring_hits", value=2, evidence_ids=[], score=0)


def test_revision_and_provenance():
    fixture = arena.fixtures()[0]
    ledger = arena.Ledger("current")
    record = ledger.record(registry.execute("graph_neighbours", {}, fixture.alert()), "one")
    record = next(e for e in record if e.path == "structuring_hits")
    correct = arena._claim(record, "pattern")
    ledger.revise(correct)
    assert ledger.check(correct) is None
    for changes, expected in [
        ({"evidence_ids": ["invented"]}, "unknown_id"),
        ({"evidence_ids": ["other/call/path"]}, "wrong_source"),
        ({"value": 90}, "numeric_mismatch"),
        ({"value": False}, "numeric_mismatch"),
        ({"path": "unknown_metric"}, "wrong_source"),
    ]:
        assert ledger.check(correct.model_copy(update=changes)) == expected
    wrong = correct.model_copy(update={"value": -99})
    ledger.revise(wrong)
    assert wrong.revision == 1  # revision is assigned to a new ledger object
    updated = ledger.revise(arena._claim(record, "pattern"))
    assert updated.revision == 3
    assert updated.supersedes_revision == 2
    assert sum(f.status == "active" for f in ledger.findings) == 1
    with pytest.raises(ValueError):
        ledger.record(registry.execute("graph_neighbours", {}, fixture.alert()), "one")
    fan_in = next(e for e in ledger.evidence if e.path == "fan_in")
    assert ledger.check(arena._claim(fan_in, "fanin")) is None
    wrong_source = arena._claim(record, "bad-source").model_copy(update={"tool": "lookup_account"})
    ledger.revise(wrong_source)
    assert next(c for c in ledger.critic() if c.finding_id == "bad-source").requested_tool == "graph_neighbours"


def test_objective_finish_repair_and_useful_stop(monkeypatch):
    monkeypatch.setenv("AML_LLM_PROVIDER", "ollama")
    replies = iter([
        {"tool": "lookup_account"},  # allowed but irrelevant
        {"tool": "finish", "evidence_ids": ["lookup_account:1"]},
        {"tool": "graph_neighbours"},
        {"tool": "sanctions_screen"},
        {"tool": "finish", "evidence_ids": ["sanctions_screen:1"]},
    ])
    prompts = []
    def reply(_system, prompt, *args, **kwargs):
        prompts.append(json.loads(prompt))
        return next(replies), {}
    monkeypatch.setattr(llm, "chat_json", reply)
    fixture = arena.fixtures()[0]
    report = arena.compare(fixture)
    assert report.comparison_eligible
    assert report.agent.mode == "model"
    assert report.agent.invalid_actions == 1
    assert report.agent.initial_calls == 3
    assert report.agent.unnecessary_calls == 1
    assert report.agent.coverage == 1
    assert prompts[2]["remaining_objectives"] == ["graph_neighbours", "sanctions_screen"]
    assert prompts[2]["validation_feedback"]


def test_frozen_splits_are_independent():
    dev, holdout = arena.fixtures(), arena.fixtures("holdout")
    assert len(dev) >= 12 and len(holdout) >= 12
    assert {f.id for f in dev}.isdisjoint(f.id for f in holdout)
    assert {len(f.alert()["transactions"]) for f in dev}.isdisjoint(
        len(f.alert()["transactions"]) for f in holdout)
    assert len(arena.fixture_hash()) == 64


def test_events_public_correlated():
    report = arena.compare(arena.fixtures()[1])
    for trial in (report.baseline, report.agent):
        assert {e.run_id for e in trial.events} == {trial.run_id}
        assert len({e.trace_id for e in trial.events}) == 1
        public = json.dumps([e.model_dump() for e in trial.events]).lower()
        assert not any(key in public for key in ("prompt", "api_key", "authorization"))
        assert trial.total_ms >= trial.investigator_ms
        assert trial.correction_ms >= 0


def test_objectives_timeout_and_visible_fallback(monkeypatch):
    monkeypatch.setenv("AML_LLM_PROVIDER", "ollama")
    def unavailable(*args, **kwargs):
        raise llm.ModelUnavailable("Injected model outage")
    monkeypatch.setattr(llm, "chat_json", unavailable)
    report = arena.compare(arena.fixtures()[0])
    assert report.agent.mode == "fallback"
    assert report.agent.model_requests == 2
    assert report.agent.retries == 1
    assert report.agent.coverage == 1
    assert not report.agent.complete
    assert not report.comparison_eligible
    clock = [0.0]
    monkeypatch.setattr(investigator, "monotonic", lambda: clock[0])
    def late(*args, **kwargs):
        clock[0] = 61
        return {"tool": "graph_neighbours"}, {}
    monkeypatch.setattr(llm, "chat_json", late)
    result = investigator.investigate(arena.fixtures()[0].alert(),
                                      required_tools=["graph_neighbours", "sanctions_screen"])
    assert result.mode == "partial"
    assert result.steps == []


def test_evidence_frozen_and_correction_deadline():
    fixture = arena.fixtures()[1]
    ledger = arena.Ledger("run")
    evidence = ledger.record(registry.execute("graph_neighbours", {}, fixture.alert()), "call")[0]
    with pytest.raises(ValidationError):
        evidence.value = 99
    report = arena.trial(fixture, scripted=True, trace_id="test", followup_timeout=0)
    assert report.challenges[0].status == "budget_exhausted"
    assert report.followup_calls == 0
    assert not report.complete
