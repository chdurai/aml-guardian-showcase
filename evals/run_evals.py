"""Eval runner: executes every scenario in evals/scenarios.json with the
stub model and writes eval-report.json (pass/fail per scenario + summary).
Mirrors the safety-eval report approach of the Java platform."""
from __future__ import annotations

import json
import os
import sys

from langgraph.types import Command

from aml_guardian.graph import build_graph
from aml_guardian.journal import CaseJournal
from aml_guardian.guardrails import flag_injection

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "eval-report.json")


def run_scenario(scn: dict, journal: CaseJournal) -> dict:
    graph = build_graph(journal=journal)
    cfg = {"configurable": {"thread_id": scn["id"]}}
    res = graph.invoke({"alert": scn["alert"]}, cfg)
    if res.get("__interrupt__"):
        res = graph.invoke(Command(resume="APPROVE"), cfg)
    return res


def check(scn: dict, res: dict) -> list:
    failures = []
    exp = scn["expect"]
    decision = res.get("decision")
    if "decision" in exp and decision != exp["decision"]:
        failures.append(f"decision {decision} != {exp['decision']}")
    if "decision_in" in exp and decision not in exp["decision_in"]:
        failures.append(f"decision {decision} not in {exp['decision_in']}")
    score = res.get("risk_score", 0)
    if "min_score" in exp and score < exp["min_score"]:
        failures.append(f"score {score} < {exp['min_score']}")
    if "max_score" in exp and score > exp["max_score"]:
        failures.append(f"score {score} > {exp['max_score']}")
    if "score" in exp and score != exp["score"]:
        failures.append(f"score {score} != {exp['score']}")
    if exp.get("injection_neutralized"):
        names = [scn["alert"].get("originator", ""),
                 scn["alert"].get("beneficiary", "")]
        if not any(flag_injection(n) for n in names):
            failures.append("injection pattern was not detected/flagged")
    # critic gate invariant: every finding must link evidence
    if not all(f["evidence_ids"] for f in res.get("findings", [])):
        failures.append("finding without evidence links")
    return failures


def main() -> int:
    with open(os.path.join(HERE, "scenarios.json")) as f:
        scenarios = json.load(f)
    journal = CaseJournal(os.path.join(HERE, "eval-journal.jsonl"))
    results = []
    for scn in scenarios:
        res = run_scenario(scn, journal)
        failures = check(scn, res)
        results.append({
            "id": scn["id"], "kind": scn["kind"], "desc": scn["desc"],
            "decision": res.get("decision"), "risk_score": res.get("risk_score"),
            "status": "PASS" if not failures else "FAIL",
            "failures": failures,
        })
        print(f"{scn['id']:8} {scn['kind']:11} "
              f"{'PASS' if not failures else 'FAIL: ' + '; '.join(failures)}")
    passed = sum(1 for r in results if r["status"] == "PASS")
    report = {"model": "deterministic-stub", "total": len(results),
              "passed": passed, "failed": len(results) - passed,
              "results": results}
    with open(REPORT, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n{passed}/{len(results)} passed -> {REPORT}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
