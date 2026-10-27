"""Tracing remains opt-in and local, independent of global OTEL configuration."""
import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from aml_guardian import telemetry


@pytest.fixture
def tracing(monkeypatch):
    monkeypatch.delenv("AML_TRACE_CONSOLE", raising=False)
    monkeypatch.setattr(telemetry, "_configured", False)
    monkeypatch.setattr(telemetry, "_provider", None)
    exporter = InMemorySpanExporter()
    created = []
    def local_exporter():
        created.append(True)
        return exporter
    monkeypatch.setattr(telemetry, "ConsoleSpanExporter", local_exporter)
    yield exporter, created
    if telemetry._provider is not None:
        telemetry._provider.shutdown()


@pytest.mark.parametrize("enabled", [None, "0", "true", "yes"])
def test_disabled_by_default_and_exact_opt_in(monkeypatch, tracing, enabled):
    if enabled is not None:
        monkeypatch.setenv("AML_TRACE_CONSOLE", enabled)
    exporter, created = tracing
    assert telemetry.configure() is None
    with telemetry.span("node.test", count=2) as current:
        assert not current.is_recording()
    assert not created and not exporter.get_finished_spans()


def test_console_only_and_configured_once(monkeypatch, tracing):
    monkeypatch.setenv("AML_TRACE_CONSOLE", "1")
    monkeypatch.setenv("OTEL_TRACES_EXPORTER", "otlp")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://must-not-contact.invalid")
    monkeypatch.setenv("OTEL_RESOURCE_ATTRIBUTES", "secret=must-not-export")
    global_provider = trace.get_tracer_provider()
    exporter, created = tracing
    provider = telemetry.configure()
    assert telemetry.configure() is provider
    assert len(created) == 1
    with telemetry.span("node.test", count=2):
        pass
    finished = exporter.get_finished_spans()
    assert len(finished) == 1 and finished[0].attributes["count"] == 2
    assert dict(finished[0].resource.attributes) == {"service.name": "aml-guardian"}
    assert trace.get_tracer_provider() is global_provider


def test_disabled_configuration_does_not_change_mid_process(monkeypatch, tracing):
    assert telemetry.configure() is None
    monkeypatch.setenv("AML_TRACE_CONSOLE", "1")
    assert telemetry.configure() is None
    assert tracing[1] == []


def test_nested_spans_and_sensitive_attributes(monkeypatch, tracing):
    monkeypatch.setenv("AML_TRACE_CONSOLE", "1")
    with telemetry.span("node.investigator", iteration=1) as parent:
        with telemetry.span("tool.lookup", tool="lookup", success=True, prompt="secret",
                            api_key="secret", customer_id="secret", response="secret",
                            prompt_tokens=12, metadata={"unsafe": "nested"}):
            pass
    child, outer = tracing[0].get_finished_spans()
    assert child.parent.span_id == parent.get_span_context().span_id
    assert outer.name == "node.investigator"
    assert dict(child.attributes) == {"tool": "lookup", "success": True, "prompt_tokens": 12}


def test_exception_propagates_without_exporting_exception_text(monkeypatch, tracing):
    monkeypatch.setenv("AML_TRACE_CONSOLE", "1")
    with pytest.raises(ValueError, match="private-key"):
        with telemetry.span("llm.chat"):
            raise ValueError("private-key")
    exported, = tracing[0].get_finished_spans()
    assert not exported.events
    assert "private-key" not in exported.to_json()
