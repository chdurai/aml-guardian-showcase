from copy import deepcopy

import pytest

from aml_guardian import investigator, registry
from aml_guardian.demo import SAMPLE_ALERT
from aml_guardian.graph import build_graph
from aml_guardian.journal import CaseJournal


def test_registry_schemas_and_read_only():
    before = deepcopy(SAMPLE_ALERT)
    assert len(registry.list_tools()) == 6
    for spec in registry.list_tools():
        result = registry.execute(spec["name"], {"query": "structuring cash deposits"}, SAMPLE_ALERT)
        assert result.tool == spec["name"]
        assert spec["input_schema"]["additionalProperties"] is False
    assert SAMPLE_ALERT == before
    with pytest.raises(ValueError):
        registry.execute("approve", {}, SAMPLE_ALERT)
    with pytest.raises(ValueError):
        registry.execute("lookup_account", {"account": "another-case"}, SAMPLE_ALERT)


def test_scripted_is_not_claimed_as_model():
    report = investigator.investigate(SAMPLE_ALERT)
    assert report.mode == "scripted"
    assert len(report.steps) == 2
    assert all(s.chosen_by == "scripted" for s in report.steps)
    assert report.model_calls == 0


def test_progress_callback_is_per_tool():
    steps = []
    report = investigator.investigate(SAMPLE_ALERT, on_step=steps.append)
    assert steps == report.steps


def test_valid_model_calls_and_finish(monkeypatch):
    monkeypatch.setenv("AML_LLM_PROVIDER", "ollama")
    replies = iter([
        {"tool": "graph_neighbours"},
        {"tool": "sanctions_screen"},
        {"tool": "finish", "evidence_ids": ["graph_neighbours:1", "sanctions_screen:1"]},
    ])
    timeouts = []
    def reply(*args, **kwargs):
        timeouts.append(kwargs["timeout_s"])
        return next(replies), {}
    monkeypatch.setattr("aml_guardian.llm.chat_json", reply)
    report = investigator.investigate(SAMPLE_ALERT)
    assert report.mode == "model"
    assert report.model_calls == 3
    assert len(report.summary) == 2
    assert all(0 < t <= 60 for t in timeouts)
    assert all(s.chosen_by == "model" for s in report.steps)


def test_invalid_model_calls_visible_fallback(monkeypatch):
    monkeypatch.setenv("AML_LLM_PROVIDER", "ollama")
    monkeypatch.setattr("aml_guardian.llm.chat_json", lambda *a, **kw: (
        {"tool": "finish", "evidence_ids": ["invented"]}, {}))
    report = investigator.investigate(SAMPLE_ALERT)
    assert report.mode == "fallback"
    assert report.invalid_calls == 2
    assert report.errors
    assert "invented" not in report.selected_ids
    assert all(s.chosen_by == "scripted" for s in report.steps)


def test_step_budget_is_exact(monkeypatch):
    monkeypatch.setenv("AML_LLM_PROVIDER", "ollama")
    monkeypatch.setattr("aml_guardian.llm.chat_json", lambda *a, **kw: (
        {"tool": "graph_neighbours"}, {}))
    report = investigator.investigate(SAMPLE_ALERT, max_calls=1)
    assert len(report.steps) == 1
    assert report.mode == "partial"
    with pytest.raises(ValueError):
        investigator.investigate(SAMPLE_ALERT, max_calls=7)


def test_time_budget_does_not_execute_late_tool(monkeypatch):
    monkeypatch.setenv("AML_LLM_PROVIDER", "ollama")
    clock = [0.0]
    monkeypatch.setattr(investigator, "monotonic", lambda: clock[0])
    def late(*a, **kw):
        clock[0] = 61
        return {"tool": "graph_neighbours"}, {}
    monkeypatch.setattr("aml_guardian.llm.chat_json", late)
    report = investigator.investigate(SAMPLE_ALERT)
    assert report.mode == "partial"
    assert report.steps == []


@pytest.mark.parametrize("enabled", [False, True])
def test_decision_unchanged(tmp_path, enabled):
    graph = build_graph(journal=CaseJournal(str(tmp_path / "journal.jsonl")),
                        investigator_enabled=enabled)
    result = graph.invoke({"alert": SAMPLE_ALERT}, {"configurable": {"thread_id": "test"}})
    assert result["risk_score"] == 100
    assert result["decision"] == "FILE_SAR"
    assert bool(result.get("investigator")) == enabled
    assert result.get("__interrupt__")
