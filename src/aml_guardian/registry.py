"""One read-only tool contract for graph nodes, the investigator and MCP."""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Callable

from pydantic import BaseModel, ConfigDict, Field

from . import tools
from .guardrails import redact_injection
from .policy import PolicyRetriever
from .telemetry import span


class ToolInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    query: str = Field(default="", max_length=400)


class Evidence(BaseModel):
    id: str
    text: str


class ToolResult(BaseModel):
    tool: str
    data: dict[str, Any]
    facts: list[Evidence]


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    run: Callable[[dict[str, Any], ToolInput], dict[str, Any]]


def _account(alert: dict[str, Any], args: ToolInput) -> dict[str, Any]:
    return {k: alert.get(k) for k in ("account", "window", "amount", "type")}


def _transactions(alert: dict[str, Any], args: ToolInput) -> dict[str, Any]:
    return {"transactions": alert.get("transactions", [])}


def _graph(alert: dict[str, Any], args: ToolInput) -> dict[str, Any]:
    return tools.analyze_graph(alert.get("transactions", []), alert["account"])


def _screen(alert: dict[str, Any], args: ToolInput) -> dict[str, Any]:
    parties = [{"name": alert.get(k, "UNKNOWN")} for k in ("originator", "beneficiary")]
    return {"hits": tools.sanctions_screen(parties)}


def _typologies(alert: dict[str, Any], args: ToolInput) -> dict[str, Any]:
    return {"passages": tools.retrieve_typologies(redact_injection(args.query))}


def _policy(alert: dict[str, Any], args: ToolInput) -> dict[str, Any]:
    return {"passages": [
        {"id": doc.metadata["id"], "text": doc.page_content}
        for doc in PolicyRetriever().invoke(redact_injection(args.query))
    ]}


TOOLS = (
    Tool("lookup_account", "Read the selected synthetic account's alert metadata.", _account),
    Tool("list_transactions", "Read transactions in the selected synthetic case.", _transactions),
    Tool("graph_neighbours", "Compute transaction graph metrics and deposit indicators.", _graph),
    Tool("sanctions_screen", "Check parties against the illustrative local name list.", _screen),
    Tool("search_typologies", "Find lexical typology extracts; supply a query.", _typologies),
    Tool("search_policy", "Find original educational policy notes; supply a query.", _policy),
)
_BY_NAME = {tool.name: tool for tool in TOOLS}


def list_tools() -> list[dict[str, Any]]:
    return [{"name": tool.name, "description": tool.description,
             "input_schema": ToolInput.model_json_schema(),
             "output_schema": ToolResult.model_json_schema(), "read_only": True}
            for tool in TOOLS]


def execute(name: str, arguments: dict[str, Any], alert: dict[str, Any]) -> ToolResult:
    if name not in _BY_NAME:
        raise ValueError(f"Unknown read-only tool: {name}")
    args = ToolInput.model_validate(arguments)
    with span(f"tool.{name}", tool=name):
        data = _BY_NAME[name].run(deepcopy(alert), args)
    # Facts are exact code-owned extracts, not model-written claims.
    if name == "graph_neighbours":
        texts = [f"{key}: {value}" for key, value in data.items()]
    elif name in ("search_policy", "search_typologies"):
        texts = [f"{p['id']}: {p['text']}" for p in data["passages"]]
    elif name == "sanctions_screen":
        texts = [f"Illustrative sanctions matches: {len(data['hits'])}."]
    elif name == "list_transactions":
        transactions = data["transactions"]
        texts = [f"Transactions in this alert: {len(transactions)}. Showing at most 20."]
        texts.extend(
            f"{tx['from']} -> {tx['to']}: {tx['amount']} USD; date {tx.get('ts', 'unknown')}."
            for tx in transactions[:20])
    else:
        texts = [f"{key}: {value}" for key, value in data.items()]
    facts = [Evidence(id=f"{name}:{index}", text=text) for index, text in enumerate(texts, 1)]
    return ToolResult(tool=name, data=data, facts=facts)
