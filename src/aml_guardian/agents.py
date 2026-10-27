"""Agent node functions. Each appends provenance-stamped findings to state."""
from __future__ import annotations

from langgraph.types import interrupt

from .guardrails import flag_injection, sanitize_untrusted
from . import grounding
from .llm import narrate, provider_name
from .state import CaseState, Finding
from . import tools
from . import registry
from . import review


def alert_intake(state: CaseState) -> dict:
    alert = state["alert"]
    case_id = tools.case_key(alert)
    finding = Finding(agent="alert_intake",
                      claim=f"Case {case_id} opened for account "
                            f"{alert['account']} (alerted amount ${alert['amount']:,}).",
                      evidence_ids=[case_id], verified=True)
    return {"case_id": case_id, "findings": [finding]}


def entity_resolution(state: CaseState) -> dict:
    # party names are untrusted: sanitize before any downstream LLM use
    parties = [
        {"name": state["alert"].get("originator", "UNKNOWN"), "role": "originator"},
        {"name": state["alert"].get("beneficiary", "UNKNOWN"), "role": "beneficiary"},
    ]
    findings = []
    for p in parties:
        flags = flag_injection(p["name"])
        p["sanitized"] = sanitize_untrusted(p["name"])
        if flags:
            findings.append(Finding(
                agent="entity_resolution",
                claim=f"Injection markers neutralized in {p['role']} name "
                      f"({len(flags)} patterns); screening uses normalized text.",
                evidence_ids=[state["case_id"]], verified=True))
    finding = Finding(agent="entity_resolution",
                      claim=f"Resolved {len(parties)} parties: "
                            + ", ".join(p["name"] for p in parties),
                      evidence_ids=[state["case_id"]], verified=True)
    findings.append(finding)
    return {"parties": parties, "findings": findings}


def graph_analysis(state: CaseState) -> dict:
    txns = state["alert"].get("transactions", [])
    metrics = registry.execute("graph_neighbours", {}, state["alert"]).data
    finding = Finding(
        agent="graph_analysis",
        claim=(f"Transaction graph: {metrics['nodes']} nodes, "
               f"fan-in {metrics['fan_in']}, {metrics['cycles']} cycles, "
               f"{metrics['structuring_hits']} sub-$10k deposits "
               + ("(structuring indicator present)." if metrics["structuring_hits"]
                  else "(no structuring indicator).")),
        evidence_ids=[state["case_id"]], verified=True)
    return {"graph_metrics": metrics, "findings": [finding]}


def typology_rag(state: CaseState) -> dict:
    query = f"structuring funnel deposits {state['alert'].get('type', '')}"
    hits = registry.execute("search_typologies", {"query": query}, state["alert"]).data["passages"]
    finding = Finding(agent="typology_rag",
                      claim="Retrieved typologies: " + ", ".join(h["id"] for h in hits),
                      evidence_ids=[h["id"] for h in hits], verified=True)
    return {"citations": hits, "findings": [finding]}


def sanctions_screening(state: CaseState) -> dict:
    hits = registry.execute("sanctions_screen", {}, state["alert"]).data["hits"]
    if hits:
        finding = Finding(agent="sanctions_screening",
                          claim=f"SANCTIONS HIT: {hits}", evidence_ids=["sanctions"],
                          verified=True)
        return {"findings": [finding], "risk_score": 100, "decision": "HOLD"}
    return {"findings": [Finding(agent="sanctions_screening",
                                 claim="No sanctions/PEP matches.",
                                 evidence_ids=["sanctions"], verified=True)]}


def risk_scoring(state: CaseState) -> dict:
    if state.get("decision") == "HOLD":
        return {}
    score = tools.risk_score(state["graph_metrics"], [])
    decision = tools.decide(score, [])
    m = state["graph_metrics"]
    finding = Finding(agent="risk_scoring",
                      claim=(f"Deterministic risk score {score}/100 -> {decision} "
                             f"(fan-in {m['fan_in']}, {m['distinct_sources']} "
                             f"distinct sources, {m['cycles']} cycles, "
                             f"betweenness {m.get('betweenness', 0)})."),
                      evidence_ids=[state["case_id"]], verified=True)
    return {"risk_score": score, "decision": decision, "findings": [finding]}


def evidence_critic(state: CaseState) -> dict:
    """Challenge findings that lack evidence. Bounded: max 2 rounds."""
    challenges = [f"Finding '{f['claim'][:40]}...' has no evidence links"
                  for f in state.get("findings", []) if not f["evidence_ids"]]
    round_no = state.get("challenge_round", 0) + 1
    return {"critic_challenges": challenges, "challenge_round": round_no}


def sar_drafter(state: CaseState) -> dict:
    """Draft narrative from VERIFIED findings only, with citation IDs."""
    if state.get("decision") == "CLEAR":
        return {"narrative": "Case cleared: no reportable activity."}
    if provider_name() != "stub":
        return grounding.draft(state)
    verified = [f for f in state.get("findings", []) if f["verified"]]
    cites = {c["id"] for c in state.get("citations", [])}
    body = "\n".join(f"- {f['claim']} [{', '.join(f['evidence_ids'])}]"
                     for f in verified)
    prompt = (f"Draft a SAR narrative for case {state['case_id']} using ONLY "
              f"these verified findings; cite typologies {sorted(cites)}:\n{body}")
    narrative = narrate(prompt) + "\n\nVerified findings:\n" + body
    return {"narrative": narrative}


def hitl_approval(state: CaseState) -> dict:
    """Human-in-the-loop: pause until a reviewer records a code-validated decision."""
    reviews = list(state.get("reviews", []))
    pending = review.pending_review(state.get("decision"), reviews)
    answer = interrupt({
        "case_id": state["case_id"],
        "risk_score": state.get("risk_score"),
        "decision": state.get("decision"),
        "level": pending.level,
        "allowed_actions": [o.action for o in pending.options if o.allowed],
        "prompt": pending.question,
    })
    if isinstance(answer, str):  # legacy CLI demo and evals resume with a bare string
        return {"hitl_decision": answer}
    # Defense in depth: the API validates first; the node re-validates before recording.
    entry = review.record(answer, state.get("decision"), reviews)
    return {"reviews": reviews + [entry], "hitl_decision": entry["action"]}


def case_close(state: CaseState) -> dict:
    outcome = review.disposition(state.get("decision"), state.get("reviews", []),
                                 state.get("hitl_decision"))
    return {"disposition": outcome, "messages": [
        ("assistant", f"Case {state['case_id']} closed: "
                      f"{state.get('decision')} "
                      f"(analyst: {state.get('hitl_decision', 'n/a')}). {outcome}")]}
