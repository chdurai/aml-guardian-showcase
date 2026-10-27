import json
import os
import subprocess
import sys
from time import sleep

from fastapi.testclient import TestClient

from aml_guardian import investigator
from aml_guardian.api import app


def test_sse_delivers_tool_progress_before_graph_finishes(monkeypatch):
    monkeypatch.setenv("AML_ENABLE_INVESTIGATOR", "1")
    execute = investigator._execute
    def slow(*args, **kwargs):
        sleep(0.4)
        return execute(*args, **kwargs)
    monkeypatch.setattr(investigator, "_execute", slow)
    with TestClient(app) as client:
        case = client.post("/api/v1/cases", json={"scenario": "structuring"}).json()
        stream = client.get(f"/api/v1/cases/{case['id']}/events")
        snapshots = [json.loads(line[6:]) for line in stream.text.splitlines()
                     if line.startswith("data: ")]
        assert any(s["status"] == "running" and s["investigator"] and
                   len(s["investigator"]["steps"]) == 1 for s in snapshots)
        assert snapshots[-1]["recommendation"] == "FILE_SAR"
        assert snapshots[-1]["investigator"]["mode"] == "scripted"


def test_actual_graph_emits_local_node_and_tool_spans(tmp_path):
    code = """
from aml_guardian.demo import SAMPLE_ALERT
from aml_guardian.graph import build_graph
from aml_guardian.journal import CaseJournal
import os
graph = build_graph(journal=CaseJournal(os.environ['TRACE_JOURNAL']))
graph.invoke({'alert': SAMPLE_ALERT}, {'configurable': {'thread_id': 'trace-test'}})
"""
    result = subprocess.run([sys.executable, "-c", code], env={
        **os.environ, "AML_TRACE_CONSOLE": "1", "TRACE_JOURNAL": str(tmp_path / "trace.jsonl")},
        capture_output=True, text=True, timeout=20, check=True)
    assert '"name": "node.alert_intake"' in result.stdout
    assert '"name": "tool.graph_neighbours"' in result.stdout
