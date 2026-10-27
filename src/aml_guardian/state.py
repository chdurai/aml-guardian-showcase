"""Shared case state passed between agents (typed, append-only findings)."""
from __future__ import annotations

import operator
from typing import Annotated, Literal, TypedDict

from langgraph.graph.message import add_messages


class Finding(TypedDict):
    agent: str            # which agent produced it
    claim: str            # the statement of fact
    evidence_ids: list[str]  # links into the evidence journal
    verified: bool        # set True by the critic / deterministic checks


class CaseState(TypedDict, total=False):
    case_id: str
    alert: dict                      # raw transaction-monitoring alert
    parties: list[dict]              # resolved entities
    graph_metrics: dict              # NetworkX analytics output
    citations: list[dict]            # {id, source, text} from typology RAG
    # append-only via reducer: nodes return deltas, never replace the list
    findings: Annotated[list[Finding], operator.add]
    risk_score: int                  # 0-100, computed in code only
    decision: Literal["CLEAR", "REVIEW", "FILE_SAR", "HOLD", ""]
    narrative: str                   # SAR/case draft
    narrative_grounding: dict        # model, per-sentence verification, fallback
    investigator: dict              # optional read-only action loop; never used by routing
    critic_challenges: list[str]
    challenge_round: int
    hitl_decision: str               # last human action: APPROVE_SAR / DISMISS / ESCALATE
    reviews: list[dict]              # code-validated human review records, in order
    disposition: str                 # final closure text written by case_close
    messages: Annotated[list, add_messages]
