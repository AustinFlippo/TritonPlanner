"""Unit tests for planner loop metrics persistence + aggregation."""
import json
from pathlib import Path

import planner_metrics
from planner_metrics import record_loop_turn, summarize_metrics


def test_record_and_summarize_averages(tmp_path, monkeypatch):
    path = tmp_path / "metrics.jsonl"
    monkeypatch.setenv("PLANNER_METRICS_PATH", str(path))
    monkeypatch.delenv("PLANNER_METRICS_DISABLED", raising=False)
    # Force-enable even if conftest set DISABLED=1.
    monkeypatch.setenv("PLANNER_METRICS_DISABLED", "0")

    record_loop_turn(
        llm_rounds=1, tool_calls=0, tools={}, exit_reason="text",
        hit_cap=False, max_llm_calls=12,
    )
    record_loop_turn(
        llm_rounds=3, tool_calls=4, tools={"CheckPlan": 1, "ProposeSchedule": 1},
        exit_reason="propose_schedule", hit_cap=False, max_llm_calls=12,
    )
    record_loop_turn(
        llm_rounds=12, tool_calls=12, tools={"ProposeSchedule": 12},
        exit_reason="cap_propose_schedule", hit_cap=True, max_llm_calls=12,
    )

    lines = path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 3
    assert json.loads(lines[0])["llm_rounds"] == 1

    summary = summarize_metrics(path=path)
    assert summary["turns"] == 3
    assert summary["avg_llm_rounds"] == 5.333  # (1+3+12)/3
    assert summary["avg_tool_calls"] == 5.333
    assert summary["cap_hits"] == 1
    assert summary["cap_hit_rate"] == 0.333
    assert summary["max_llm_rounds_seen"] == 12
    assert summary["by_exit"]["propose_schedule"] == 1
    assert summary["rounds_histogram"]["12"] == 1


def test_summarize_empty(tmp_path):
    path = tmp_path / "missing.jsonl"
    summary = summarize_metrics(path=path)
    assert summary["turns"] == 0
    assert summary["avg_llm_rounds"] is None


def test_metrics_disabled_skips_disk(tmp_path, monkeypatch):
    path = tmp_path / "metrics.jsonl"
    monkeypatch.setenv("PLANNER_METRICS_PATH", str(path))
    monkeypatch.setenv("PLANNER_METRICS_DISABLED", "1")
    record = record_loop_turn(
        llm_rounds=2, tool_calls=1, tools={"LookupCourses": 1},
        exit_reason="text", hit_cap=False, max_llm_calls=12,
    )
    assert record["llm_rounds"] == 2
    assert not path.exists()
