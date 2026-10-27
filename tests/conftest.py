"""Tests never reuse or erase a user's durable demo database."""
import pytest


@pytest.fixture(autouse=True)
def isolate_demo_state(tmp_path, monkeypatch):
    monkeypatch.setenv("AML_CHECKPOINT_DB", str(tmp_path / "guardian.sqlite"))
    monkeypatch.setenv("AML_LLM_PROVIDER", "stub")
    monkeypatch.setenv("AML_ENABLE_INVESTIGATOR", "0")
