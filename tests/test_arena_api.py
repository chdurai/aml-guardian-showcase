import json
from threading import Event
from time import monotonic, sleep

from fastapi.testclient import TestClient
import pytest

from aml_guardian.api import app
from aml_guardian import arena
from aml_guardian.arena_api import ArenaStore, Job


@pytest.fixture
def enabled(monkeypatch, tmp_path):
    monkeypatch.setenv("AML_ENABLE_ARENA", "1")
    monkeypatch.setenv("AML_ARENA_DB", str(tmp_path / "arena.sqlite"))
    monkeypatch.setenv("AML_LLM_PROVIDER", "stub")


def finish(client, identity):
    deadline = monotonic() + 10
    while monotonic() < deadline:
        result = client.get(f"/api/v1/arena/runs/{identity}").json()
        if result["status"] != "running":
            return result
        sleep(.01)
    pytest.fail("Arena did not finish")


def test_disabled(monkeypatch):
    monkeypatch.delenv("AML_ENABLE_ARENA", raising=False)
    with TestClient(app) as client:
        assert client.get("/api/v1/arena/fixtures").status_code == 404
        assert client.post("/api/v1/arena/runs", json={"fixture_id": "dev-01", "mode": "compare"}).status_code == 404


def test_api_contract_and_stream(enabled):
    with TestClient(app) as client:
        assert len(client.get("/api/v1/arena/fixtures").json()) == 12
        for payload in ({"fixture_id": "unknown", "mode": "compare"},
                        {"fixture_id": "x" * 81, "mode": "compare"},
                        {"fixture_id": "dev-01", "mode": "approve"},
                        {"fixture_id": "dev-01", "mode": "compare", "score": 0}):
            assert client.post("/api/v1/arena/runs", json=payload).status_code == 422
        assert client.get("/api/v1/arena/runs/unknown").status_code == 404
        response = client.post("/api/v1/arena/runs", json={"fixture_id": "dev-02", "mode": "compare"})
        assert response.status_code == 202
        identity = response.json()["id"]
        job = finish(client, identity)
        assert job["status"] == "completed"
        assert job["report"]["agent"]["challenges"][0]["status"] == "resolved"
        assert job["report"]["agent"]["mode"] == "scripted"
        stream = client.get(f"/api/v1/arena/runs/{identity}/events",
                            headers={"Last-Event-ID": str(job["sequence"])})
        assert "event: arena" in stream.text
        snapshot = json.loads(stream.text.split("data: ")[1].strip())
        assert snapshot["sequence"] == job["sequence"]
        assert snapshot["events"] == job["events"]
        assert client.get(f"/api/v1/arena/runs/{identity}/events",
                          headers={"Last-Event-ID": "-1"}).status_code == 422


def test_capacity_and_failure(enabled, monkeypatch):
    entered, release = Event(), Event()
    def fail(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        raise RuntimeError("injected worker error")
    monkeypatch.setattr(arena, "compare", fail)
    with TestClient(app) as client:
        first = client.post("/api/v1/arena/runs", json={"fixture_id": "dev-01", "mode": "scripted"})
        assert entered.wait(5)
        second = client.post("/api/v1/arena/runs", json={"fixture_id": "dev-01", "mode": "scripted"})
        try:
            assert client.post("/api/v1/arena/runs", json={
                "fixture_id": "dev-01", "mode": "scripted"}).status_code == 429
        finally:
            release.set()
        for result in (first, second):
            job = finish(client, result.json()["id"])
            assert job["status"] == "failed"
            assert job["error"]
            assert job["report"] is None


def test_restart_marks_interrupted_and_keeps_completed(tmp_path):
    path = str(tmp_path / "arena.sqlite")
    store = ArenaStore(path)
    store.save(Job(id="unfinished", fixture_id="dev-01", mode="compare", status="running"))
    store.save(Job(id="done", fixture_id="dev-01", mode="scripted", status="completed"))
    store.close()
    recovered = ArenaStore(path)
    try:
        assert recovered.get("unfinished").status == "interrupted"
        assert "not replayed" in recovered.get("unfinished").error
        assert recovered.get("done").status == "completed"
    finally:
        recovered.close()
