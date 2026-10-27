"""Frozen paired synthetic evaluation. Fallbacks remain in all-case results."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from statistics import median

from aml_guardian import arena

ROOT = Path(__file__).resolve().parents[1]
FREEZE = ROOT / "evals/arena-freeze-v1.json"


def ratio(numerator, denominator):
    return numerator / denominator if denominator else None


def summarize(rows: list[dict], expected: dict) -> dict:
    reports = [arena.ComparisonReport.model_validate(row["report"]) for row in rows if row.get("report")]
    trials = [r.agent for r in reports if r.agent]
    eligible = [r for r in reports if r.comparison_eligible]
    planted = detected = false_positives = clean_checked = resolved = challenges = 0
    for row in rows:
        if not row.get("report"):
            continue
        report = arena.ComparisonReport.model_validate(row["report"])
        trial = report.agent
        if trial is None:
            continue
        rubric = expected[row["defect"]]
        planted += len(rubric)
        detected += sum(any(c.finding_id == finding and c.check in checks for c in trial.challenges)
                        for finding, checks in rubric.items())
        clean = {f.id for f in trial.findings if f.revision == 1} - rubric.keys()
        clean_checked += len(clean)
        false_positives += sum(c.finding_id in clean for c in trial.challenges)
        challenges += len(trial.challenges)
        resolved += sum(c.status == "resolved" for c in trial.challenges)
    baseline_calls = median([r.baseline.initial_calls for r in eligible]) if eligible else None
    agent_calls = median([r.agent.initial_calls for r in eligible]) if eligible else None
    reduction = 1 - agent_calls / baseline_calls if baseline_calls and agent_calls is not None else None
    invariance = ratio(sum(row.get("policy_invariant", False) for row in rows), len(rows))
    return {
        "cases": len(rows), "errors": sum(bool(row.get("error")) for row in rows),
        "complete_model_runs": sum(t.complete and t.mode == "model" for t in trials),
        "excluded_pairs": len(rows) - len(eligible), "eligible_pairs": len(eligible),
        "required_coverage_all_cases": ratio(sum(t.coverage for t in trials), len(rows)),
        "critic_recall": ratio(detected, planted), "planted_defects": planted, "detected_defects": detected,
        "critic_false_positive_rate": ratio(false_positives, clean_checked),
        "clean_findings_checked": clean_checked,
        "correction_success": ratio(resolved, challenges), "eligible_challenges_including_outages": challenges,
        "decision_invariance": invariance, "read_only": all(row.get("read_only", False) for row in rows),
        "median_initial_baseline_calls_eligible": baseline_calls,
        "median_initial_agent_calls_eligible": agent_calls,
        "median_initial_call_reduction": reduction,
        "efficiency_goal": "PASSED" if reduction is not None and reduction >= .2 else "UNMET",
        "median_agent_total_ms_all_cases": median([t.total_ms for t in trials]) if trials else None,
        "p95_agent_total_ms": None,
        "p95_note": "Not reported: this small synthetic sample does not support a robust tail estimate.",
        "model_requests": sum(t.model_requests for t in trials),
        "reported_prompt_tokens": sum(t.prompt_tokens for t in trials),
        "reported_output_tokens": sum(t.output_tokens for t in trials),
        "usage_note": "Provider-reported successful responses only; failed requests may have unreported usage. No cost estimate.",
        "policy_note": "Invariance of shared fixed-specialist reference; the model never emits a decision.",
    }


def run(split: str, repeats: int) -> dict:
    freeze = json.loads(FREEZE.read_text())
    if arena.fixture_hash() != freeze["sha256"]:
        raise ValueError("Frozen fixture hash mismatch. Version a new set; do not silently change this benchmark.")
    rows = []
    for repeat in range(repeats):
        for fixture in arena.fixtures(split):
            print(f"{split} repeat {repeat + 1}: {fixture.id}", flush=True)
            before = fixture.alert()
            report = arena.compare(fixture)
            metrics = arena.registry.execute("graph_neighbours", {}, before).data
            hits = arena.registry.execute("sanctions_screen", {}, before).data["hits"]
            score = arena.tools.risk_score(metrics, hits)
            rows.append({
                "fixture_id": fixture.id, "defect": fixture.defect, "repeat": repeat + 1,
                "read_only": before == fixture.alert(),
                "policy_invariant": (report.policy_reference.score == score and
                                     report.policy_reference.recommendation == arena.tools.decide(score, hits)),
                "expected_outcome": "unresolved" if fixture.defect == "screening_unavailable" else "resolved_or_clean",
                "report": report.model_dump(),
            })
    return {"version": arena.VERSION, "fixture_hash": arena.fixture_hash(),
            "frozen_manifest": freeze, "created_at": datetime.now(timezone.utc).isoformat(),
            "split": split, "repeats": repeats, "provider": arena.llm.provider_name(),
            "model": arena.llm.model_name(), "runtime": {
                "temperature": 0, "model_seed": 7, "num_ctx": 4096, "num_predict": 700,
                "warm_state": "per_comparison_probe", "execution": "sequential",
                "workstation_load": "shared_workstation_not_controlled"},
            "summary": summarize(rows, freeze["expected_checks"]), "results": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split", choices=("dev", "holdout"), required=True)
    parser.add_argument("--provider", choices=("stub", "ollama"), required=True)
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--saved", type=Path, help="Write one labelled comparison for the offline demo.")
    parser.add_argument("--public-summary", type=Path, help="Write a labelled compact summary for the portfolio.")
    args = parser.parse_args()
    if not 1 <= args.repeats <= 10:
        parser.error("--repeats must be between 1 and 10")
    os.environ["AML_LLM_PROVIDER"] = args.provider
    report = run(args.split, args.repeats)
    target = args.output or ROOT / f"evals/arena-{args.split}-{args.provider}-report.json"
    target.write_text(json.dumps(report, indent=2) + "\n")
    if args.public_summary:
        summary = {key: value for key, value in report.items() if key != "results"}
        summary["label"] = "SAVED EVALUATION - not live execution"
        args.public_summary.write_text(json.dumps(summary, indent=2) + "\n")
    if args.saved:
        selected = next(row["report"] for row in report["results"] if row["defect"] == "wrong_number")
        args.saved.write_text(json.dumps(selected, indent=2) + "\n")
    print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    main()
