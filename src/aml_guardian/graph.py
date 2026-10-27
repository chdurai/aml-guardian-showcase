"""LangGraph wiring: supervisor-free DAG with a bounded critic loop and a
HITL interrupt. Deterministic routing functions decide every edge."""
from __future__ import annotations

import os
from time import perf_counter

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from . import agents
from .journal import CaseJournal
from .state import CaseState
from .telemetry import span


def _journaled(name, fn, journal):
    """Wrap a node so its input snapshot and output delta are journaled."""
    def wrapped(state):
        case_id = state.get("case_id", "pre-intake")
        journal.record(case_id, name, "enter",
                       {"decision": state.get("decision", "")})
        started = perf_counter()
        with span(f"node.{name}", node=name, case_id=case_id):
            delta = fn(state)
        journal.record(state.get("case_id", case_id), name, "exit", delta)
        if hasattr(journal, "receipt"):
            journal.receipt(name, state, delta, (perf_counter() - started) * 1000)
        return delta
    return wrapped


def _route_after_intake(state: CaseState) -> str:
    return "entity_resolution"


def _route_after_scoring(state: CaseState) -> str:
    if state.get("decision") == "CLEAR":
        return "sar_drafter"
    return "evidence_critic"


def _route_after_drafter(state: CaseState) -> str:
    # Cleared cases close without consuming analyst time.
    if state.get("decision") == "CLEAR":
        return "case_close"
    return "hitl_approval"


def _route_after_critic(state: CaseState) -> str:
    # Bounded challenge loop: unresolved challenges re-route to the owning
    # agent once, then escalate to the human regardless.
    if state.get("critic_challenges") and state.get("challenge_round", 0) < 2:
        return "alert_intake"
    return "sar_drafter"


def _route_after_review(state: CaseState) -> str:
    # Escalation returns to the checkpoint for a second reviewer; review.py caps the level.
    return "hitl_approval" if state.get("hitl_decision") == "ESCALATE" else "case_close"


def build_graph(checkpointer=None, journal: CaseJournal = None, investigator_enabled=None):
    journal = journal or CaseJournal(
        os.getenv("AML_JOURNAL_PATH", "case-journal.jsonl"))
    g = StateGraph(CaseState)
    enabled = (os.getenv("AML_ENABLE_INVESTIGATOR", "0") == "1"
               if investigator_enabled is None else investigator_enabled)
    for name in ("alert_intake", "entity_resolution", "graph_analysis",
                 "typology_rag", "sanctions_screening", "risk_scoring",
                 "evidence_critic", "sar_drafter", "hitl_approval",
                 "case_close"):
        g.add_node(name, _journaled(name, getattr(agents, name), journal))

    g.set_entry_point("alert_intake")
    g.add_conditional_edges("alert_intake", _route_after_intake,
                            {"entity_resolution": "entity_resolution"})
    if enabled:
        from .investigator import investigate
        def read_only_investigator(state):
            callback = journal.progress if hasattr(journal, "progress") else None
            return {"investigator": investigate(state["alert"], on_step=callback).model_dump()}
        g.add_node("investigator", _journaled("investigator", read_only_investigator, journal))
        g.add_edge("entity_resolution", "investigator")
        g.add_edge("investigator", "graph_analysis")
    else:
        g.add_edge("entity_resolution", "graph_analysis")
    g.add_edge("graph_analysis", "typology_rag")
    g.add_edge("typology_rag", "sanctions_screening")
    g.add_edge("sanctions_screening", "risk_scoring")
    g.add_conditional_edges("risk_scoring", _route_after_scoring,
                            {"sar_drafter": "sar_drafter",
                             "evidence_critic": "evidence_critic"})
    g.add_conditional_edges("evidence_critic", _route_after_critic,
                            {"alert_intake": "alert_intake",
                             "sar_drafter": "sar_drafter"})
    g.add_conditional_edges("sar_drafter", _route_after_drafter,
                            {"case_close": "case_close",
                             "hitl_approval": "hitl_approval"})
    g.add_conditional_edges("hitl_approval", _route_after_review,
                            {"hitl_approval": "hitl_approval",
                             "case_close": "case_close"})
    g.add_edge("case_close", END)

    return g.compile(checkpointer=checkpointer or MemorySaver())
