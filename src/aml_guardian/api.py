"""Local synthetic-data API. No customer intake; human dispositions go through
the code-validated review policy in review.py."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, timezone
import logging
import os
from threading import BoundedSemaphore, Lock
from time import monotonic, perf_counter, sleep
from typing import Dict, List, Literal, Optional
from uuid import uuid4
import asyncio
import json

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from langgraph.types import Command
from pydantic import BaseModel, ConfigDict, Field

from . import llm, policy, stories
from . import review as review_policy
from .demo import SAMPLE_ALERT
from .graph import build_graph
from .durability import DurableData
from .investigator import Report, Step
from .telemetry import configure
from .arena_api import ArenaStore, router as arena_router

logger = logging.getLogger(__name__)
Scenario = Literal["structuring", "routine", "screening", "review"]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class CreateCase(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scenario: Scenario


class CreateStory(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["design", "challenge"] = "design"
    description: str = Field(default="", max_length=400)


class SeedCases(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scenarios: List[Scenario] = Field(
        default=["structuring", "routine", "screening", "review"],
        min_length=1, max_length=8)
    reset: bool = True


class Event(BaseModel):
    sequence: int
    node: str
    phase: Literal["started", "completed"]
    timestamp: str
    summary: List[str] = []
    evidence_ids: List[str] = []
    duration_ms: Optional[float] = None


class Transaction(BaseModel):
    source: str
    target: str
    amount: float
    timestamp: str


class FindingView(BaseModel):
    agent: str
    claim: str
    evidence_ids: List[str]


class Source(BaseModel):
    id: str
    source: str
    text: str


class Metrics(BaseModel):
    nodes: int = 0
    fan_in: int = 0
    cycles: int = 0
    structuring_hits: int = 0


class GroundingFact(BaseModel):
    id: str
    agent: str
    text: str


class GroundedSentence(BaseModel):
    text: str
    facts: List[str]
    status: Literal["verified", "rejected"]
    issues: List[str]


class Grounding(BaseModel):
    mode: Literal["model", "fallback"]
    provider: str
    model: str
    attempts: int
    latency_ms: float
    prompt_tokens: int
    output_tokens: int
    accepted: int
    rejected: int
    error: Optional[str] = None
    facts: List[GroundingFact]
    sentences: List[GroundedSentence]
    earlier_rejected: List[GroundedSentence] = []


class Runtime(BaseModel):
    provider: str
    model: str
    family: Optional[str] = None
    publisher: Optional[str] = None
    license: Optional[str] = None
    reachable: Optional[bool] = None
    installed: Optional[bool] = None


class CaseView(BaseModel):
    id: str
    scenario: Literal["structuring", "routine", "screening", "review", "custom"]
    account: str
    originator: str
    beneficiary: str
    window: str
    currency: str = "USD"
    created_at: str
    updated_at: str
    status: Literal["running", "awaiting_human", "completed", "failed"]
    graph_case_id: Optional[str] = None
    recommendation: Optional[Literal["CLEAR", "REVIEW", "FILE_SAR", "HOLD"]] = None
    score: Optional[int] = None
    transactions: List[Transaction]
    findings: List[FindingView] = []
    sources: List[Source] = []
    metrics: Metrics = Metrics()
    narrative: str = ""
    grounding: Optional[Grounding] = None
    events: List[Event] = []
    error: Optional[str] = None
    story: Optional[stories.Story] = None
    investigator: Optional[Report] = None
    review: Optional[review_policy.PendingReview] = None
    reviews: List[review_policy.ReviewRecord] = []
    disposition: Optional[str] = None


def scenario_alert(scenario: Scenario) -> dict:
    alert = deepcopy(SAMPLE_ALERT)
    if scenario == "routine":
        alert.update(account="ACC-0001", originator="A SMITH",
                     beneficiary="B JONES", amount=3000, type="routine_transfer",
                     transactions=[{"from": "EMPLOYER", "to": "ACC-0001",
                                    "amount": 3000, "ts": "10-01"}])
    elif scenario == "screening":
        alert.update(account="ACC-9999", beneficiary="EVIL CORP",
                     amount=0, transactions=[])
    elif scenario == "review":
        alert.update(account="ACC-0040", originator="SYNTHETIC SENDER",
                     beneficiary="SYNTHETIC RECIPIENT", amount=9500,
                     type="single_threshold_indicator",
                     transactions=[{"from": "SENDER-1", "to": "ACC-0040",
                                    "amount": 9500, "ts": "10-01"}])
    return alert


class PublicJournal:
    def __init__(self, store: "CaseStore", case_id: str):
        self.store = store
        self.case_id = case_id
        self.started: Dict[str, float] = {}

    def record(self, _graph_case_id, node, phase, payload):
        duration = None
        summaries = []
        evidence_ids = []
        if phase == "enter":
            self.started[node] = perf_counter()
        else:
            duration = round((perf_counter() - self.started[node]) * 1000, 3)
            findings = payload.get("findings", [])
            summaries = [f["claim"] for f in findings]
            evidence_ids = sorted({ref for f in findings for ref in f["evidence_ids"]})
            if node == "evidence_critic":
                summaries.append(
                    f"Checked for missing evidence references: "
                    f"{len(payload.get('critic_challenges', []))} challenges. "
                    "This does not check factual support.")
            elif node == "sar_drafter":
                g = payload.get("narrative_grounding")
                if not g:
                    summaries.append("Prepared the read-only narrative output; no report filed.")
                elif g["mode"] == "fallback":
                    summaries.append(
                        f"Local model {g['model']} did not produce enough verified sentences "
                        f"({g['accepted']} accepted, {g['rejected']} rejected); used the deterministic "
                        "fact template instead. No report filed.")
                else:
                    caught = g["rejected"] + len(g.get("earlier_rejected", []))
                    summaries.append(
                        f"Local model {g['model']} drafted the narrative; the code verifier accepted "
                        f"{g['accepted']} sentences and excluded {caught} "
                        f"across {g['attempts']} attempt{'s' if g['attempts'] > 1 else ''}. No report filed.")
            elif node == "case_close":
                summaries.append(payload.get("disposition")
                                 or "Reached the automatic closure step; no human approval recorded.")
            elif node == "hitl_approval" and payload.get("reviews"):
                last = payload["reviews"][-1]
                summaries.append(f"Level {last['level']} reviewer {last['reviewer']} recorded: "
                                 f"{last['label']}. Rationale: {last['rationale']}")
            elif node == "risk_scoring" and not summaries:
                summaries.append("Preserved the screening HOLD override; transaction scoring was bypassed.")
        # Allowlisted contributions only: never arbitrary deltas, prompts or messages.
        with self.store.lock:
            case = self.store.cases[self.case_id]
            last = case.events[-1] if case.events else None
            if (phase == "enter" and last and last.node == node == "hitl_approval"
                    and last.phase == "started"):
                return  # LangGraph re-runs an interrupted node on resume; keep one start event.
            case.events.append(Event(
                sequence=len(case.events) + 1, node=node,
                phase="started" if phase == "enter" else "completed",
                timestamp=now(), summary=summaries, evidence_ids=evidence_ids,
                duration_ms=duration))
            case.updated_at = now()
            if node == "investigator" and phase != "enter":
                case.investigator = Report.model_validate(payload["investigator"])
            self.store.db.save(case)

    def receipt(self, node, state, delta, duration_ms):
        self.store.db.receipt(self.case_id, node, state, delta, duration_ms)

    def progress(self, step: Step):
        with self.store.lock:
            case = self.store.cases[self.case_id]
            previous = case.investigator.steps if case.investigator else []
            steps = previous + [step]
            case.investigator = Report(
                mode="partial", model=llm.model_name(), steps=steps,
                selected_ids=[], summary=[], errors=[], latency_ms=0,
                model_calls=0, invalid_calls=0)
            case.events.append(Event(
                sequence=len(case.events) + 1, node="investigator", phase="completed",
                timestamp=now(), summary=[
                    f"Read-only tool {step.tool}: selected by {step.chosen_by}; "
                    f"{len(step.facts)} code-owned facts returned."],
                evidence_ids=[f.id for f in step.facts], duration_ms=step.duration_ms))
            case.updated_at = now()
            self.store.db.save(case)


class CaseStore:
    def __init__(self, path: Optional[str] = None):
        self.db = DurableData(path or os.getenv("AML_CHECKPOINT_DB", "data/guardian.sqlite"))
        self.lock = Lock()
        self.cases: Dict[str, CaseView] = {}
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="aml-web")
        self.capacity = BoundedSemaphore(8)
        self.designers = BoundedSemaphore(2)
        self.readers = BoundedSemaphore(2)
        running = []
        for view, alert in self.db.load():
            case = CaseView.model_validate(view)
            if case.status == "awaiting_human" and case.review is None and case.recommendation:
                case.review = review_policy.pending_review(
                    case.recommendation, [r.model_dump() for r in case.reviews])
            self.cases[case.id] = case
            if case.status == "running":
                running.append((case.id, alert))
        for case_id, alert in running:
            if not self.capacity.acquire(blocking=False):
                raise RuntimeError("Recovered case count exceeds configured capacity.")
            self.pool.submit(self.run, case_id, alert, True)

    def create(self, scenario: str, alert: Optional[dict] = None,
               story: Optional[stories.Story] = None, case_id: Optional[str] = None) -> CaseView:
        if not self.capacity.acquire(blocking=False):
            raise HTTPException(429, "Investigation capacity reached. Try again shortly.")
        alert = alert or scenario_alert(scenario)
        case_id = case_id or str(uuid4())
        case = CaseView(
            id=case_id, scenario=scenario, story=story, account=alert["account"],
            originator=alert["originator"], beneficiary=alert["beneficiary"],
            window=alert["window"], created_at=now(), updated_at=now(),
            status="running", transactions=[
                Transaction(source=t["from"], target=t["to"], amount=t["amount"],
                            timestamp=t["ts"]) for t in alert["transactions"]])
        with self.lock:
            if len(self.cases) >= 100:
                self.capacity.release()
                raise HTTPException(429, "Local case limit reached. Use the enabled synthetic test-data reset to clear cases.")
            self.cases[case_id] = case
            self.db.save(case, alert)
            snapshot = case.model_copy(deep=True)
        self.pool.submit(self.run, case_id, alert)
        return snapshot

    def run(self, case_id: str, alert: Optional[dict], recover: bool = False,
            resume: Optional[dict] = None) -> None:
        try:
            with self.db.checkpointer() as saver:
                graph = build_graph(checkpointer=saver, journal=PublicJournal(self, case_id))
                config = {"configurable": {"thread_id": case_id}}
                snapshot = graph.get_state(config) if recover else None
                if resume is not None:
                    result = graph.invoke(Command(resume=resume), config)
                elif snapshot and snapshot.values and (
                    not snapshot.next or any(task.interrupts for task in snapshot.tasks)
                ):
                    result = dict(snapshot.values)
                    if snapshot.next:
                        result["__interrupt__"] = True
                else:
                    result = graph.invoke(None if snapshot and snapshot.values else {"alert": alert}, config)
            with self.lock:
                case = self.cases[case_id]
                case.graph_case_id = result["case_id"]
                case.recommendation = result["decision"]
                case.score = result.get("risk_score", 0)
                case.findings = [FindingView(
                    agent=f["agent"], claim=f["claim"],
                    evidence_ids=f["evidence_ids"]) for f in result.get("findings", [])]
                case.sources = [Source(**s) for s in result.get("citations", [])]
                case.metrics = Metrics(**{
                    k: result.get("graph_metrics", {}).get(k, 0)
                    for k in Metrics.model_fields})
                case.narrative = result.get("narrative", "")
                if result.get("narrative_grounding"):
                    case.grounding = Grounding(**result["narrative_grounding"])
                if result.get("investigator"):
                    case.investigator = Report.model_validate(result["investigator"])
                case.reviews = [review_policy.ReviewRecord.model_validate(r)
                                for r in result.get("reviews", [])]
                case.disposition = result.get("disposition")
                if result.get("__interrupt__"):
                    case.status = "awaiting_human"
                    case.review = review_policy.pending_review(
                        result["decision"], result.get("reviews", []))
                else:
                    case.status = "completed"
                    case.review = None
                case.updated_at = now()
                self.db.save(case)
        except Exception:
            logger.exception("Synthetic investigation failed: case_id=%s", case_id)
            with self.lock:
                self.cases[case_id].status = "failed"
                self.cases[case_id].error = (
                    "Investigation failed. Consult the API log with case ID " + case_id)
                self.cases[case_id].updated_at = now()
                self.db.save(self.cases[case_id])
        finally:
            self.capacity.release()

    def decide(self, case_id: str, command: review_policy.ReviewCommand) -> CaseView:
        with self.lock:
            case = self.cases.get(case_id)
            if case is None:
                raise HTTPException(404, "Synthetic case not found in this local session.")
            if case.status != "awaiting_human" or case.review is None:
                raise HTTPException(409, "This case is not waiting for a human decision.")
            try:
                review_policy.validate(command, case.recommendation,
                                [r.model_dump() for r in case.reviews])
            except ValueError as error:
                raise HTTPException(422, str(error)) from None
            if not self.capacity.acquire(blocking=False):
                raise HTTPException(429, "Investigation capacity reached. Try again shortly.")
            # Flip to running under the lock so a duplicate submission gets 409.
            case.status = "running"
            case.review = None
            case.updated_at = now()
            self.db.save(case)
            snapshot = case.model_copy(deep=True)
        self.pool.submit(self.run, case_id, None, False, command.model_dump())
        return snapshot

    def get(self, case_id: str) -> CaseView:
        with self.lock:
            if case_id not in self.cases:
                raise HTTPException(404, "Synthetic case not found in this local session.")
            return self.cases[case_id].model_copy(deep=True)

    def reset(self, timeout: float = None) -> int:
        timeout = timeout or (10 if llm.provider_name() == "stub" else 300)
        deadline = monotonic() + timeout
        while True:
            with self.lock:
                if not any(c.status == "running" for c in self.cases.values()):
                    removed = len(self.cases)
                    self.cases.clear()
                    self.db.reset()
                    return removed
            if monotonic() >= deadline:
                raise HTTPException(409, "Wait for running investigations to finish before resetting.")
            sleep(0.02)

    def wait(self, case_id: str, timeout: float = None) -> CaseView:
        # Local-model narration takes seconds per case; the stub finishes in milliseconds.
        timeout = timeout or (30 if llm.provider_name() == "stub" else 300)
        deadline = monotonic() + timeout
        while monotonic() < deadline:
            case = self.get(case_id)
            if case.status != "running":
                return case
            sleep(0.02)
        raise HTTPException(504, "Seeded investigation did not finish in time.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure()
    app.state.store = CaseStore()
    if os.getenv("AML_ENABLE_ARENA") == "1":
        app.state.arena = ArenaStore(os.getenv(
            "AML_ARENA_DB", os.getenv("AML_CHECKPOINT_DB", "data/guardian.sqlite")))
    yield
    app.state.store.pool.shutdown(wait=True, cancel_futures=False)
    if hasattr(app.state, "arena"):
        app.state.arena.close()
        del app.state.arena


app = FastAPI(title="AML Guardian — local synthetic workbench",
              version="0.1.0", lifespan=lifespan)
app.include_router(arena_router)


@app.get("/api/v1/cases", response_model=List[CaseView])
def list_cases():
    store = app.state.store
    with store.lock:
        return [c.model_copy(deep=True) for c in reversed(list(store.cases.values()))]


@app.post("/api/v1/cases", response_model=CaseView, status_code=202)
def create_case(command: CreateCase):
    return app.state.store.create(command.scenario)


@app.post("/api/v1/stories", response_model=CaseView, status_code=202)
def create_story(command: CreateStory):
    """The local model proposes a bounded recipe; code builds the alert; the team investigates."""
    description = command.description.strip()
    if command.mode == "design" and len(description) < 12:
        raise HTTPException(422, "Describe the story in at least a few words (12+ characters).")
    store = app.state.store
    if not store.designers.acquire(blocking=False):
        raise HTTPException(429, "The story designer is busy. Try again in a moment.")
    try:
        case_id = str(uuid4())
        story, alert = stories.design(description, command.mode, case_id.replace("-", ""))
    finally:
        store.designers.release()
    return store.create("custom", alert=alert, story=story, case_id=case_id)


@app.get("/api/v1/stories/examples", response_model=List[str])
def story_examples():
    return stories.EXAMPLES


@app.get("/api/v1/cases/{case_id}", response_model=CaseView)
def get_case(case_id: str):
    return app.state.store.get(case_id)


@app.post("/api/v1/cases/{case_id}/decision", response_model=CaseView, status_code=202)
def decide_case(case_id: str, command: review_policy.ReviewCommand):
    """Record a human disposition; review.py decides whether it is allowed."""
    return app.state.store.decide(case_id, command)


@app.get("/api/v1/cases/{case_id}/receipts")
def get_receipts(case_id: str):
    store = app.state.store
    store.get(case_id)
    return store.db.receipts(case_id)


@app.get("/api/v1/cases/{case_id}/events")
async def stream_case(case_id: str, request: Request):
    """Stream durable public projections; never run a second graph for a subscriber."""
    store = app.state.store
    store.get(case_id)
    raw_cursor = request.headers.get("last-event-id", "0")
    if not raw_cursor.isdigit():
        raise HTTPException(422, "Last-Event-ID must be a non-negative sequence number.")

    async def events():
        previous = None
        idle = 0
        while not await request.is_disconnected():
            case = store.get(case_id)
            encoded = case.model_dump_json()
            if encoded != previous:
                yield f"id: {len(case.events)}\nevent: case\ndata: {encoded}\n\n"
                previous = encoded
                idle = 0
            elif idle >= 40:
                yield ": keepalive\n\n"
                idle = 0
            if case.status != "running":
                break
            idle += 1
            await asyncio.sleep(0.25)
    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/v1/runtime", response_model=Runtime)
def runtime():
    """Which narration model is configured. Scores and routes never depend on it."""
    return llm.runtime_info()


@app.post("/api/v1/policy/ask", response_model=policy.PolicyAnswer)
def ask_policy(command: policy.PolicyQuestion):
    question = command.question.strip()
    if len(question) < 5:
        raise HTTPException(422, "Ask a policy-reference question of at least 5 characters.")
    store = app.state.store
    context = None
    if command.case_id is not None:
        case = store.get(command.case_id)
        if case.status in ("running", "failed"):
            raise HTTPException(409, "Select a successfully finished investigation first.")
        signals = []
        if case.metrics.structuring_hits:
            signals.append("split deposits")
        if case.metrics.fan_in > 1:
            signals.append("many senders")
        if case.metrics.cycles:
            signals.append("returning funds cycle")
        if case.recommendation == "HOLD":
            signals.append("sanctions screening")
        context = policy.CaseContext(
            id=case.id, account=case.account, status=case.status, score=case.score,
            recommendation=case.recommendation, signals=signals)
    if not store.readers.acquire(blocking=False):
        raise HTTPException(429, "The policy assistant is busy. Try again shortly.")
    try:
        return policy.answer(question, context)
    finally:
        store.readers.release()


def require_test_data_controls():
    # Local test automation only; hidden unless explicitly enabled.
    if os.getenv("AML_ENABLE_TEST_DATA_CONTROLS") != "1":
        raise HTTPException(404, "Not found")


@app.delete("/api/v1/test-data/cases",
            dependencies=[Depends(require_test_data_controls)])
def reset_test_data():
    return {"removed": app.state.store.reset()}


@app.post("/api/v1/test-data/seed", response_model=List[CaseView], status_code=201,
          dependencies=[Depends(require_test_data_controls)])
def seed_test_data(command: SeedCases):
    """Run each fixed synthetic scenario through the real graph, in order."""
    store = app.state.store
    if command.reset:
        store.reset()
    return [store.wait(store.create(s).id) for s in command.scenarios]
