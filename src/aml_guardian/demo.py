"""End-to-end demo with the stub model: runs to the HITL interrupt,
then resumes with an analyst approval."""
from __future__ import annotations

from langgraph.types import Command

from .graph import build_graph

SAMPLE_ALERT = {
    "account": "ACC-4471",
    "window": "2026-10-01/2026-10-15",
    "amount": 47_500,
    "type": "cash_structuring",
    "originator": "J. DOE",
    "beneficiary": "SHELLCO TRADING",
    "transactions": [
        {"from": "ATM-1", "to": "ACC-4471", "amount": 9_500, "ts": "10-01"},
        {"from": "ATM-2", "to": "ACC-4471", "amount": 9_700, "ts": "10-03"},
        {"from": "ATM-3", "to": "ACC-4471", "amount": 9_200, "ts": "10-05"},
        {"from": "ACC-4471", "to": "SHELLCO", "amount": 28_000, "ts": "10-07"},
        {"from": "SHELLCO", "to": "ACC-4471", "amount": 9_900, "ts": "10-09"},
    ],
}


def main() -> None:
    graph = build_graph()
    config = {"configurable": {"thread_id": "demo-1"}}

    result = graph.invoke({"alert": SAMPLE_ALERT}, config)
    intr = result.get("__interrupt__")
    if intr:
        print("=== HITL interrupt ===")
        print(intr[0].value["narrative"])
        result = graph.invoke(Command(resume="APPROVE"), config)

    print("\n=== Final ===")
    print("Decision:", result.get("decision"), "| score:", result.get("risk_score"))
    print(result["messages"][-1].content
          if hasattr(result["messages"][-1], "content") else result["messages"][-1])


if __name__ == "__main__":
    main()
