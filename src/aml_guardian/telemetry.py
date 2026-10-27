"""Opt-in, process-local console tracing; never configures a remote exporter.

Callers should supply only non-sensitive scalar metadata, never case evidence,
prompts, replies, credentials or customer identifiers.
"""
from __future__ import annotations

from contextlib import contextmanager
import os
from threading import Lock

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor

_lock = Lock()
_configured = False
_provider: TracerProvider | None = None
_sensitive = ("secret", "password", "authorization", "api_key", "apikey", "prompt",
              "response", "content", "payload", "customer", "account", "evidence")


def configure() -> TracerProvider | None:
    """Configure once, returning the private console provider or None when off.

    A private provider avoids inheriting global/auto-instrumented remote exporters.
    Standard OTEL exporter environment variables are intentionally ignored.
    """
    global _configured, _provider
    with _lock:
        if not _configured:
            if os.getenv("AML_TRACE_CONSOLE") == "1":
                provider = TracerProvider(resource=Resource({"service.name": "aml-guardian"}))
                provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
                _provider = provider
            _configured = True
    return _provider


@contextmanager
def span(name: str, **attributes):
    """Yield a local span (or a no-op span), without recording exception text."""
    provider = configure()
    tracer = (provider.get_tracer(__name__) if provider else
              trace.NoOpTracerProvider().get_tracer(__name__))
    safe = {key: value for key, value in attributes.items()
            if (key in {"prompt_tokens", "output_tokens", "completion_tokens"}
                or not any(part in key.lower() for part in _sensitive))
            and isinstance(value, (str, bool, int, float))}
    with tracer.start_as_current_span(name, attributes=safe, record_exception=False,
                                      set_status_on_exception=False) as current:
        yield current
