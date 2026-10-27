"""Local model bake-off: same cases, same prompt, same deterministic verifier.

    AML_LLM_PROVIDER=ollama python evals/model_bakeoff.py [model ...]

Writes evals/reports/model-bakeoff.json and .md. Selection rule (in order):
fewest deterministic fallbacks, highest first-attempt sentence acceptance,
then lowest median latency. Scores and decisions are identical for every
model by construction; only the narrative differs."""
from __future__ import annotations

import json
import os
import statistics
import sys
from datetime import datetime, timezone

os.environ.setdefault("AML_LLM_PROVIDER", "ollama")
os.environ.setdefault("AML_JOURNAL_PATH", os.devnull)

from aml_guardian import grounding, llm  # noqa: E402
from aml_guardian.api import scenario_alert  # noqa: E402
from aml_guardian.graph import build_graph  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "reports")
EVALS = {s["id"]: s for s in json.load(open(os.path.join(HERE, "scenarios.json")))}
CASES = [("structuring", scenario_alert("structuring")), ("screening", scenario_alert("screening")),
         ("review", scenario_alert("review"))] + [(i, EVALS[i]["alert"]) for i in ("GOLD-02", "GOLD-04", "ADV-01", "ADV-02")]


def first_attempt_counter():
    """Wrap the chat call to record how the very first draft fared."""
    record = {}
    original = llm.chat_json

    def chat(system, user, schema):
        reply, meta = original(system, user, schema)
        record.setdefault("first", reply)
        return reply, meta
    return record, chat


def run_model(model: str) -> dict:
    os.environ["AML_MODEL"] = model
    rows = []
    for name, alert in CASES:
        record, chat = first_attempt_counter()
        grounding_draft = grounding.draft
        grounding.draft = lambda state, _chat=chat, _d=grounding_draft: _d(state, _chat)
        try:
            result = build_graph().invoke({"alert": alert}, {"configurable": {"thread_id": f"{model}-{name}"}})
        finally:
            grounding.draft = grounding_draft
        g = result["narrative_grounding"]
        first = grounding.verify(record.get("first", {}).get("sentences", []), g["facts"],
                                 result.get("decision", ""), result.get("risk_score"))
        rows.append({
            "case": name, "decision": result.get("decision"), "mode": g["mode"], "attempts": g["attempts"],
            "first_accepted": sum(s["status"] == "verified" for s in first), "first_total": len(first),
            "final_accepted": g["accepted"], "latency_ms": g["latency_ms"],
            "output_tokens": g["output_tokens"], "error": g["error"],
            "rejections": [{"text": s["text"], "issues": s["issues"]} for s in first if s["status"] == "rejected"],
            "narrative": [s["text"] for s in g["sentences"] if s["status"] == "verified"],
        })
        print(f"  {model:14} {name:12} {g['mode']:8} first {rows[-1]['first_accepted']}/{rows[-1]['first_total']}"
              f"  final {g['accepted']}  {g['latency_ms'] / 1000:5.1f}s", flush=True)
    first_total = sum(r["first_total"] for r in rows) or 1
    return {"model": model, **llm.MODEL_CATALOG.get(model, {}), "cases": rows,
            "fallbacks": sum(r["mode"] == "fallback" for r in rows),
            "first_attempt_acceptance": round(sum(r["first_accepted"] for r in rows) / first_total, 3),
            "repairs": sum(r["attempts"] > 1 for r in rows),
            "median_latency_ms": statistics.median(r["latency_ms"] for r in rows)}


def main(models):
    if llm.provider_name() != "ollama":
        sys.exit("Set AML_LLM_PROVIDER=ollama")
    results = [run_model(m) for m in models]
    ranked = sorted(results, key=lambda r: (r["fallbacks"], -r["first_attempt_acceptance"], r["median_latency_ms"]))
    report = {"generated_at": datetime.now(timezone.utc).isoformat(), "selection": ranked[0]["model"],
              "rule": "fewest fallbacks, then highest first-attempt acceptance, then lowest median latency",
              "hardware": "Apple M1, 8 GB unified memory (local Ollama)", "results": ranked}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "model-bakeoff.json"), "w") as fh:
        json.dump(report, fh, indent=2)
    lines = ["# Local model bake-off", "",
             f"Generated {report['generated_at'][:16]}Z on {report['hardware']}. {len(CASES)} cases per model, "
             "temperature 0, identical prompt and verifier. Selection rule: " + report["rule"] + ".", "",
             "| Rank | Model | Publisher | License | Fallbacks | First-attempt sentences accepted | Repairs | Median latency |",
             "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for i, r in enumerate(ranked, 1):
        lines.append(f"| {i} | `{r['model']}` | {r.get('publisher', '')} | {r.get('license', '')} | {r['fallbacks']}/{len(CASES)} "
                     f"| {r['first_attempt_acceptance']:.0%} | {r['repairs']} | {r['median_latency_ms'] / 1000:.1f} s |")
    lines += ["", f"**Selected default:** `{report['selection']}`.", "",
              "## Examples of sentences the verifier rejected (first attempts)", ""]
    for r in ranked:
        for c in r["cases"]:
            for rej in c["rejections"][:1]:
                lines.append(f"- `{r['model']}` · {c['case']}: “{rej['text'][:140]}” → {'; '.join(rej['issues'])}")
    with open(os.path.join(OUT, "model-bakeoff.md"), "w") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"\nSelected: {report['selection']} -> {OUT}/model-bakeoff.md")


if __name__ == "__main__":
    main(sys.argv[1:] or list(llm.MODEL_CATALOG))
