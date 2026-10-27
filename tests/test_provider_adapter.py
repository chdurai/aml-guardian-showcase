"""Provider contracts use mocked urllib responses only; no server is required."""
import io
import json
import urllib.error
from contextlib import contextmanager

import pytest

from aml_guardian import llm

SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}},
          "required": ["answer"], "additionalProperties": False}


@pytest.fixture(autouse=True)
def isolated_provider(monkeypatch):
    for name in ("AML_LLM_PROVIDER", "AML_MODEL", "AML_MODEL_TIMEOUT_S",
                 "AML_OPENAI_BASE_URL", "AML_OPENAI_API_KEY", "OPENAI_API_KEY",
                 "OLLAMA_HOST_URL", "AML_MODEL_KEEP_ALIVE"):
        monkeypatch.delenv(name, raising=False)
    def no_network(*_args, **_kwargs):
        pytest.fail("Unexpected network request")
    monkeypatch.setattr(llm.urllib.request, "urlopen", no_network)


def response(monkeypatch, payload):
    calls = []
    def open_request(request, *, timeout):
        calls.append((request, timeout))
        return io.BytesIO(json.dumps(payload).encode())
    monkeypatch.setattr(llm.urllib.request, "urlopen", open_request)
    return calls


def use_openai(monkeypatch, provider="openai"):
    monkeypatch.setenv("AML_LLM_PROVIDER", provider)
    monkeypatch.setenv("AML_MODEL", "test-model")
    monkeypatch.setenv("AML_OPENAI_BASE_URL", "http://127.0.0.1:9999/v1/")


def openai_reply(**extra):
    return {"choices": [{"message": {"content": '{"answer":"grounded"}'}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 4}, **extra}


def test_stub_default_never_contacts_provider():
    assert llm.provider_name() == llm.model_name() == "stub"
    assert llm.narrate("hello") == "[stub-narrative] hello"
    assert llm.runtime_info()["reachable"] is None
    with pytest.raises(llm.ModelUnavailable, match="no structured chat"):
        llm.chat_json("system", "user", SCHEMA)


def test_llm_request_has_secret_free_trace_span(monkeypatch):
    use_openai(monkeypatch)
    response(monkeypatch, openai_reply())
    spans = []
    @contextmanager
    def capture(name, **attributes):
        spans.append((name, attributes))
        yield
    monkeypatch.setattr(llm, "span", capture)
    llm.chat_json("private system content", "private case content", SCHEMA)
    assert spans == [("llm.structured_chat", {"provider": "openai", "model": "test-model"})]


def test_ollama_contract_and_default_timeout_preserved(monkeypatch):
    monkeypatch.setenv("AML_LLM_PROVIDER", "ollama")
    calls = response(monkeypatch, {"message": {"content": '{"answer":"local"}'},
                                  "prompt_eval_count": 12, "eval_count": 3,
                                  "total_duration": 1_500_000})
    reply, usage = llm.chat_json("system", "user", SCHEMA)
    request, timeout = calls[0]
    body = json.loads(request.data)
    assert request.full_url == "http://127.0.0.1:11434/api/chat"
    assert timeout == 120
    assert body["model"] == "llama3.2:3b"
    assert body["format"] == SCHEMA and body["keep_alive"] == "30m"
    assert body["options"] == {"temperature": 0, "seed": 7, "num_ctx": 4096, "num_predict": 700}
    assert request.get_header("Authorization") is None
    assert reply == {"answer": "local"}
    assert usage == {"prompt_tokens": 12, "output_tokens": 3, "duration_ms": 1.5}


@pytest.mark.parametrize("provider", ["openai", "openai-compatible"])
def test_openai_structured_contract_and_secret_free_runtime(monkeypatch, provider):
    use_openai(monkeypatch, provider)
    monkeypatch.setenv("AML_OPENAI_API_KEY", "private-key")
    calls = response(monkeypatch, openai_reply())
    reply, usage = llm.chat_json("system", "user", SCHEMA, temperature=0.2, seed=9)
    request, timeout = calls[0]
    body = json.loads(request.data)
    assert request.full_url == "http://127.0.0.1:9999/v1/chat/completions"
    assert request.get_header("Authorization") == "Bearer private-key"
    assert body == {
        "model": "test-model", "stream": False, "temperature": 0.2, "seed": 9,
        "messages": [{"role": "system", "content": "system"}, {"role": "user", "content": "user"}],
        "response_format": {"type": "json_schema", "json_schema": {
            "name": "aml_guardian_response", "strict": False, "schema": SCHEMA}},
    }
    assert timeout == 120 and reply == {"answer": "grounded"}
    assert usage["prompt_tokens"] == 11 and usage["output_tokens"] == 4
    assert usage["duration_ms"] >= 0
    assert llm.runtime_info() == {"provider": provider, "model": "test-model",
                                  "reachable": None, "installed": None}
    assert len(calls) == 1  # Runtime info does not probe a remote endpoint.


@pytest.mark.parametrize("provider", ["ollama", "openai"])
def test_timeout_override_wins_over_environment(monkeypatch, provider):
    use_openai(monkeypatch, provider)
    monkeypatch.setenv("AML_MODEL_TIMEOUT_S", "75")
    payload = openai_reply() if provider == "openai" else {"message": {"content": "{}"}}
    calls = response(monkeypatch, payload)
    llm.chat_json("system", "user", SCHEMA)
    llm.chat_json("system", "user", SCHEMA, timeout_s=0.25)
    assert [timeout for _, timeout in calls] == [75, 0.25]


@pytest.mark.parametrize("timeout", [0, -1, float("nan"), float("inf"), "invalid"])
def test_invalid_timeout_is_explicit(monkeypatch, timeout):
    use_openai(monkeypatch)
    with pytest.raises(llm.ModelUnavailable, match="positive finite"):
        llm.chat_json("system", "user", SCHEMA, timeout_s=timeout)


def test_key_optional_and_standard_key_fallback(monkeypatch):
    use_openai(monkeypatch)
    calls = response(monkeypatch, openai_reply())
    llm.chat_json("system", "user", SCHEMA)
    assert calls[0][0].get_header("Authorization") is None
    monkeypatch.setenv("OPENAI_API_KEY", "standard-key")
    llm.chat_json("system", "user", SCHEMA)
    assert calls[1][0].get_header("Authorization") == "Bearer standard-key"


def test_non_strict_schema_preserves_nested_optional_fields_and_defaults(monkeypatch):
    use_openai(monkeypatch)
    from pydantic import BaseModel, Field

    class Action(BaseModel):
        tool: str
        query: str = Field(default="", max_length=400)
        evidence_ids: list[str] = Field(default_factory=list, max_length=30)

    class Envelope(BaseModel):
        action: Action
        note: str | None = None

    schema = Envelope.model_json_schema()
    original = json.loads(json.dumps(schema))
    calls = response(monkeypatch, openai_reply())
    llm.chat_json("system", "user", schema)
    requested = json.loads(calls[0][0].data)["response_format"]["json_schema"]
    assert requested["strict"] is False
    assert requested["schema"] == original == schema
    assert requested["schema"]["required"] == ["action"]
    nested = requested["schema"]["$defs"]["Action"]
    assert nested["required"] == ["tool"]
    assert nested["properties"]["query"]["default"] == ""
    assert requested["schema"]["properties"]["note"]["default"] is None


def test_non_strict_schema_retains_dynamic_tool_and_evidence_enums_per_turn(monkeypatch):
    use_openai(monkeypatch)
    from pydantic import BaseModel, Field

    class Action(BaseModel):
        tool: str
        query: str = ""
        evidence_ids: list[str] = Field(default_factory=list)

    calls = response(monkeypatch, openai_reply())
    for tools, evidence in [(["lookup", "finish"], ["E1"]), (["finish"], ["E1", "E2"])]:
        schema = Action.model_json_schema()
        schema["properties"]["tool"]["enum"] = tools
        schema["properties"]["evidence_ids"]["items"]["enum"] = evidence
        llm.chat_json("system", "user", schema)
        requested = json.loads(calls[-1][0].data)["response_format"]["json_schema"]
        assert requested["strict"] is False
        assert requested["schema"] == schema
        assert requested["schema"]["properties"]["tool"]["enum"] == tools
        assert requested["schema"]["properties"]["evidence_ids"]["items"]["enum"] == evidence
        assert requested["schema"]["required"] == ["tool"]


@pytest.mark.parametrize("url", ["file:///private", "https://user:secret@example.com/v1",
                                "https://example.com/v1?key=secret", "https://example.com/#secret",
                                "https://[broken", "https://example.com:bad/v1",
                                "https://example.com/secret path",
                                "https://example.com/\r\nsecret", ""])
def test_invalid_endpoint_does_not_echo_secrets(monkeypatch, url):
    use_openai(monkeypatch)
    monkeypatch.setenv("AML_OPENAI_BASE_URL", url)
    with pytest.raises(llm.ModelUnavailable, match="AML_OPENAI_BASE_URL") as caught:
        llm.chat_json("system", "user", SCHEMA)
    assert "secret" not in str(caught.value)


@pytest.mark.parametrize("failure", [ValueError("secret endpoint"), UnicodeEncodeError(
    "ascii", "secret endpoint", 0, 1, "invalid endpoint")])
def test_endpoint_encoding_and_request_errors_are_redacted(monkeypatch, failure, caplog):
    use_openai(monkeypatch)
    def fail(*_args, **_kwargs):
        raise failure
    monkeypatch.setattr(llm.urllib.request, "urlopen", fail)
    with pytest.raises(llm.ModelUnavailable, match="request configuration is invalid") as caught:
        llm.chat_json("system", "user", SCHEMA)
    assert "secret" not in str(caught.value) + caplog.text
    assert caught.value.__suppress_context__


def test_model_must_be_explicit_for_remote_provider(monkeypatch):
    monkeypatch.setenv("AML_LLM_PROVIDER", "openai")
    with pytest.raises(llm.ModelUnavailable, match="AML_MODEL is required"):
        llm.chat_json("system", "user", SCHEMA)


@pytest.mark.parametrize("failure", [
    urllib.error.HTTPError("https://private-key@example.com", 401, "private-key", {}, None),
    urllib.error.URLError("private-key"),
    TimeoutError("private-key"),
    OSError("private-key"),
])
def test_transport_errors_are_explicit_and_redacted(monkeypatch, failure, caplog):
    use_openai(monkeypatch)
    monkeypatch.setenv("AML_OPENAI_API_KEY", "private-key")
    def fail(*_args, **_kwargs):
        raise failure
    monkeypatch.setattr(llm.urllib.request, "urlopen", fail)
    with pytest.raises(llm.ModelUnavailable) as caught:
        llm.chat_json("system", "user", SCHEMA)
    assert "OpenAI-compatible provider" in str(caught.value)
    assert "private-key" not in str(caught.value) + caplog.text
    assert caught.value.__suppress_context__
    if isinstance(failure, urllib.error.HTTPError):
        assert "HTTP 401" in str(caught.value)


@pytest.mark.parametrize("payload", [
    {}, [], {"choices": []}, {"choices": [{"message": {"content": "not-json"}}]},
    {"choices": [{"message": {"content": "[]"}}]},
    {"choices": [{"message": {"refusal": "sensitive refusal"}}]},
    {"choices": [{"message": {"content": "{}"}, "finish_reason": "length"}]},
])
def test_malformed_refused_or_incomplete_responses_fail_closed(monkeypatch, payload):
    use_openai(monkeypatch)
    response(monkeypatch, payload)
    with pytest.raises(llm.ModelUnavailable):
        llm.chat_json("system", "user", SCHEMA)


def test_invalid_http_json_is_wrapped(monkeypatch):
    use_openai(monkeypatch)
    monkeypatch.setattr(llm.urllib.request, "urlopen",
                        lambda *_args, **_kwargs: io.BytesIO(b"private invalid response"))
    with pytest.raises(llm.ModelUnavailable, match="invalid JSON response") as caught:
        llm.chat_json("system", "user", SCHEMA)
    assert "private" not in str(caught.value)
