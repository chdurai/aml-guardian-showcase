"""Pluggable LLM. Default is a deterministic stub so the whole graph,
critic loop, and HITL interrupt run with no API key.

``AML_LLM_PROVIDER=ollama`` uses a local Ollama server (loopback by default):
no API key is needed. The model drafts narrative text, proposes bounded stories,
or selects policy-reference IDs; it never sets scores, routes or decisions.

``AML_LLM_PROVIDER=openai`` explicitly enables an OpenAI-compatible endpoint.
Configure ``AML_OPENAI_BASE_URL`` (including /v1), ``AML_MODEL`` and optionally
``AML_OPENAI_API_KEY`` (or ``OPENAI_API_KEY``). No remote provider is auto-selected.
"""
from __future__ import annotations

import json
import logging
import math
import os
from time import perf_counter
import urllib.error
import urllib.parse
import urllib.request
from .telemetry import span

DEFAULT_OLLAMA_MODEL = "llama3.2:3b"
logger = logging.getLogger(__name__)

# US-origin open-weight models that fit an 8 GB Apple-silicon laptop.
MODEL_CATALOG = {
    "llama3.2:3b": {"family": "Llama 3.2 3B Instruct", "publisher": "Meta (US)", "license": "Llama 3.2 Community License"},
    "phi4-mini": {"family": "Phi-4-mini 3.8B", "publisher": "Microsoft (US)", "license": "MIT"},
    "granite3.3:2b": {"family": "Granite 3.3 2B Instruct", "publisher": "IBM (US)", "license": "Apache 2.0"},
}


class ModelUnavailable(RuntimeError):
    """The configured model could not produce a usable reply."""


def provider_name() -> str:
    return os.getenv("AML_LLM_PROVIDER", "stub")


def model_name() -> str:
    if provider_name() == "ollama":
        return os.getenv("AML_MODEL", DEFAULT_OLLAMA_MODEL)
    if provider_name() in {"openai", "openai-compatible"}:
        return os.getenv("AML_MODEL", "")
    return "stub"


def _ollama_url() -> str:
    return os.getenv("OLLAMA_HOST_URL", "http://127.0.0.1:11434").rstrip("/")


def model_residency() -> str:
    """Observe Ollama residency without loading/unloading or warming a model."""
    if provider_name() != "ollama":
        return "not_applicable"
    try:
        with urllib.request.urlopen(f"{_ollama_url()}/api/ps", timeout=2) as response:
            data = json.load(response)
        if not isinstance(data, dict) or not isinstance(data.get("models"), list):
            raise ValueError("Invalid residency response")
        names = {m.get("name") for m in data["models"] if isinstance(m, dict)}
        return "loaded_before_comparison" if model_name() in names else "not_loaded_before_comparison"
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        logger.warning("Ollama residency probe failed; warm/cold state is unknown.")
        return "unknown_probe_failed"


def narrate(prompt: str) -> str:
    if provider_name() == "stub":
        # Deterministic, marker-based stub (mirrors the Java platform's approach).
        return f"[stub-narrative] {prompt[:300]}"
    raise RuntimeError(f"Provider {provider_name()!r} narrates through grounding.draft().")


def chat_json(system: str, user: str, schema: dict, temperature: float = 0, seed: int = 7,
              *, timeout_s: float | None = None) -> tuple:
    """Return (JSON object, usage); timeout_s overrides AML_MODEL_TIMEOUT_S.

    Transport errors deliberately omit endpoints, credentials and response bodies.
    The caller remains responsible for validating the returned object against its
    domain schema, as with the original Ollama adapter. OpenAI-compatible requests
    explicitly use non-strict JSON-schema mode: Pydantic defaults, optional fields,
    and per-turn tool/evidence enums are preserved without schema rewriting.
    """
    provider = provider_name()
    if provider not in {"ollama", "openai", "openai-compatible"}:
        raise ModelUnavailable(f"Provider {provider_name()!r} has no structured chat.")
    try:
        timeout = float(timeout_s if timeout_s is not None else os.getenv("AML_MODEL_TIMEOUT_S", "120"))
    except (TypeError, ValueError):
        raise ModelUnavailable("Model timeout must be a positive finite number.") from None
    if not math.isfinite(timeout) or timeout <= 0:
        raise ModelUnavailable("Model timeout must be a positive finite number.")
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    headers = {"Content-Type": "application/json"}
    if provider == "ollama":
        label = "Ollama"
        url = f"{_ollama_url()}/api/chat"
        data = {
            "model": model_name(), "stream": False, "format": schema, "messages": messages,
            "options": {"temperature": temperature, "seed": seed, "num_ctx": 4096, "num_predict": 700},
            "keep_alive": os.getenv("AML_MODEL_KEEP_ALIVE", "30m"),
        }
    else:
        label = "OpenAI-compatible provider"
        if not model_name().strip():
            raise ModelUnavailable("AML_MODEL is required for the OpenAI-compatible provider.")
        base = os.getenv("AML_OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        try:
            parsed = urllib.parse.urlsplit(base)
            valid = (parsed.scheme in {"http", "https"} and parsed.hostname
                     and not parsed.username and not parsed.password
                     and not parsed.query and not parsed.fragment
                     and not any(ord(char) <= 32 or ord(char) == 127 for char in base))
            parsed.port
        except ValueError:
            valid = False
        if not valid:
            raise ModelUnavailable("AML_OPENAI_BASE_URL must be an HTTP(S) base URL without credentials or query.")
        url = f"{base}/chat/completions"
        key = os.getenv("AML_OPENAI_API_KEY", os.getenv("OPENAI_API_KEY", ""))
        if key:
            if "\r" in key or "\n" in key:
                raise ModelUnavailable("The provider API key contains invalid header characters.")
            headers["Authorization"] = f"Bearer {key}"
        data = {
            "model": model_name(), "stream": False, "messages": messages,
            "temperature": temperature, "seed": seed,
            "response_format": {"type": "json_schema", "json_schema": {
                "name": "aml_guardian_response", "strict": False, "schema": schema}},
        }
    request = urllib.request.Request(url, data=json.dumps(data).encode(), headers=headers)
    started = perf_counter()
    try:
        with span("llm.structured_chat", provider=provider, model=model_name()):
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.load(response)
    except urllib.error.HTTPError as exc:
        raise ModelUnavailable(f"{label} returned HTTP {exc.code}.") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ModelUnavailable(f"{label} server unreachable or request timed out.") from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ModelUnavailable(f"{label} returned an invalid JSON response.") from None
    except (ValueError, UnicodeEncodeError):
        raise ModelUnavailable(f"{label} request configuration is invalid.") from None
    try:
        if provider == "ollama":
            content = payload["message"]["content"]
        else:
            choice = payload["choices"][0]
            if choice.get("finish_reason") not in (None, "stop"):
                raise ModelUnavailable("Model reply was incomplete or blocked.")
            message = choice["message"]
            if message.get("refusal"):
                raise ModelUnavailable("Model refused the structured response.")
            content = message["content"]
        reply = json.loads(content)
        if not isinstance(reply, dict):
            raise ModelUnavailable("Model reply must be a JSON object.")
        if provider == "ollama":
            usage = {"prompt_tokens": payload.get("prompt_eval_count", 0),
                     "output_tokens": payload.get("eval_count", 0),
                     "duration_ms": round(payload.get("total_duration", 0) / 1e6, 1)}
        else:
            counts = payload.get("usage") or {}
            usage = {"prompt_tokens": counts.get("prompt_tokens", 0),
                     "output_tokens": counts.get("completion_tokens", 0),
                     "duration_ms": round((perf_counter() - started) * 1000, 1)}
    except (KeyError, IndexError, TypeError, AttributeError, json.JSONDecodeError):
        raise ModelUnavailable("Model reply was not a valid structured JSON response.") from None
    return reply, usage


def runtime_info() -> dict:
    """Public, secret-free description of the narration runtime."""
    info = {"provider": provider_name(), "model": model_name(), "reachable": None,
            "installed": None, **MODEL_CATALOG.get(model_name(), {})}
    if provider_name() == "ollama":
        try:
            with urllib.request.urlopen(f"{_ollama_url()}/api/tags", timeout=2) as response:
                names = {m["name"] for m in json.load(response).get("models", [])}
            info["reachable"] = True
            info["installed"] = model_name() in names or f"{model_name()}:latest" in names
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            info["reachable"] = False
            info["installed"] = False
    return info
