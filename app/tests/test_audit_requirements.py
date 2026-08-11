"""Conformance suite for the Python half of the audit-requirement spec.

Cases live in shared/audit-requirement-cases.json and are ALSO run by
mern/client/src/utils/auditRequirements.test.mjs against the JS original.
If the two implementations drift, one of the two suites goes red.
"""
import json
import re
from pathlib import Path

import pytest

from audit_requirements import (
    evaluate_subrequirement,
    match_groups,
    requirement_mode,
)

CASES_PATH = Path(__file__).resolve().parents[2] / "shared" / "audit-requirement-cases.json"
_FIXTURE = json.loads(CASES_PATH.read_text())
CASES = _FIXTURE["cases"]
SCOPE_CASES = _FIXTURE["scope_cases"]


def normalize(value):
    return " ".join(str(value or "").upper().split())


def matches(course_id, code):
    return normalize(course_id) == normalize(code)


def test_shared_fixture_present():
    assert len(CASES) >= 10, f"expected 10+ shared cases, got {len(CASES)}"


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_case(case):
    result = evaluate_subrequirement(case["requirement"], case["courses"], matches)
    expect = case["expect"]
    assert result["mode"] == expect["mode"], "mode"
    assert result["satisfied"] == expect["satisfied"], "satisfied"
    assert result["progress"] == expect["progress"], "progress"
    assert result["needed"] == expect["needed"], "needed"
    assert len(result["open_groups"]) == expect["openGroupCount"], "open_groups"


# --- Shared scope cases: how far "a course counts once" reaches --------------
#
# The Python entry point is check_coverage over every section at once; a
# subrequirement is satisfied when it produces no warning. JS runs the same
# fixtures through evaluateRequirement per section. See _scope_comment in the
# fixture file.

def _grid(courses):
    grid = [{"fall": [], "winter": [], "spring": []} for _ in range(4)]
    grid[2]["fall"] = [dict(c, status="planned") for c in courses]
    return grid


def _all_subrequirement_titles(sections):
    """Titles a scope case can report as satisfied.

    check_coverage emits WARNINGS, so this suite reads "satisfied" as "not
    warned". Two row shapes never reach it, and they are not the same thing: a
    row the audit already marks fulfilled or in progress asks nothing of the
    plan and IS satisfied, while a row stating no NEEDS at all is skipped
    outright by both sides — neither satisfied nor blocking. Only the first
    kind belongs in the candidate list.
    """
    titles = []
    for s in sections:
        for sub in s.get("subrequirements", []):
            if (not sub.get("needType")
                    and sub.get("status") not in ("fulfilled", "in_progress")):
                continue
            titles.append(sub.get("title"))
    return titles


@pytest.mark.parametrize("case", SCOPE_CASES, ids=[c["name"] for c in SCOPE_CASES])
def test_shared_scope_case(case):
    from planner_agent import check_coverage

    warnings = check_coverage(case["sections"], _grid(case["courses"]), [])
    warned = {
        m.group(1)
        for w in warnings
        if (m := re.search(r"Requirement '([^']+)'", w["message"]))
    }
    satisfied = [t for t in _all_subrequirement_titles(case["sections"]) if t not in warned]
    assert sorted(satisfied) == sorted(case["expect"]["satisfied"])


# --- Python-only detail tests ------------------------------------------------

def test_requirement_mode():
    assert requirement_mode([["A"], ["B"]], "courses", 2) == "all"
    assert requirement_mode([["A"], ["B"], ["C"]], "courses", 1) == "any"
    assert requirement_mode([["A"], ["B"]], "units", 8) == "any"
    assert requirement_mode([], "courses", 0) == "any"


def test_open_groups_name_the_remaining_slots():
    result = evaluate_subrequirement(
        {
            "needType": "courses",
            "needAmount": 3,
            "groups": [["MATH 189", "DSC 152"], ["DSC 100"], ["DSC 148", "CSE 158"]],
        },
        [{"course_id": "DSC 100", "credits": 4}],
        matches,
    )
    assert result["satisfied"] is False
    assert result["open_groups"] == [["MATH 189", "DSC 152"], ["DSC 148", "CSE 158"]]


def test_match_groups_reports_consumed_courses():
    count, _satisfied, used = match_groups(
        [["DSC 100"], ["DSC 102"]],
        ["DSC 100", "DSC 102", "CSE 100"],
        matches,
    )
    assert count == 2
    assert sorted(used) == ["DSC 100", "DSC 102"]
