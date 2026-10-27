from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from aml_guardian import arena, telemetry


def test_arena_parent_child_spans_and_event_trace(monkeypatch):
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(telemetry, "_configured", True)
    monkeypatch.setattr(telemetry, "_provider", provider)
    monkeypatch.setenv("AML_LLM_PROVIDER", "stub")
    try:
        report = arena.compare(arena.fixtures()[1])
        spans = exporter.get_finished_spans()
        comparison = next(s for s in spans if s.name == "arena.comparison")
        trials = [s for s in spans if s.name == "arena.trial"]
        assert len(trials) == 2
        assert all(s.parent.span_id == comparison.context.span_id for s in trials)
        assert {s.name for s in spans} >= {
            "arena.investigate", "arena.critic", "arena.followup", "arena.tool_dispatch",
            "tool.graph_neighbours"}
        for trial in (report.baseline, report.agent):
            assert {e.trace_id for e in trial.events} == {f"{comparison.context.trace_id:032x}"}
            assert sum(e.kind == "tool_result" for e in trial.events) == trial.tool_calls
            for challenge in trial.challenges:
                assert any(e.details.get("challenge_id") == challenge.id
                           and e.details.get("evidence_id") in challenge.resolution_evidence_ids
                           for e in trial.events)
        exported = "".join(s.to_json() for s in spans)
        assert "Ignore instructions" not in exported
        assert "SYNTHETIC-SENDER" not in exported
        assert "api_key" not in exported
    finally:
        provider.shutdown()
