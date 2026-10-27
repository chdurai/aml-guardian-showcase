"""Local SQLite projections, idempotent receipts and LangGraph checkpoints."""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3

from langgraph.checkpoint.sqlite import SqliteSaver


class DurableData:
    def __init__(self, path: str):
        self.path = path
        Path(path).expanduser().parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, view TEXT NOT NULL, alert TEXT NOT NULL)")
            conn.execute("""CREATE TABLE IF NOT EXISTS receipts (
                case_id TEXT, node TEXT, input_hash TEXT, output TEXT, duration_ms REAL,
                PRIMARY KEY(case_id, node, input_hash))""")

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
        try:
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    @contextmanager
    def checkpointer(self):
        with self.connection() as conn:
            saver = SqliteSaver(conn)
            saver.setup()
            yield saver

    def save(self, case, alert=None):
        with self.connection() as conn:
            if alert is not None:
                conn.execute("INSERT OR REPLACE INTO cases VALUES (?, ?, ?)",
                             (case.id, case.model_dump_json(), json.dumps(alert)))
            else:
                conn.execute("UPDATE cases SET view=? WHERE id=?", (case.model_dump_json(), case.id))

    def load(self):
        with self.connection() as conn:
            return [(json.loads(view), json.loads(alert))
                    for view, alert in conn.execute("SELECT view, alert FROM cases ORDER BY rowid")]

    def receipt(self, case_id, node, state, delta, duration_ms):
        raw = json.dumps(state, sort_keys=True, default=str)
        digest = hashlib.sha256(raw.encode()).hexdigest()
        with self.connection() as conn:
            conn.execute("INSERT OR IGNORE INTO receipts VALUES (?, ?, ?, ?, ?)",
                         (case_id, node, digest, json.dumps(delta, default=str), duration_ms))

    def receipts(self, case_id):
        with self.connection() as conn:
            return [dict(node=node, input_hash=digest, duration_ms=duration)
                    for node, digest, duration in conn.execute(
                        "SELECT node, input_hash, duration_ms FROM receipts WHERE case_id=? ORDER BY rowid",
                        (case_id,))]

    def reset(self):
        with self.connection() as conn:
            for table in ("cases", "receipts", "checkpoints", "writes"):
                # Fixed allowlist only; the store is dedicated to synthetic demo state.
                if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                    conn.execute(f"DELETE FROM {table}")
