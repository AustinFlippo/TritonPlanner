"""Persistent counters for planner-agent loop cost (model rounds per turn).

Each finished plan_chat invocation appends one JSON line so we can see average
rounds, tool-call volume, and how often MAX_LLM_CALLS is hit — without sending
student message content. Override the file with PLANNER_METRICS_PATH; set
PLANNER_METRICS_DISABLED=1 to skip disk writes (tests do this).
"""
from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_LOCK = threading.Lock()
_DEFAULT_PATH = Path(__file__).resolve().parent / "data" / "planner_loop_metrics.jsonl"


def metrics_path() -> Path:
    override = os.getenv("PLANNER_METRICS_PATH")
    if override:
        return Path(override)
    return _DEFAULT_PATH


def metrics_enabled() -> bool:
    return os.getenv("PLANNER_METRICS_DISABLED", "").strip().lower() not in {
        "1", "true", "yes", "on",
    }


def record_loop_turn(
    *,
    llm_rounds: int,
    tool_calls: int,
    tools: dict,
    exit_reason: str,
    hit_cap: bool,
    max_llm_calls: int,
) -> dict:
    """Append one turn and return the record (also used on the HTTP response)."""
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "llm_rounds": int(llm_rounds),
        "tool_calls": int(tool_calls),
        "tools": {str(k): int(v) for k, v in (tools or {}).items()},
        "exit": exit_reason,
        "hit_cap": bool(hit_cap),
        "max_llm_calls": int(max_llm_calls),
    }
    logger.info(
        "planner_loop rounds=%s tools=%s exit=%s hit_cap=%s",
        record["llm_rounds"],
        record["tool_calls"],
        record["exit"],
        record["hit_cap"],
    )
    if not metrics_enabled():
        return record
    path = metrics_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(record, separators=(",", ":")) + "\n"
        with _LOCK:
            with path.open("a", encoding="utf-8") as fh:
                fh.write(line)
    except OSError as exc:
        logger.warning("planner_loop metrics write failed: %s", exc)
    return record


def _read_records(path: Optional[Path] = None, limit: Optional[int] = None) -> list:
    path = path or metrics_path()
    if not path.exists():
        return []
    rows = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    if limit is not None and limit > 0:
        rows = rows[-limit:]
    return rows


def summarize_metrics(limit: Optional[int] = None, path: Optional[Path] = None) -> dict:
    """Aggregate recorded turns: average rounds, cap-hit rate, exit breakdown."""
    rows = _read_records(path=path, limit=limit)
    n = len(rows)
    if n == 0:
        return {
            "turns": 0,
            "avg_llm_rounds": None,
            "avg_tool_calls": None,
            "cap_hits": 0,
            "cap_hit_rate": None,
            "max_llm_rounds_seen": None,
            "by_exit": {},
            "rounds_histogram": {},
            "path": str(path or metrics_path()),
        }

    total_rounds = sum(int(r.get("llm_rounds") or 0) for r in rows)
    total_tools = sum(int(r.get("tool_calls") or 0) for r in rows)
    cap_hits = sum(1 for r in rows if r.get("hit_cap"))
    by_exit: dict = {}
    hist: dict = {}
    for r in rows:
        exit_reason = str(r.get("exit") or "unknown")
        by_exit[exit_reason] = by_exit.get(exit_reason, 0) + 1
        rounds = int(r.get("llm_rounds") or 0)
        key = str(rounds)
        hist[key] = hist.get(key, 0) + 1

    return {
        "turns": n,
        "avg_llm_rounds": round(total_rounds / n, 3),
        "avg_tool_calls": round(total_tools / n, 3),
        "cap_hits": cap_hits,
        "cap_hit_rate": round(cap_hits / n, 3),
        "max_llm_rounds_seen": max(int(r.get("llm_rounds") or 0) for r in rows),
        "by_exit": dict(sorted(by_exit.items())),
        "rounds_histogram": dict(sorted(hist.items(), key=lambda kv: int(kv[0]))),
        "path": str(path or metrics_path()),
    }
