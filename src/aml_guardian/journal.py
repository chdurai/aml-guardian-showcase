"""Append-only case journal: every agent I/O is hashed and logged for
audit and exact replay. LLMs can narrate; the journal is the record."""
from __future__ import annotations

import hashlib
import json
import os
import time


class CaseJournal:
    def __init__(self, path: str = "case-journal.jsonl"):
        self.path = path

    def record(self, case_id: str, node: str, event: str, payload: dict) -> dict:
        entry = {
            "seq": int(time.time() * 1000),
            "case_id": case_id,
            "node": node,
            "event": event,
            "payload_hash": hashlib.sha256(
                json.dumps(payload, sort_keys=True, default=str).encode()
            ).hexdigest()[:16],
            "payload": payload,
        }
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        with open(self.path, "a") as f:
            f.write(json.dumps(entry, default=str) + "\n")
        return entry

    def replay(self, case_id: str) -> list:
        if not os.path.exists(self.path):
            return []
        with open(self.path) as f:
            return [json.loads(line) for line in f
                    if json.loads(line).get("case_id") == case_id]
