import importlib.util
import json
from pathlib import Path

from aml_guardian import arena

spec = importlib.util.spec_from_file_location("arena_evals", Path(__file__).parents[1] / "evals/arena_evals.py")
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


def test_frozen_manifest_and_metric_denominators(monkeypatch):
    monkeypatch.setenv("AML_LLM_PROVIDER", "stub")
    manifest = json.loads(evaluation.FREEZE.read_text())
    assert arena.fixture_hash() == manifest["sha256"]
    assert evaluation.ratio(0, 0) is None
    empty = evaluation.summarize([], manifest["expected_checks"])
    assert empty["critic_recall"] is None
    assert empty["efficiency_goal"] == "UNMET"
    report = evaluation.run("dev", 1)
    summary = report["summary"]
    assert summary["cases"] == 12
    assert summary["critic_recall"] == 1
    assert summary["critic_false_positive_rate"] == 0
    assert summary["decision_invariance"] == 1
    assert summary["complete_model_runs"] == 0
    assert summary["excluded_pairs"] == 12
    assert summary["correction_success"] < 1  # outages remain in denominator
    assert summary["median_initial_call_reduction"] is None


def test_missing_result_not_removed_from_denominator():
    result = evaluation.summarize([{"error": "failed case"}], {})
    assert result["required_coverage_all_cases"] == 0
    assert result["excluded_pairs"] == 1
    assert result["decision_invariance"] == 0
