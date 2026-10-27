"""Versioned SQLite arena projections and bounded, sequential laptop jobs."""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import logging
import os
from pathlib import Path
import sqlite3
from threading import BoundedSemaphore, Lock
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import Field

from . import arena

logger = logging.getLogger(__name__)


class CreateRun(arena.Contract):
    fixture_id: str = Field(min_length=1, max_length=80)
    mode: Literal["compare", "scripted"]


class FixtureView(arena.Contract):
    id: str
    title: str
    description: str
    synthetic: bool = True
    planted: bool


class Job(arena.Contract):
    id: str
    fixture_id: str
    mode: Literal["compare", "scripted"]
    status: Literal["running", "completed", "failed", "interrupted"]
    sequence: int = 0
    events: list[arena.ArenaEvent] = []
    report: arena.ComparisonReport | None = None
    error: str | None = None


class ArenaStore:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = Lock()
        self.capacity = BoundedSemaphore(2)
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="aml-arena")
        with self.db:
            self.db.execute("CREATE TABLE IF NOT EXISTS arena_jobs_v1 (id TEXT PRIMARY KEY, projection TEXT NOT NULL)")
        for identity, projection in self.db.execute("SELECT id, projection FROM arena_jobs_v1").fetchall():
            job = Job.model_validate_json(projection)
            if job.status == "running":
                job.status = "interrupted"
                job.error = "API restarted during measurement. Start a new run; original timings were not replayed."
                self.save(job)

    def save(self, job: Job):
        with self.lock, self.db:
            job.sequence += 1
            self.db.execute("INSERT OR REPLACE INTO arena_jobs_v1 VALUES (?, ?)",
                            (job.id, job.model_dump_json()))

    def get(self, identity: str) -> Job:
        with self.lock:
            row = self.db.execute("SELECT projection FROM arena_jobs_v1 WHERE id=?", (identity,)).fetchone()
        if row is None:
            raise HTTPException(404, "Arena run not found.")
        return Job.model_validate_json(row[0])

    def create(self, command: CreateRun) -> Job:
        fixture = next((f for f in arena.fixtures() if f.id == command.fixture_id), None)
        if fixture is None:
            raise HTTPException(422, "Choose a published development fixture.")
        if not self.capacity.acquire(blocking=False):
            raise HTTPException(429, "Arena capacity reached; one active and one queued job allowed.")
        job = Job(id=str(uuid4()), fixture_id=fixture.id, mode=command.mode, status="running")
        try:
            self.save(job)
            snapshot = job.model_copy(deep=True)
            self.pool.submit(self.run, job, fixture)
        except Exception:
            self.capacity.release()
            raise
        return snapshot

    def run(self, job: Job, fixture: arena.Fixture):
        def emit(event: arena.ArenaEvent):
            job.events.append(event)
            self.save(job)
        try:
            job.report = arena.compare(fixture, job.mode, emit=emit)
            job.status = "completed"
        except Exception:
            logger.exception("Arena job failed: run_id=%s", job.id)
            job.status = "failed"
            job.error = f"Arena job failed. Consult API log with run ID {job.id}."
        finally:
            try:
                self.save(job)
            finally:
                self.capacity.release()

    def close(self):
        self.pool.shutdown(wait=True)
        self.db.close()


def enabled():
    if os.getenv("AML_ENABLE_ARENA") != "1":
        raise HTTPException(404, "Challenge Arena is disabled. Set AML_ENABLE_ARENA=1 and restart.")


router = APIRouter(prefix="/api/v1/arena", dependencies=[Depends(enabled)])


@router.get("/fixtures", response_model=list[FixtureView])
def list_fixtures():
    titles = {"clean": "Clean control", "wrong_number": "Wrong number",
              "missing_evidence": "Missing evidence", "screening_unavailable": "Screening unavailable",
              "injection_attempt": "Injection attempt", "invented_citation": "Invented citation",
              "cross_run": "Another run's citation", "conflicting_values": "Conflicting values"}
    return [FixtureView(id=f.id, title=f"{titles[f.defect]} ({f.id})",
                        description=(f"Synthetic {f.count}-transfer control; no planted defect."
                                     if f.defect == "clean" else
                                     f"Synthetic {f.count}-transfer test; deliberately injected: {f.defect}."),
                        planted=f.defect != "clean") for f in arena.fixtures()]


@router.post("/runs", response_model=Job, status_code=202)
def create_run(command: CreateRun, request: Request):
    return request.app.state.arena.create(command)


@router.get("/runs/{identity}", response_model=Job)
def get_run(identity: str, request: Request):
    return request.app.state.arena.get(identity)


@router.get("/runs/{identity}/events")
async def stream_run(identity: str, request: Request):
    store = request.app.state.arena
    store.get(identity)
    cursor = request.headers.get("last-event-id", "0")
    if not cursor.isdigit():
        raise HTTPException(422, "Last-Event-ID must be a non-negative integer.")

    async def snapshots():
        # Reconnect always receives the latest projection, including its full event history.
        previous = None
        while not await request.is_disconnected():
            job = store.get(identity)
            if previous != job.sequence:
                previous = job.sequence
                yield f"id: {job.sequence}\nevent: arena\ndata: {job.model_dump_json()}\n\n"
            if job.status != "running":
                return
            await asyncio.sleep(.15)
    return StreamingResponse(snapshots(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
