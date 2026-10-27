"""Deterministic tools: graph analytics, screening, scoring, retrieval.

LLMs never call these results into question -- code decides, LLMs narrate.
"""
from __future__ import annotations

import hashlib

import networkx as nx

# --- illustrative reference data (replace with real feeds) ---
SANCTIONS_LIST = {"EVIL CORP", "BAD ACTOR LLC"}

TYPOLOGY_DOCS = [
    {"id": "FINCEN-STRUCT", "source": "FinCEN SAR Activity Review",
     "text": "Structuring: multiple cash deposits below the $10,000 CTR "
             "threshold across branches or days to evade reporting."},
    {"id": "FFIEC-FUNNEL", "source": "FFIEC BSA/AML Manual",
     "text": "Funnel accounts: deposits in one geography rapidly withdrawn "
             "elsewhere with minimal account history."},
    {"id": "FINCEN-SHELL", "source": "FinCEN Guidance on Shell Companies",
     "text": "Shell entities: no physical presence, layered transfers between "
             "related parties, and round-dollar amounts."},
]


def case_key(alert: dict) -> str:
    raw = f"{alert.get('account')}:{alert.get('window')}:{alert.get('amount')}"
    return hashlib.sha256(raw.encode()).hexdigest()[:12]


def build_txn_graph(transactions: list[dict]) -> nx.DiGraph:
    g = nx.DiGraph()
    for tx in transactions:
        g.add_edge(tx["from"], tx["to"], amount=tx["amount"], ts=tx.get("ts"))
    return g


def _pagerank(g: nx.DiGraph, damping: float = 0.85, iters: int = 100,
              tol: float = 1e-6) -> dict:
    """Pure-Python PageRank (avoids numpy/scipy for tiny case graphs)."""
    nodes = list(g.nodes)
    n = len(nodes)
    pr = {v: 1.0 / n for v in nodes}
    for _ in range(iters):
        new = {v: (1 - damping) / n for v in nodes}
        for u in nodes:
            out = g.out_degree(u)
            share = damping * pr[u] / (out if out else n)
            targets = list(g.successors(u)) if out else nodes
            for v in targets:
                new[v] += share
        if sum(abs(new[v] - pr[v]) for v in nodes) < tol:
            pr = new
            break
        pr = new
    return pr


def analyze_graph(transactions: list[dict], account: str) -> dict:
    """NetworkX analytics: fan-in/out, cycles, centrality, smurfing and
    structuring pattern detection."""
    g = build_txn_graph(transactions)
    metrics: dict = {
        "nodes": g.number_of_nodes(),
        "edges": g.number_of_edges(),
        "fan_in": g.in_degree(account) if account in g else 0,
        "fan_out": g.out_degree(account) if account in g else 0,
        "cycles": len(list(nx.simple_cycles(g))) if g.number_of_nodes() else 0,
    }
    if g.number_of_nodes():
        pr = _pagerank(g)
        bc = nx.betweenness_centrality(g)
        metrics["pagerank"] = round(pr.get(account, 0.0), 4)
        metrics["betweenness"] = round(bc.get(account, 0.0), 4)
    # smurfing: many DISTINCT sources feeding the account
    metrics["distinct_sources"] = len({t["from"] for t in transactions
                                       if t["to"] == account})
    sub_10k = [t for t in transactions
               if 9_000 <= t["amount"] < 10_000 and t["to"] == account]
    metrics["structuring_hits"] = len(sub_10k)
    # layering heuristic: large round-dollar transfers
    metrics["round_amount_hits"] = len(
        [t for t in transactions
         if t["amount"] >= 20_000 and t["amount"] % 1_000 == 0])
    return metrics


def _bm25(query: str, docs: list[dict], k: int) -> list[dict]:
    """Pure-Python BM25 over the typology corpus (swap for a vector +
    BM25 hybrid store in production)."""
    import math
    q_terms = query.lower().split()
    tokenized = [d["text"].lower().split() for d in docs]
    avg_len = sum(len(t) for t in tokenized) / max(len(tokenized), 1)
    scored = []
    for doc, terms in zip(docs, tokenized):
        score = 0.0
        for qt in q_terms:
            tf = terms.count(qt)
            if tf:
                idf = math.log(1 + (len(docs) - 1 + 0.5) / (tf + 0.5))
                score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * len(terms) / avg_len))
        scored.append((score, doc))
    scored.sort(key=lambda s: -s[0])
    return [dict(d, bm25=round(s, 3)) for s, d in scored[:k] if s > 0]


def retrieve_typologies(query: str, k: int = 2) -> list[dict]:
    return _bm25(query, TYPOLOGY_DOCS, k)


def sanctions_screen(parties: list[dict]) -> list[dict]:
    """Fuzzy match against the sanctions list. A hit forces HOLD."""
    hits = []
    for p in parties:
        name = p.get("name", "").upper()
        for s in SANCTIONS_LIST:
            if s in name or name in s:
                hits.append({"party": p.get("name"), "match": s})
    return hits


def retrieve_typologies(query: str, k: int = 2) -> list[dict]:
    """BM25 retrieval over the typology corpus."""
    return _bm25(query, TYPOLOGY_DOCS, k)


def risk_score(metrics: dict, sanctions_hits: list[dict]) -> int:
    """Deterministic scorecard. The LLM never adjusts this number."""
    score = 0
    score += min(metrics.get("structuring_hits", 0) * 25, 50)
    score += min(metrics.get("fan_in", 0) * 5, 20)
    score += min(metrics.get("cycles", 0) * 25, 50)
    score += min(metrics.get("distinct_sources", 0) * 10, 30)  # smurfing
    score += min(metrics.get("round_amount_hits", 0) * 10, 20)  # layering
    if sanctions_hits:
        score = 100
    return min(score, 100)


def decide(score: int, sanctions_hits: list[dict]) -> str:
    if sanctions_hits:
        return "HOLD"   # zero-tipping-off: escalate silently
    if score >= 70:
        return "FILE_SAR"
    if score >= 40:
        return "REVIEW"
    return "CLEAR"
