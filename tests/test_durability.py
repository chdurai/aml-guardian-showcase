import json
import os
from pathlib import Path
import subprocess
import sys
import socket
from time import monotonic, sleep

from fastapi.testclient import TestClient
import httpx

from aml_guardian.api import CaseStore, app


def test_cases_survive_restart_without_approval(tmp_path):
    path = str(tmp_path / "restart.sqlite")
    store = CaseStore(path)
    created = store.create("structuring")
    before = store.wait(created.id)
    receipts = store.db.receipts(created.id)
    store.pool.shutdown(wait=True)
    restored = CaseStore(path)
    try:
        assert restored.get(created.id) == before
        assert before.status == "awaiting_human"
        assert restored.db.receipts(created.id) == receipts
        assert len(receipts) == 8
    finally:
        restored.pool.shutdown(wait=True)


def test_stream_terminal_snapshot_and_receipts():
    with TestClient(app) as client:
        case = client.post("/api/v1/cases", json={"scenario": "routine"}).json()
        app.state.store.wait(case["id"])
        response = client.get(f"/api/v1/cases/{case['id']}/events")
        assert response.headers["content-type"].startswith("text/event-stream")
        payload = json.loads(response.text.split("data: ", 1)[1].split("\n")[0])
        assert payload["status"] == "completed"
        assert client.get(f"/api/v1/cases/{case['id']}/receipts").json()
        assert client.get(f"/api/v1/cases/{case['id']}/events",
                          headers={"Last-Event-ID": "-1"}).status_code == 422
        assert client.get("/api/v1/cases/missing/events").status_code == 404


def test_sigkill_during_node_recovers_from_checkpoint(tmp_path):
    """Real HTTP API killed inside a node after prior checkpoints commit."""
    ready = tmp_path / "ready"
    db = tmp_path / "kill.sqlite"
    child = """
import os, time
from pathlib import Path
from aml_guardian import agents
import uvicorn
original = agents.graph_analysis
def paused(state):
    Path(os.environ['DRILL_READY']).write_text('ready')
    time.sleep(120)
    return original(state)
agents.graph_analysis = paused
uvicorn.run('aml_guardian.api:app', host='127.0.0.1', port=int(os.environ['DRILL_PORT']),
            log_level='error')
"""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    env = {**os.environ, "AML_CHECKPOINT_DB": str(db), "DRILL_READY": str(ready),
           "DRILL_PORT": str(port)}
    proc = subprocess.Popen([sys.executable, "-c", child], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = monotonic() + 15
        with httpx.Client(base_url=url, timeout=2) as client:
            while monotonic() < deadline:
                try:
                    if client.get("/api/v1/cases").status_code == 200:
                        break
                except httpx.ConnectError:
                    sleep(0.1)
            created = client.post("/api/v1/cases", json={"scenario": "structuring"})
            assert created.status_code == 202
            case_id = created.json()["id"]
        while not ready.exists() and monotonic() < deadline:
            if proc.poll() is not None:
                raise AssertionError(proc.communicate()[1].decode())
            sleep(0.02)
        assert ready.exists(), "Child failed to enter graph node."
        proc.kill()
        proc.wait(timeout=10)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)
        proc.communicate()
    restarted = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "aml_guardian.api:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "error"],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = monotonic() + 15
        case = {}
        with httpx.Client(base_url=url, timeout=2) as client:
            while monotonic() < deadline:
                try:
                    response = client.get(f"/api/v1/cases/{case_id}")
                    if response.status_code == 200:
                        case = response.json()
                        if case["status"] != "running":
                            break
                except httpx.ConnectError:
                    pass
                sleep(0.1)
            assert case["status"] == "awaiting_human"
            assert case["recommendation"] == "FILE_SAR"
            assert case["score"] == 100
            receipts = client.get(f"/api/v1/cases/{case_id}/receipts").json()
            assert len(receipts) == 8
            assert len({(r["node"], r["input_hash"]) for r in receipts}) == len(receipts)
    finally:
        restarted.terminate()
        try:
            restarted.wait(timeout=10)
        except subprocess.TimeoutExpired:
            restarted.kill()
            restarted.wait(timeout=10)
        restarted.communicate()
