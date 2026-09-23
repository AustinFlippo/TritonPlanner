"""MCP server tools (mcp_server.py).

The @server.tool() decorator returns the original callable, so these call the
tool functions directly — the stdio transport itself is the SDK's job. What
matters here is that each tool wraps the shared planner executors with the
same behavior the in-app agent sees, plus the MCP-only affordances (the grid
header on check_plan, raw-snapshot section rows).
"""
import json

import pytest

import mcp_server


def test_search_courses_finds_catalog_matches():
    out = mcp_server.search_courses("data structures", departments=["CSE"],
                                    limit=5)
    assert "CSE 100" in out


def test_search_courses_rejects_bad_limit():
    out = mcp_server.search_courses("anything", limit=0)
    assert out.startswith("ERROR: invalid search arguments")


def test_lookup_courses_reports_not_found():
    out = mcp_server.lookup_courses(["CSE 100", "FAKE 999"])
    assert "CSE 100 | " in out
    assert "FAKE 999: NOT FOUND" in out


def test_check_plan_header_names_grid_anchor():
    out = mcp_server.check_plan([])
    assert out.splitlines()[0].startswith("[grid: year_index 0 = fall 20")


def test_check_plan_flags_nonexistent_course():
    enroll_line = mcp_server.check_plan([]).splitlines()[0]
    # Place into the earliest plannable term so only the bogus code errors.
    yi = int(enroll_line.split("year_index ")[2].split()[0])
    term = enroll_line.split(f"year_index {yi} ")[1].split()[0]
    out = mcp_server.check_plan(
        [{"year_index": yi, "term": term, "course_ids": ["ZZZ 999"]}])
    assert "ERROR" in out and "ZZZ 999" in out


def test_check_plan_invalid_shape_is_an_error_string():
    out = mcp_server.check_plan([{"term": "fall"}])
    assert out.startswith("ERROR: invalid placements")


def test_upcoming_sections_reads_raw_snapshot(tmp_path, monkeypatch):
    snap = {
        "term_code": "FA99",
        "scraped_at": "2099-01-01T00:00:00Z",
        "courses": {
            "CSE 100": [{
                "sectionId": "001-000-LE", "componentName": "lecture",
                "days": ["M", "W"], "start": "9:00am", "end": "9:50am",
                "instructor": "Paul Cao", "seatsAvailable": 3,
                "seatsTotal": 100, "waitlisted": 2, "status": "open",
            }],
        },
    }
    path = tmp_path / "upcoming-term.json"
    path.write_text(json.dumps(snap))
    monkeypatch.setattr(mcp_server, "UPCOMING_TERM_PATH", path)
    out = mcp_server.upcoming_sections(["CSE 100", "FAKE 1"])
    assert "FA99 sections" in out
    assert "001-000-LE lecture — MW 9:00am-9:50am — Paul Cao" in out
    assert "3/100 open (open, waitlist 2)" in out
    assert "FAKE 1: not on the FA99 schedule." in out


def test_upcoming_sections_missing_snapshot(tmp_path, monkeypatch):
    monkeypatch.setattr(mcp_server, "UPCOMING_TERM_PATH",
                        tmp_path / "nope.json")
    out = mcp_server.upcoming_sections(["CSE 100"])
    assert "No upcoming-term snapshot" in out
