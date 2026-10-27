"""Input guardrails: normalize and sandbox untrusted text (party names,
memos, OCR) before it reaches an LLM prompt. Mirrors the Java platform's
Spotlight approach."""
from __future__ import annotations

import re
import unicodedata

# phrases that try to hijack instructions; neutralized, never executed
_INJECTION_PATTERNS = [
    r"ignore (all |any )?(previous |prior |above )?instructions",
    r"clear this case",
    r"system prompt",
    r"you are now",
    r"disregard",
]


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    return "".join(c for c in text
                   if not unicodedata.category(c).startswith("Cf"))  # zero-width


def flag_injection(text: str) -> list:
    low = normalize(text).lower()
    return [p for p in _INJECTION_PATTERNS if re.search(p, low)]


def redact_injection(text: str) -> str:
    clean = normalize(text)
    for p in _INJECTION_PATTERNS:
        clean = re.sub(p, "[REDACTED-INJECTION]", clean, flags=re.IGNORECASE)
    return clean


def sanitize_untrusted(text: str) -> str:
    """Return text safe to embed in a prompt: normalized, injection markers
    replaced, and wrapped in spotlight delimiters so the model treats it as
    data, not instructions."""
    return f"<<<UNTRUSTED:{redact_injection(text)}>>>"
