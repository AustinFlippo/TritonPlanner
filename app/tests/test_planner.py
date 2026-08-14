"""Unit tests for the planner agent: deterministic validation + the tool loop.

Run from app/: python -m pytest tests/ -q
Uses a small fixture catalog/prereq graph so tests don't depend on v5.json.
"""
from datetime import date

import pytest
from langchain_core.messages import AIMessage

import catalog
import planner_agent
from planner_agent import (
    CheckPlan,
    LookupCourses,
    ProposeSchedule,
    TermPlacement,
    build_plan_grid,
    check_placements,
    merge_into_grid,
    plan_chat,
)

FIXTURE_COURSES = [
    {"course_id": "CSE 21", "course_name": "Math for Algorithms", "credits": "4",
     "offerings": ["FA", "WI", "SP"], "prerequisites": "none.",
     "description": "Counting and discrete probability."},
    {"course_id": "CSE 100", "course_name": "Advanced Data Structures", "credits": "4",
     "offerings": ["FA", "WI"], "prerequisites": "CSE 21.",
     "description": "Balanced trees and hashing."},
    {"course_id": "CSE 101", "course_name": "Algorithms", "credits": "4",
     "offerings": ["FA", "WI", "SP"], "prerequisites": "CSE 100.",
     "description": "Design and analysis of algorithms."},
    {"course_id": "CSE 158", "course_name": "Recommender Systems", "credits": "4",
     "offerings": ["FA"], "prerequisites": "CSE 100.",
     "description": "Applied machine learning methods for web mining."},
    {"course_id": "DSC 80/80R", "course_name": "Practice of Data Science", "credits": "4",
     "offerings": ["FA", "WI"], "prerequisites": "none.",
     "description": "The data science lifecycle."},
    {"course_id": "DSC 106", "course_name": "Data Visualization", "credits": "4",
     "offerings": ["SP"], "prerequisites": "DSC 80.",
     "description": "Design and evaluation of visualizations."},
    {"course_id": "DSC 240", "course_name": "Machine Learning", "credits": "4",
     "offerings": ["WI"], "prerequisites": "graduate standing.",
     "description": "Graduate machine learning."},
    {"course_id": "MUS 1A", "course_name": "Fundamentals of Music", "credits": "4",
     "offerings": [], "prerequisites": "", "description": ""},
    # Section-variant fixtures: SIO 20 is a base course the audit may print as
    # the remote "SIO 20R"; SIO 109R is a variant the catalog lists in its own
    # right. Kept in their own department so the dept-filtered search
    # assertions below stay exact.
    {"course_id": "SIO 20", "course_name": "The Atmosphere", "credits": "4",
     "offerings": [], "prerequisites": "", "description": ""},
    {"course_id": "SIO 109R", "course_name": "Climate Change", "credits": "4",
     "offerings": [], "prerequisites": "", "description": ""},
    # Dash-joined sequence entries, the three credit shapes the catalog uses:
    # per-quarter, one value for every quarter, and variable-unit.
    {"course_id": "HIST 4A-B-C", "course_name": "United States", "credits": "4-4-4",
     "offerings": [], "prerequisites": "", "description": ""},
    {"course_id": "HIST 9A-B", "course_name": "Readings", "credits": "4",
     "offerings": [], "prerequisites": "", "description": ""},
    {"course_id": "HIST 7A-B-C", "course_name": "Seminar", "credits": "0-4/0-4/0-4",
     "offerings": [], "prerequisites": "", "description": ""},
    # Corequisite pair, the real ECE 65 / ECE 100 shape: ECE 65 is listed as a
    # prerequisite AND as concurrent_allowed, so the same quarter is fine.
    {"course_id": "ECE 65", "course_name": "Components and Circuits", "credits": "4",
     "offerings": ["FA", "WI", "SP"], "prerequisites": "none.", "description": ""},
    {"course_id": "ECE 100", "course_name": "Linear Electronic Systems",
     "credits": "4", "offerings": ["FA", "WI", "SP"],
     "prerequisites": "ECE 65 (may be taken concurrently).", "description": ""},
]

FIXTURE_PREREQS = {
    "CSE 21": {"requires": [], "confidence": "parsed", "notes": "",
               "unlocks": ["CSE 100"]},
    "CSE 100": {"requires": [["CSE 21"]], "confidence": "parsed", "notes": "",
                "unlocks": ["CSE 101", "CSE 158"]},
    "CSE 101": {"requires": [["CSE 100"]], "confidence": "parsed", "notes": ""},
    "CSE 158": {"requires": [["CSE 100"]], "confidence": "parsed", "notes": ""},
    "DSC 106": {"requires": [["DSC 80/80R"]], "confidence": "parsed", "notes": ""},
    "ECE 100": {"requires": [["ECE 65"]], "confidence": "parsed", "notes": "",
                "meta": {"concurrent_allowed": ["ECE 65"]}},
    # Keyed by the dash-joined PARENT id, the way the real graph writes a
    # multi-quarter sequence — get_prereq_entry has to find it from "HIST 4A".
    "HIST 4A-B-C": {"requires": [["CSE 21"]], "confidence": "parsed", "notes": "",
                    "unlocks": []},
}

# today=2024-10-01 -> earliest enrollable term is year_index 0, fall
TODAY = date(2024, 10, 1)


@pytest.fixture(autouse=True)
def fixture_catalog(monkeypatch):
    by_norm = {}
    for c in FIXTURE_COURSES:
        for alias in catalog.aliases_for(c["course_id"]):
            by_norm.setdefault(catalog._normalize(alias), c)
    monkeypatch.setattr(catalog, "_by_norm", by_norm)
    monkeypatch.setattr(catalog, "_prereq_graph", dict(FIXTURE_PREREQS))
    monkeypatch.setattr(catalog, "_search_index", None)  # rebuild from fixture
    # Default: no live next-quarter feed (far-before-registration behavior).
    # Patch both modules — planner_agent binds load_upcoming_term at import.
    monkeypatch.setattr(catalog, "load_upcoming_term", lambda: None)
    monkeypatch.setattr(planner_agent, "load_upcoming_term", lambda: None)


def _install_upcoming(monkeypatch, term_code, term, course_ids, seats=None):
    """Fake Class Planner snapshot for live-enrollment-quarter tests.

    seats: optional {course_id: 'open'|'waitlist'|'full'} overlay stored as
    seat_by_norm. Omitted (the historical default) means unknown seats — we
    still allow the course as long as it is on the feed.
    """
    norms = set()
    seat_by_norm = {}
    for cid in course_ids:
        for alias in catalog.aliases_for(cid):
            key = catalog._normalize(alias)
            norms.add(key)
            if seats and cid in seats:
                seat_by_norm[key] = seats[cid]
    snap = {
        "term_code": term_code,
        "term": term,
        "year": "20" + term_code[2:],
        "scraped_at": "test",
        "course_count": len(course_ids),
        "course_norms": norms,
        "seat_by_norm": seat_by_norm,
    }

    def _load():
        return snap

    monkeypatch.setattr(catalog, "load_upcoming_term", _load)
    monkeypatch.setattr(planner_agent, "load_upcoming_term", _load)
    return snap


def place(year, term, *codes):
    return TermPlacement(year_index=year, term=term, course_ids=list(codes))


def messages_of(result, severity=None):
    issues = result["issues"]
    if severity:
        issues = [i for i in issues if i["severity"] == severity]
    return [i["message"] for i in issues]


# ---------------------------------------------------------------------------
# check_placements
# ---------------------------------------------------------------------------

def test_unknown_course_is_error():
    r = check_placements([], [place(0, "fall", "DSC 152")], today=TODAY)
    assert any("DSC 152" in m and "not found" in m for m in messages_of(r, "error"))
    assert r["valid"] == []


def test_past_term_is_error():
    r = check_placements([], [place(0, "fall", "CSE 21")], today=date(2025, 7, 1))
    assert any("in the past" in m for m in messages_of(r, "error"))
    assert r["valid"] == []


def test_duplicate_within_proposal_is_error():
    r = check_placements(
        [], [place(0, "fall", "CSE 21"), place(0, "winter", "CSE 21")], today=TODAY)
    assert any("already on the planner" in m for m in messages_of(r, "error"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert placed == ["CSE 21"]


def test_duplicate_against_grid_is_error():
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {"course_id": "CSE 21", "course_name": "", "credits": 4}
    r = check_placements(grid, [place(1, "fall", "CSE 21")], today=TODAY)
    assert any("already on the planner" in m for m in messages_of(r, "error"))


def test_remove_from_grid_drops_course():
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {"course_id": "CSE 21", "course_name": "", "credits": 4}
    grid[0]["fall"][1] = {"course_id": "CSE 100", "course_name": "", "credits": 4}
    out, removed = planner_agent.remove_from_grid(grid, ["CSE 21"])
    assert planner_agent._grid_course_ids(out) == {"CSE 100"}
    assert removed == [{
        "label": "Removed · Year 1 · Fall",
        "courses": ["CSE 21"],
    }]


def test_remove_then_place_moves_course():
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {"course_id": "CSE 21", "course_name": "", "credits": 4}
    working, _ = planner_agent.remove_from_grid(grid, ["CSE 21"])
    r = check_placements(working, [place(0, "winter", "CSE 21")], today=TODAY)
    assert messages_of(r, "error") == []
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert placed == ["CSE 21"]


def test_accept_remove_only_proposal():
    grid = planner_agent.empty_grid()
    grid[2]["fall"][0] = {
        "course_id": "CSE 100", "course_name": "", "credits": 4, "status": "planned",
    }
    proposal = ProposeSchedule(
        placements=[],
        remove_course_ids=["CSE 100"],
        explanation="Remove CSE 100 from Fall.",
    )
    out = planner_agent._accept(proposal, grid, set(), TODAY)
    assert "proposed_schedule" in out
    assert planner_agent._grid_course_ids(out["proposed_schedule"]) == set()
    assert out["placements"][0]["label"].startswith("Removed")
    assert "CSE 100" in out["placements"][0]["courses"]


def test_accept_move_via_remove_and_place():
    grid = planner_agent.empty_grid()
    grid[2]["fall"][0] = {
        "course_id": "CSE 100", "course_name": "", "credits": 4, "status": "planned",
    }
    # CSE 100 needs CSE 21 earlier — satisfy via completed set.
    proposal = ProposeSchedule(
        placements=[place(2, "winter", "CSE 100")],
        remove_course_ids=["CSE 100"],
        explanation="Move CSE 100 to Winter.",
    )
    out = planner_agent._accept(
        proposal, grid, set(), TODAY, satisfied_ids={"CSE 21"})
    assert "proposed_schedule" in out
    ids_by_term = {
        (yi, t): [c["course_id"] for c in (year[t] or []) if isinstance(c, dict)]
        for yi, year in enumerate(out["proposed_schedule"])
        for t in ("fall", "winter", "spring")
    }
    assert "CSE 100" not in ids_by_term[(2, "fall")]
    assert "CSE 100" in ids_by_term[(2, "winter")]


def test_completed_course_is_error():
    r = check_placements([], [place(0, "fall", "CSE 21")],
                         completed_ids={"CSE 21"}, today=TODAY)
    assert any("already completed" in m for m in messages_of(r, "error"))


def test_offerings_mismatch_is_warning_and_still_places():
    # DSC 106 is spring-only; placing it in fall warns but does not block.
    r = check_placements([], [place(0, "fall", "DSC 80"), place(1, "fall", "DSC 106")],
                         today=TODAY)
    assert any("usually offered" in m for m in messages_of(r, "warning"))
    assert not messages_of(r, "error")
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert "DSC 106" in placed


def test_live_upcoming_blocks_unoffered_in_enrollment_quarter(monkeypatch):
    # TODAY is FA24 enrollment. Live FA24 feed has DSC 80 but not CSE 158.
    _install_upcoming(monkeypatch, "FA24", "fall", ["DSC 80", "CSE 21"])
    r = check_placements(
        [], [place(0, "fall", "DSC 80", "CSE 158")], today=TODAY)
    assert any("not on the live FA24" in m for m in messages_of(r, "error"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert "DSC 80/80R" in placed or "DSC 80" in placed
    assert "CSE 158" not in placed


def test_live_upcoming_allows_offered_in_enrollment_quarter(monkeypatch):
    _install_upcoming(monkeypatch, "FA24", "fall", ["CSE 21", "CSE 158"])
    r = check_placements([], [place(0, "fall", "CSE 158")],
                         completed_ids={"CSE 100"}, today=TODAY)
    assert not any("not on the live" in m for m in messages_of(r, "error"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert "CSE 158" in placed


def test_live_upcoming_does_not_block_later_quarters(monkeypatch):
    # CSE 158 missing from FA24 live feed, but winter placement is fine —
    # we only scrape the enrollment quarter.
    _install_upcoming(monkeypatch, "FA24", "fall", ["CSE 21"])
    r = check_placements(
        [],
        [place(0, "fall", "CSE 21"), place(0, "winter", "CSE 158")],
        completed_ids={"CSE 100"},
        today=TODAY,
    )
    assert not any("not on the live" in m for m in messages_of(r, "error"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert "CSE 158" in placed


def test_live_upcoming_warns_but_places_full_course_in_enrollment_quarter(monkeypatch):
    _install_upcoming(monkeypatch, "FA24", "fall", ["CSE 21", "CSE 158"],
                      seats={"CSE 21": "open", "CSE 158": "full"})
    r = check_placements(
        [], [place(0, "fall", "CSE 21", "CSE 158")],
        completed_ids={"CSE 100"}, today=TODAY)
    assert not any("no open seats (full)" in m for m in messages_of(r, "error"))
    assert any("no open seats (full)" in m for m in messages_of(r, "warning"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert "CSE 21" in placed
    assert "CSE 158" in placed


def test_live_upcoming_warns_but_places_waitlist_only_in_enrollment_quarter(monkeypatch):
    _install_upcoming(monkeypatch, "FA24", "fall", ["CSE 158"],
                      seats={"CSE 158": "waitlist"})
    r = check_placements([], [place(0, "fall", "CSE 158")],
                         completed_ids={"CSE 100"}, today=TODAY)
    assert not any("waitlist only" in m for m in messages_of(r, "error"))
    assert any("waitlist only" in m for m in messages_of(r, "warning"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert "CSE 158" in placed


def test_full_course_still_places_in_a_later_quarter(monkeypatch):
    _install_upcoming(monkeypatch, "FA24", "fall", ["CSE 21"],
                      seats={"CSE 21": "open"})
    r = check_placements(
        [], [place(0, "winter", "CSE 158")],
        completed_ids={"CSE 100"}, today=TODAY)
    assert not any("no open seats" in m for m in messages_of(r, "error"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert "CSE 158" in placed


def test_live_seat_overlay_overrides_snapshot_open(monkeypatch):
    # Snapshot thinks CSE 158 is open; the turn's live overlay says full.
    _install_upcoming(monkeypatch, "FA24", "fall", ["CSE 158"],
                      seats={"CSE 158": "open"})
    overlay = {"courses": [{"courseId": "CSE 158", "offered": True, "sections": [
        {"sectionId": "A00", "component": "LE", "packageId": "p1",
         "seatsAvailable": 0, "seatsTotal": 80, "status": "full"},
    ]}]}
    r = check_placements([], [place(0, "fall", "CSE 158")],
                         completed_ids={"CSE 100"}, today=TODAY,
                         seat_availability=overlay)
    assert not any("no open seats (full)" in m for m in messages_of(r, "error"))
    assert any("no open seats (full)" in m for m in messages_of(r, "warning"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert "CSE 158" in placed


def test_package_with_full_discussion_is_not_open():
    # Lecture has seats; the only discussion does not — no enrollable package.
    status = catalog.seat_status_from_sections([
        {"sectionId": "A00", "component": "LE", "packageId": "p1",
         "packageIds": ["p1"], "seatsAvailable": 40, "status": "open"},
        {"sectionId": "A01", "component": "DI", "packageId": "p1",
         "packageIds": ["p1"], "seatsAvailable": 0, "status": "full"},
    ])
    assert status == "full"


def test_one_open_package_keeps_the_course_open():
    status = catalog.seat_status_from_sections([
        {"sectionId": "A00", "component": "LE", "packageIds": ["p1", "p2"],
         "seatsAvailable": 40, "status": "open"},
        {"sectionId": "A01", "component": "DI", "packageId": "p1",
         "packageIds": ["p1"], "seatsAvailable": 0, "status": "full"},
        {"sectionId": "A02", "component": "DI", "packageId": "p2",
         "packageIds": ["p2"], "seatsAvailable": 5, "status": "open"},
    ])
    assert status == "open"


def test_live_upcoming_ignored_when_term_mismatches(monkeypatch):
    # Snapshot is for WI25 while enrollment quarter is FA24 — treat as no data.
    _install_upcoming(monkeypatch, "WI25", "winter", ["CSE 21"])
    r = check_placements([], [place(0, "fall", "CSE 158")],
                         completed_ids={"CSE 100"}, today=TODAY)
    assert not any("not on the live" in m for m in messages_of(r, "error"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert "CSE 158" in placed


def test_live_upcoming_matches_cross_listing_alias(monkeypatch):
    # Feed lists "DSC 80"; catalog canonical is "DSC 80/80R".
    _install_upcoming(monkeypatch, "FA24", "fall", ["DSC 80"])
    r = check_placements([], [place(0, "fall", "DSC 80/80R")], today=TODAY)
    assert not any("not on the live" in m for m in messages_of(r, "error"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert "DSC 80/80R" in placed


def test_no_live_upcoming_does_not_block_enrollment_quarter():
    # Default fixture: no snapshot. Historical offerings warning only.
    r = check_placements([], [place(0, "fall", "CSE 158")],
                         completed_ids={"CSE 100"}, today=TODAY)
    assert not any("not on the live" in m for m in messages_of(r, "error"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert "CSE 158" in placed


def test_prereq_unsatisfied_is_error_and_skips():
    r = check_placements([], [place(0, "fall", "CSE 100")], today=TODAY)
    assert any("needs CSE 21" in m for m in messages_of(r, "error"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert "CSE 100" not in placed


def test_prereq_satisfied_by_earlier_placement():
    r = check_placements(
        [], [place(0, "fall", "CSE 21"), place(0, "winter", "CSE 100")], today=TODAY)
    assert messages_of(r, "error") == []
    assert messages_of(r, "warning") == []


def test_prereq_not_satisfied_by_same_term():
    r = check_placements([], [place(0, "fall", "CSE 21", "CSE 100")], today=TODAY)
    assert any("needs CSE 21" in m for m in messages_of(r, "error"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert "CSE 100" not in placed
    assert "CSE 21" in placed


def test_prereq_satisfied_by_audit_completed():
    r = check_placements([], [place(0, "fall", "CSE 100")],
                         completed_ids={"CSE 21"}, today=TODAY)
    assert messages_of(r, "error") == []
    assert messages_of(r, "warning") == []


def test_prereq_satisfied_through_cross_listing_alias():
    # Grid holds "DSC 80"; the prereq graph wants "DSC 80/80R".
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {"course_id": "DSC 80", "course_name": "", "credits": 4}
    r = check_placements(grid, [place(1, "spring", "DSC 106")], today=TODAY)
    assert messages_of(r, "warning") == []


def test_prereq_member_stored_as_alias_still_matches():
    # Regression: the LLM prereq pass stored registrar-style codes ("DSC 80")
    # while the catalog canonical is "DSC 80/80R", so a prereq the student had
    # already completed matched nothing and warned anyway.
    catalog._prereq_graph["CSE 158"] = {
        "requires": [["DSC 80"]], "confidence": "parsed", "notes": ""}
    r = check_placements([], [place(0, "fall", "CSE 158")],
                         completed_ids={"DSC 80/80R"}, today=TODAY)
    assert messages_of(r, "warning") == []


def test_self_referencing_prereq_group_is_ignored():
    # "Concurrent enrollment in CSE 158" parses as a self-prereq. Nothing can
    # sit strictly earlier than itself, so the group would warn forever.
    catalog._prereq_graph["CSE 158"] = {
        "requires": [["CSE 158"]], "confidence": "parsed", "notes": ""}
    r = check_placements([], [place(0, "fall", "CSE 158")], today=TODAY)
    assert messages_of(r, "warning") == []


def test_self_reference_does_not_drop_a_real_alternative():
    catalog._prereq_graph["CSE 101"] = {
        "requires": [["CSE 101", "CSE 21"]], "confidence": "parsed", "notes": ""}
    r = check_placements([], [place(0, "fall", "CSE 101")], today=TODAY)
    assert any("needs CSE 101 or CSE 21" in m for m in messages_of(r, "error"))
    r = check_placements(
        [], [place(0, "fall", "CSE 21"), place(0, "winter", "CSE 101")],
        today=TODAY)
    assert messages_of(r, "error") == []
    assert messages_of(r, "warning") == []


def test_prereq_chain_across_proposal():
    r = check_placements(
        [],
        [place(0, "fall", "CSE 21"), place(0, "winter", "CSE 100"),
         place(1, "fall", "CSE 101")],
        today=TODAY)
    assert messages_of(r) == []


# ---------------------------------------------------------------------------
# Corequisites: the same quarter is early enough
# ---------------------------------------------------------------------------

def test_corequisite_in_the_same_quarter_is_accepted():
    # UCSD explicitly allows ECE 65 alongside ECE 100. Demanding an earlier
    # quarter invented a constraint that does not exist — and compounded along
    # coreq chains for up to three phantom quarters.
    r = check_placements([], [place(0, "fall", "ECE 65", "ECE 100")], today=TODAY)
    assert messages_of(r) == []


def test_corequisite_already_on_the_grid_in_the_same_term_is_accepted():
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {"course_id": "ECE 65", "course_name": "", "credits": 4}
    r = check_placements(grid, [place(0, "fall", "ECE 100")], today=TODAY)
    assert messages_of(r) == []


def test_corequisite_missing_entirely_still_errors_and_says_same_quarter():
    r = check_placements([], [place(0, "fall", "ECE 100")], today=TODAY)
    assert any("ECE 65" in m and "same quarter or earlier" in m
               for m in messages_of(r, "error"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert "ECE 100" not in placed


def test_plain_prerequisite_in_the_same_quarter_still_errors():
    # CSE 21 is NOT flagged concurrent for CSE 100, so nothing changes for it.
    r = check_placements([], [place(0, "fall", "CSE 21", "CSE 100")], today=TODAY)
    assert any("needs CSE 21 in an earlier quarter" in m
               for m in messages_of(r, "error"))


def test_removal_fallout_accepts_a_corequisite_left_in_the_same_term():
    grid = planned_grid((0, "fall", "ECE 65"), (0, "fall", "ECE 100"))
    _grid, _summaries, warnings = build_plan_grid(
        grid, [place(1, "fall", "ECE 65")], today=TODAY,
        remove_course_ids=["ECE 65"])
    # Moved a quarter later than ECE 100, so the coreq is genuinely broken now.
    assert any("ECE 100" in w for w in warnings)


# ---------------------------------------------------------------------------
# Sequence entries: prereqs live under the dash-joined parent id
# ---------------------------------------------------------------------------

def test_sequence_member_inherits_the_parent_entrys_prereqs():
    # 155 courses live inside 61 dash-joined entries; a bare dict lookup on
    # "HIST 4A" found nothing and dropped their prereq checking entirely.
    entry = catalog.get_prereq_entry("HIST 4A")
    assert entry is not None and entry["requires"] == [["CSE 21"]]
    assert planner_agent._prereq_groups("HIST 4A")[0][0] == {"CSE 21"}
    r = check_placements([], [place(0, "fall", "HIST 4A")], today=TODAY)
    assert any("needs CSE 21" in m for m in messages_of(r, "error"))


def test_sequence_member_prereqs_reach_the_prompt_closure():
    text = planner_agent._collect_candidates("plan HIST 4A", [], [], today=TODAY)
    assert "HIST 4A" in text and "CSE 21" in text


# ---------------------------------------------------------------------------
# Unit load
# ---------------------------------------------------------------------------

def test_overloaded_quarter_warns_but_still_places():
    # Five 4-unit courses with prereqs already satisfied via the audit.
    r = check_placements(
        [], [place(0, "fall", "CSE 101", "CSE 158", "DSC 80", "ECE 65", "MUS 1A")],
        completed_ids={"CSE 100", "CSE 21"},
        today=TODAY)
    assert any("over UCSD's 19.5-unit quarter limit" in m
               for m in messages_of(r, "warning"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert len(placed) == 5  # warning, not a block


def test_normal_load_does_not_warn_about_units():
    r = check_placements([], [place(0, "fall", "CSE 21", "DSC 80")], today=TODAY)
    assert not any("unit" in m for m in messages_of(r, "warning"))


def test_unit_warning_counts_courses_already_in_that_term():
    grid = planner_agent.empty_grid()
    grid[0]["fall"] = [
        {"course_id": cid, "course_name": "", "credits": 4, "status": "planned"}
        for cid in ("CSE 21", "CSE 100", "CSE 101", "CSE 158")
    ]
    r = check_placements(grid, [place(0, "fall", "DSC 80")], today=TODAY)
    assert any("20 units after this plan" in m for m in messages_of(r, "warning"))


# ---------------------------------------------------------------------------
# Duplicate detection under sloppy whitespace
# ---------------------------------------------------------------------------

def test_padded_grid_code_still_counts_as_a_duplicate():
    # A card saved as "DSC   152" survived the old .replace("  ", " ") as
    # "DSC  152" and never matched a proposal of "DSC 152".
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {"course_id": "CSE   100", "course_name": "",
                          "credits": 4}
    assert planner_agent._grid_course_ids(grid) == {"CSE 100"}
    r = check_placements(grid, [place(1, "fall", "CSE 100")], today=TODAY)
    assert any("already on the planner" in m for m in messages_of(r, "error"))


# ---------------------------------------------------------------------------
# Removals of completed coursework
# ---------------------------------------------------------------------------

def test_removing_a_completed_course_is_refused():
    grid = planned_grid((0, "fall", "CSE 21"))
    result = planner_agent.check_removals(grid, ["CSE 21"], {"CSE 21"})
    assert [i["severity"] for i in result["issues"]] == ["error"]
    assert result["allowed"] == []


def test_completed_course_survives_a_removal_proposal():
    grid = planned_grid((0, "fall", "CSE 21"))
    proposal = ProposeSchedule(placements=[], remove_course_ids=["CSE 21"],
                               explanation="cleaning up")
    out = planner_agent._accept(proposal, grid, {"CSE 21"}, TODAY)
    # Nothing left the grid, and the student is told why.
    assert any("completed" in w for w in [out["content"], *out.get("warnings", [])])
    assert "proposed_schedule" not in out or \
        planner_agent._grid_course_ids(out["proposed_schedule"]) == {"CSE 21"}


def test_removing_a_planned_course_is_still_fine():
    grid = planned_grid((0, "fall", "CSE 21"))
    result = planner_agent.check_removals(grid, ["CSE 21"], {"CSE 100"})
    assert result["issues"] == [] and result["allowed"] == ["CSE 21"]


# ---------------------------------------------------------------------------
# merge + build_plan_grid
# ---------------------------------------------------------------------------

def test_merge_skips_errors_places_valid():
    # FAKE 999 is missing; CSE 100 without CSE 21 is now an error and skipped.
    grid, summaries, warnings = build_plan_grid(
        [], [place(0, "fall", "CSE 100", "FAKE 999", "CSE 21")], today=TODAY)
    ids = planner_agent._grid_course_ids(grid)
    assert "CSE 21" in ids and "FAKE 999" not in ids and "CSE 100" not in ids
    assert any("not found" in w for w in warnings)
    assert any("needs CSE 21" in w for w in warnings)


def test_merge_keeps_open_slot_and_existing_courses():
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {"course_id": "MUS 1A", "course_name": "", "credits": 4}
    out, summaries, _ = build_plan_grid(grid, [place(0, "fall", "CSE 21")], today=TODAY)
    fall = out[0]["fall"]
    assert [c["course_id"] for c in fall if c] == ["MUS 1A", "CSE 21"]
    assert fall[-1] is None  # always one open slot
    assert summaries[0]["label"] == "Year 1 · Fall"


# ---------------------------------------------------------------------------
# Removal fallout: prereqs a removal breaks for courses left on the grid
# ---------------------------------------------------------------------------

def planned_grid(*entries):
    grid = planner_agent.empty_grid()
    for year, term, code in entries:
        slots = grid[year][term]
        slots[slots.index(None)] = {
            "course_id": code, "course_name": "", "credits": 4,
            "status": "planned",
        }
    return grid


def test_removal_that_breaks_a_later_prereq_warns():
    grid = planned_grid((0, "fall", "CSE 21"), (0, "winter", "CSE 100"))
    _grid, _summaries, warnings = build_plan_grid(
        grid, [], today=TODAY, remove_course_ids=["CSE 21"])
    assert any("CSE 100" in w and "CSE 21" in w for w in warnings)


def test_moving_a_prereq_earlier_reports_no_fallout():
    # A move is remove + re-place; the dependent is still satisfied.
    grid = planned_grid((0, "winter", "CSE 21"), (1, "fall", "CSE 100"))
    _grid, _summaries, warnings = build_plan_grid(
        grid, [place(0, "fall", "CSE 21")], today=TODAY,
        remove_course_ids=["CSE 21"])
    assert warnings == []


def test_moving_a_prereq_past_its_dependent_warns():
    grid = planned_grid((0, "fall", "CSE 21"), (0, "winter", "CSE 100"))
    _grid, _summaries, warnings = build_plan_grid(
        grid, [place(1, "fall", "CSE 21")], today=TODAY,
        remove_course_ids=["CSE 21"])
    assert any("CSE 100" in w for w in warnings)


def test_removal_does_not_blame_a_preexisting_prereq_gap():
    # DSC 106 never had DSC 80 on the grid — removing something unrelated must
    # not start warning about a gap the student already had.
    grid = planned_grid((0, "fall", "CSE 21"), (1, "spring", "DSC 106"))
    _grid, _summaries, warnings = build_plan_grid(
        grid, [], today=TODAY, remove_course_ids=["CSE 21"])
    assert warnings == []


def test_removal_fallout_respects_audit_satisfied_courses():
    # CSE 21 is on the grid AND the audit vouches for it; dropping the grid
    # copy leaves CSE 100's prereq satisfied, so nothing to warn about.
    grid = planned_grid((0, "fall", "CSE 21"), (0, "winter", "CSE 100"))
    _grid, _summaries, warnings = build_plan_grid(
        grid, [], satisfied_ids={"CSE 21"}, today=TODAY,
        remove_course_ids=["CSE 21"])
    assert warnings == []


# ---------------------------------------------------------------------------
# The agent loop
# ---------------------------------------------------------------------------

class FakeToolLLM:
    """Replays scripted AIMessages; repeats the last one when exhausted."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = 0
        self.seen = []

    async def ainvoke(self, messages):
        self.seen.append(list(messages))
        idx = min(self.calls, len(self.responses) - 1)
        self.calls += 1
        return self.responses[idx]


def tool_msg(name, args, call_id="c1"):
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])


def without_loop(result):
    """Strip agent_loop telemetry so equality asserts stay focused on behavior."""
    return {k: v for k, v in (result or {}).items() if k != "agent_loop"}


def placements_args(*triples):
    return {"placements": [
        {"year_index": y, "term": t, "course_ids": codes} for y, t, codes in triples
    ]}


def test_format_seat_availability_includes_open_counts():
    text = planner_agent._format_seat_availability({
        "termLabel": "Fall 2026",
        "source": "live",
        "live": True,
        "refreshedAt": 1,
        "courses": [{
            "courseId": "CSE 100",
            "offered": True,
            "sections": [{
                "sectionId": "A00",
                "component": "LE",
                "days": ["M", "W", "F"],
                "start": "10:00am",
                "end": "10:50am",
                "seatsAvailable": 3,
                "seatsTotal": 120,
                "waitlisted": 0,
                "status": "open",
                "instructor": "Gupta",
            }],
        }],
    })
    assert "Fall 2026" in text
    assert "live seats (Class Planner)" in text
    assert "CSE 100" in text
    assert "3/120 open" in text


def test_format_seat_availability_snapshot_is_usable_not_tss_gate():
    text = planner_agent._format_seat_availability({
        "termLabel": "Fall 2026",
        "source": "classplanner",
        "live": False,
        "courses": [{
            "courseId": "CSE 100",
            "offered": True,
            "sections": [{
                "sectionId": "A00",
                "component": "LE",
                "days": ["M", "W", "F"],
                "start": "10:00am",
                "end": "10:50am",
                "seatsAvailable": 3,
                "seatsTotal": 120,
            }],
        }],
    })
    assert "schedule snapshot (classplanner)" in text
    assert "seats usable this turn" in text
    assert "live TSS" not in text
    assert "3/120 open" in text


def test_system_prompt_forbids_asking_student_to_refresh_tss():
    text = planner_agent.SYSTEM_TEMPLATE
    assert 'refresh TSS' in text
    assert "never tell the student" in text
    assert "shared snapshot" not in text
    assert "live TSS" not in text


@pytest.mark.asyncio
async def test_plain_answer_passthrough():
    llm = FakeToolLLM([AIMessage(content="CSE 100 is offered fall and winter.")])
    out = await plan_chat("when is CSE 100 offered?", [], [], llm=llm, today=TODAY)
    assert without_loop(out) == {"content": "CSE 100 is offered fall and winter."}
    assert out["agent_loop"]["llm_rounds"] == 1


@pytest.mark.asyncio
async def test_seat_availability_reaches_system_prompt():
    llm = FakeToolLLM([AIMessage(content="CSE 100 has 3 seats open.")])
    seats = {
        "termLabel": "Fall 2026",
        "live": True,
        "source": "live",
        "courses": [{
            "courseId": "CSE 100",
            "offered": True,
            "sections": [{
                "sectionId": "A00",
                "component": "LE",
                "days": ["M", "W", "F"],
                "start": "10:00am",
                "end": "10:50am",
                "seatsAvailable": 3,
                "seatsTotal": 120,
                "status": "open",
            }],
        }],
    }
    out = await plan_chat(
        "how many seats in CSE 100?",
        [],
        [],
        llm=llm,
        today=TODAY,
        seat_availability=seats,
    )
    assert out["content"] == "CSE 100 has 3 seats open."
    system = llm.seen[0][0].content
    assert "=== LIVE SECTIONS / SEATS ===" in system
    assert "3/120 open" in system


def test_format_ui_context_quarter_view():
    text = planner_agent._format_ui_context({
        "view": "quarter",
        "enrollment": {
            "label": "Fall 2026",
            "year_index": 2,
            "term": "fall",
        },
    })
    assert "Quarter View" in text
    assert "Fall 2026" in text
    assert "year_index 2" in text
    assert "Year 3 Fall" in text


@pytest.mark.asyncio
async def test_ui_context_reaches_system_prompt():
    llm = FakeToolLLM([AIMessage(content="I'll keep the swap in Fall.")])
    out = await plan_chat(
        "replace DSC 148 — no seats",
        [],
        [],
        llm=llm,
        today=TODAY,
        ui_context={
            "view": "quarter",
            "enrollment": {
                "label": "Fall 2026",
                "year_index": 2,
                "term": "fall",
            },
        },
    )
    assert out["content"] == "I'll keep the swap in Fall."
    system = llm.seen[0][0].content
    assert "=== ACTIVE UI ===" in system
    assert "Quarter View" in system
    assert "year_index 2" in system
    assert "MUST stay in that same" in system


def test_seat_course_keys_collapse_cross_listing_spellings():
    # The client sends the TSS id (never slashed); the agent reads the catalog
    # id out of its prompt. Both must land on one key.
    keys = planner_agent._seat_course_keys(
        {"courses": [{"courseId": "DSC 80R", "sections": []}]})
    assert planner_agent._norm_course_key("DSC 80/80R") in keys
    assert planner_agent._norm_course_key("DSC 80") in keys


@pytest.mark.asyncio
async def test_slashed_lookup_is_not_re_requested_after_a_tss_answer():
    # Reproduction of the hard failure: the agent asks for "DSC 80/80R" after
    # the client already answered for "DSC 80R". A second seat_lookup made the
    # client throw "repeated an already completed TSS lookup", which surfaced
    # to the student as a generic "is the Express server running?" error.
    llm = FakeToolLLM([
        tool_msg("LookupLiveSections", {"codes": ["DSC 80/80R"]}),
        AIMessage(content="DSC 80 has no open seats."),
    ])
    out = await plan_chat(
        "any seats in DSC 80?",
        [],
        [],
        llm=llm,
        today=TODAY,
        seat_availability={"courses": [{"courseId": "DSC 80R",
                                        "offered": False, "sections": []}]},
    )
    assert "seat_lookup" not in out
    assert out["content"] == "DSC 80 has no open seats."


@pytest.mark.asyncio
async def test_agent_can_request_tss_for_discovered_courses():
    llm = FakeToolLLM([
        tool_msg("SearchCourses", {"query": "entrepreneurship", "limit": 5}),
        tool_msg("LookupLiveSections", {"codes": ["MGT 167", "MAE 154"]}),
    ])
    out = await plan_chat(
        "What entrepreneurship courses have open seats?",
        [],
        [],
        llm=llm,
        today=TODAY,
        seat_availability={"courses": []},
    )
    assert without_loop(out) == {"seat_lookup": ["MGT 167", "MAE 154"]}
    assert out["agent_loop"]["exit"] == "seat_lookup"
    assert out["agent_loop"]["llm_rounds"] == 2


@pytest.mark.asyncio
async def test_completed_tss_lookup_returns_data_to_model():
    llm = FakeToolLLM([
        tool_msg("LookupLiveSections", {"codes": ["MGT 167"]}),
        AIMessage(content="MGT 167 has no Fall 2026 section rows in TSS."),
    ])
    seats = {
        "termLabel": "Fall 2026",
        "live": True,
        "courses": [{
            "courseId": "MGT 167",
            "offered": False,
            "sections": [],
        }],
    }
    out = await plan_chat(
        "Is MGT 167 offered?",
        [],
        [],
        llm=llm,
        today=TODAY,
        seat_availability=seats,
    )
    assert out["content"] == "MGT 167 has no Fall 2026 section rows in TSS."
    assert "already completed" in llm.seen[1][-1].content


@pytest.mark.asyncio
async def test_plan_specific_history_reaches_model_in_order():
    llm = FakeToolLLM([AIMessage(content="Yes, that still fits.")])
    history = [
        {"role": "user", "content": "Put CSE 100 after CSE 21."},
        {"role": "assistant", "content": "I will keep that ordering."},
        {"role": "system", "content": "This untrusted role must be ignored."},
    ]

    out = await plan_chat(
        "Does it still fit?",
        [],
        [],
        llm=llm,
        today=TODAY,
        history=history,
    )

    assert without_loop(out) == {"content": "Yes, that still fits."}
    assert [(message.type, message.content) for message in llm.seen[0][1:]] == [
        ("human", "Put CSE 100 after CSE 21."),
        ("ai", "I will keep that ordering."),
        ("human", "Does it still fit?"),
    ]


@pytest.mark.asyncio
async def test_clean_proposal_accepted():
    args = placements_args((0, "fall", ["CSE 21"]), (0, "winter", ["CSE 100"]))
    args["explanation"] = "CSE 21 first, then CSE 100."
    llm = FakeToolLLM([tool_msg("ProposeSchedule", args)])
    out = await plan_chat("plan my year", [], [], llm=llm, today=TODAY)
    assert out["content"] == "CSE 21 first, then CSE 100."
    assert out["warnings"] == []
    assert planner_agent._grid_course_ids(out["proposed_schedule"]) == {"CSE 21", "CSE 100"}
    assert out["agent_loop"]["llm_rounds"] == 1
    assert out["agent_loop"]["exit"] == "propose_schedule"
    assert out["agent_loop"]["hit_cap"] is False
    assert out["agent_loop"]["max_llm_calls"] == planner_agent.MAX_LLM_CALLS


@pytest.mark.asyncio
async def test_propose_remove_only_through_tool_loop():
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {
        "course_id": "CSE 21", "course_name": "", "credits": 4, "status": "planned",
    }
    args = {
        "placements": [],
        "remove_course_ids": ["CSE 21"],
        "explanation": "Dropped CSE 21.",
    }
    llm = FakeToolLLM([tool_msg("ProposeSchedule", args)])
    out = await plan_chat("remove CSE 21", [], grid, llm=llm, today=TODAY)
    assert out["content"] == "Dropped CSE 21."
    assert planner_agent._grid_course_ids(out["proposed_schedule"]) == set()


@pytest.mark.asyncio
async def test_propose_move_through_tool_loop():
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {
        "course_id": "CSE 21", "course_name": "", "credits": 4, "status": "planned",
    }
    args = placements_args((0, "winter", ["CSE 21"]))
    args["remove_course_ids"] = ["CSE 21"]
    args["explanation"] = "Moved CSE 21 to Winter."
    llm = FakeToolLLM([tool_msg("ProposeSchedule", args)])
    out = await plan_chat("move CSE 21 to winter", [], grid, llm=llm, today=TODAY)
    assert out["content"] == "Moved CSE 21 to Winter."
    sched = out["proposed_schedule"]
    fall_ids = [c["course_id"] for c in sched[0]["fall"] if isinstance(c, dict)]
    winter_ids = [c["course_id"] for c in sched[0]["winter"] if isinstance(c, dict)]
    assert fall_ids == []
    assert winter_ids == ["CSE 21"]


@pytest.mark.asyncio
async def test_lookup_and_check_round_trips():
    propose = placements_args((0, "fall", ["CSE 21"]))
    propose["explanation"] = "done"
    llm = FakeToolLLM([
        tool_msg("LookupCourses", {"codes": ["CSE 21", "DSC 152"]}),
        tool_msg("CheckPlan", placements_args((0, "fall", ["CSE 21"]))),
        tool_msg("ProposeSchedule", propose),
    ])
    out = await plan_chat("plan", [], [], llm=llm, today=TODAY)
    # Lookup result: real entry + NOT FOUND, fed back as a ToolMessage
    lookup_reply = llm.seen[1][-1].content
    assert "CSE 21" in lookup_reply and "NOT FOUND" in lookup_reply
    check_reply = llm.seen[2][-1].content
    assert "No issues" in check_reply
    assert "proposed_schedule" in out


@pytest.mark.asyncio
async def test_erroring_proposal_rejected_then_fixed():
    bad = placements_args((0, "fall", ["DSC 152"]))
    bad["explanation"] = "first try"
    good = placements_args((0, "fall", ["CSE 21"]))
    good["explanation"] = "fixed"
    llm = FakeToolLLM([tool_msg("ProposeSchedule", bad), tool_msg("ProposeSchedule", good)])
    out = await plan_chat("plan", [], [], llm=llm, today=TODAY)
    rejection = llm.seen[1][-1].content
    assert rejection.startswith("REJECTED") and "DSC 152" in rejection
    assert out["content"] == "fixed"
    assert planner_agent._grid_course_ids(out["proposed_schedule"]) == {"CSE 21"}


@pytest.mark.asyncio
async def test_proposal_removing_completed_coursework_is_rejected():
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {"course_id": "CSE 21", "course_name": "", "credits": 4,
                          "grade": "A-"}
    audit = [{"title": "Major", "status": "not_fulfilled", "items": [
        "CSE 21 - Math for Algorithms (FA23, A-)",
    ]}]
    llm = FakeToolLLM([
        tool_msg("ProposeSchedule", {
            "placements": [],
            "remove_course_ids": ["CSE 21"],
            "explanation": "Cleaned up your planner.",
        }),
        AIMessage(content="I left CSE 21 in place — you already passed it."),
    ])
    out = await plan_chat("clean up my planner", audit, grid, llm=llm,
                          today=TODAY)
    reject = llm.seen[1][-1].content
    assert "REJECTED" in reject and "CSE 21" in reject
    assert "completed" in reject
    assert out["content"].startswith("I left CSE 21 in place")


@pytest.mark.asyncio
async def test_cap_ships_best_effort():
    # The model never fixes its error: loop caps, valid courses still ship.
    bad = placements_args((0, "fall", ["CSE 21", "DSC 152"]))
    bad["explanation"] = "stubborn"
    llm = FakeToolLLM([tool_msg("ProposeSchedule", bad)])
    out = await plan_chat("plan", [], [], llm=llm, today=TODAY)
    assert llm.calls == planner_agent.MAX_LLM_CALLS
    assert planner_agent._grid_course_ids(out["proposed_schedule"]) == {"CSE 21"}
    assert any("revision limit" in w for w in out["warnings"])
    assert any("DSC 152" in w for w in out["warnings"])
    # The chat text must describe the GRID, not the rejected proposal: the
    # student used to read "stubborn" (or worse, prose naming DSC 152) while
    # only CSE 21 was applied.
    assert "stubborn" not in out["content"]
    assert "DSC 152" not in out["content"]
    assert "CSE 21" in out["content"]
    assert "revision limit" in out["content"]
    assert out["agent_loop"]["hit_cap"] is True
    assert out["agent_loop"]["llm_rounds"] == planner_agent.MAX_LLM_CALLS
    assert out["agent_loop"]["exit"] == "cap_propose_schedule"


@pytest.mark.asyncio
async def test_invalid_tool_args_bounce_back():
    llm = FakeToolLLM([
        tool_msg("CheckPlan", {"placements": [{"bogus": True}]}),
        AIMessage(content="giving up"),
    ])
    out = await plan_chat("plan", [], [], llm=llm, today=TODAY)
    assert "Invalid arguments" in llm.seen[1][-1].content
    assert without_loop(out) == {"content": "giving up"}


# ---------------------------------------------------------------------------
# Context builders
# ---------------------------------------------------------------------------

def test_graded_from_audit_frontend_format():
    # Real producer format: "CODE - description (TERM, GRADE)"
    # (SidebarAuditTracker.jsx / auditParser.js)
    audit = [{"title": "Major", "status": "not_fulfilled", "items": [
        "CSE 21 - Math for Algorithms (FA23, A-)",
        "DSC 80 - Practice of Data Science (WI24, WIP)",   # in progress counts
        "CSE 100 - Advanced Data Structures (FA23, F)",    # failed doesn't
        "CSE 101 - Algorithms (SP24, W)",                  # withdrawn doesn't
        "NEEDS: DSC 106",
    ]}]
    assert planner_agent._graded_from_audit(audit) == {"CSE 21", "DSC 80/80R"}


def test_graded_from_audit_reads_structured_completed_courses():
    # The frontend parser stores taken courses on subrequirements.completedCourses
    # (and sometimes a section-level list). Items may be empty on older saved
    # audits — those rows must still block re-placement.
    audit = [{"title": "Major", "status": "not_fulfilled", "items": [],
              "completedCourses": [
                  {"course_id": "CSE 21", "grade": "A-", "term": "FA23"},
              ],
              "subrequirements": [{
                  "title": "Core",
                  "completedCourses": [
                      {"course_id": "DSC 80", "grade": "WIP", "term": "WI24"},
                      {"course_id": "CSE 100", "grade": "F", "term": "FA23"},
                  ],
              }]}]
    assert planner_agent._graded_from_audit(audit) == {"CSE 21", "DSC 80/80R"}
    r = check_placements(
        [], [place(0, "fall", "CSE 21"), place(0, "winter", "CSE 100")],
        completed_ids=planner_agent._graded_from_audit(audit), today=TODAY)
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert placed == ["CSE 100"]  # failed attempt is a retake, not completed
    assert any("already completed" in m for m in messages_of(r, "error"))


def test_structured_completed_courses_appear_in_the_audit_prompt():
    audit = [{"title": "Major", "status": "fulfilled", "items": [],
              "subrequirements": [{
                  "completedCourses": [{
                      "course_id": "CSE 21",
                      "description": "Math for Algorithms",
                      "term": "FA23",
                      "grade": "A-",
                  }],
              }]}]
    text = planner_agent._format_audit(audit)
    assert "CSE 21" in text
    assert "A-" in text


def test_catalog_missing_completed_course_still_blocks_replacement():
    # A completing grade on a code v5.json has never listed must still refuse
    # a future placement — otherwise it lands as "unverified" planned work.
    audit = [{"title": "Major", "status": "fulfilled", "items": [],
              "subrequirements": [{
                  "completedCourses": [
                      {"course_id": "ZZZ 999", "grade": "A", "term": "FA23"},
                  ],
              }]}]
    completed = planner_agent._graded_from_audit(audit)
    assert "ZZZ 999" in completed
    r = check_placements(
        [], [place(0, "fall", "ZZZ 999")],
        completed_ids=completed, today=TODAY,
        audit_codes=planner_agent._codes_named_by_audit(audit))
    assert r["valid"] == []
    assert any("already completed" in m for m in messages_of(r, "error"))
    assert not any("unverified" in m for m in messages_of(r, "warning"))


def test_completed_grid_card_blocks_replanning_without_an_audit():
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {
        "course_id": "CSE 21", "credits": 4, "status": "completed", "grade": "A",
    }
    completed = planner_agent._completed_from_grid(grid)
    assert "CSE 21" in completed
    r = check_placements(
        grid, [place(1, "fall", "CSE 21")],
        completed_ids=completed, today=TODAY)
    assert any("already completed" in m for m in messages_of(r, "error"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert "CSE 21" not in placed


def test_failed_grid_card_does_not_block_a_retake():
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {
        "course_id": "CSE 21", "credits": 4, "status": "failed", "grade": "F",
    }
    assert planner_agent._completed_from_grid(grid) == set()


def test_transfer_pass_grade_counts_as_completed():
    # TP = transfer pass. Real audits stamp this on MATH 20A, CSE 8A, etc.
    # (AP/community-college credit posted as the UCSD equivalent).
    audit = [{"title": "Major", "status": "not_fulfilled", "items": [
        "CSE 21 - Math Foundations (SP22, TP)",
        "CSE 100 - Advanced Data Structures (FA23, F)",
    ]}]
    assert planner_agent._graded_from_audit(audit) == {"CSE 21"}
    # Immediate-grade fallback format too.
    audit2 = [{"title": "Major", "status": "fulfilled",
               "items": ["COMPLETE: CSE 21 TP, DSC 80 B"]}]
    assert planner_agent._graded_from_audit(audit2) == {"CSE 21", "DSC 80/80R"}
    # TP'ed prereq satisfies CSE 100 — no error/warning, course places.
    r = check_placements(
        [], [place(0, "fall", "CSE 100")],
        completed_ids=planner_agent._graded_from_audit(audit), today=TODAY)
    assert messages_of(r, "error") == []
    assert messages_of(r, "warning") == []
    assert [c["course_id"] for p in r["valid"] for c in p["courses"]] == ["CSE 100"]


def test_system_prompt_mentions_transfer_ap_tp_credit():
    text = planner_agent.SYSTEM_TEMPLATE
    assert "grade TP" in text and "Transfer and AP credit" in text
    assert "AP **3" in text


def test_graded_from_audit_tolerates_fixed_width_column_padding():
    # A real TritonLink audit renders the course column at a fixed width, so
    # short subjects and numbers arrive padded ("COGS  9", "CCE   1") and long
    # ones arrive with no space at all ("MATH183"). Every fixture used to be
    # hand-written single-spaced, which is how a regex that allowed at most one
    # space passed 100+ tests while seeing two thirds of a real transcript.
    audit = [{"title": "Major", "status": "not_fulfilled", "items": [
        "CSE  21 - Math for Algorithms (FA24, A)",         # 2-space pad
        "CSE   100 - Advanced Data Structures (WI25, B)",  # 3-space pad
        "DSC  80 - Practice of Data Science (SP26, A-)",
        "MUS 1A - Fundamentals of Music (SP25, TP)",
        "CSE101 - Algorithms (SP26, A)",                   # no space at all
        "CSE  158 - Recommender Systems (FA25, F)",        # padded AND failed
    ]}]
    assert planner_agent._graded_from_audit(audit) == {
        "CSE 21", "CSE 100", "DSC 80/80R", "MUS 1A", "CSE 101",
    }


def test_immediate_grade_format_excludes_non_passing():
    audit = [{"title": "Major", "status": "fulfilled",
              "items": ["COMPLETE: CSE 21 F, DSC 80 B"]}]
    assert planner_agent._graded_from_audit(audit) == {"DSC 80/80R"}


def test_past_term_placement_does_not_satisfy_prereqs():
    # CSE 21 lands in a past term (dropped) — it must not satisfy CSE 100.
    r = check_placements(
        [], [place(0, "winter", "CSE 21"), place(1, "fall", "CSE 100")],
        today=date(2025, 7, 1))  # earliest = year 1 fall
    assert any("needs CSE 21" in m for m in messages_of(r, "error"))


def test_rejected_duplicate_does_not_move_prereq_earlier():
    # Grid: CSE 21 in Y2 Winter. Proposal re-places it in Y1 Fall (error) and
    # puts CSE 100 in Y1 Winter — before where CSE 21 REALLY sits.
    grid = planner_agent.empty_grid()
    grid[1]["winter"][0] = {"course_id": "CSE 21", "course_name": "", "credits": 4}
    r = check_placements(
        grid, [place(0, "fall", "CSE 21"), place(0, "winter", "CSE 100")], today=TODAY)
    assert any("already on the planner" in m for m in messages_of(r, "error"))
    assert any("needs CSE 21" in m for m in messages_of(r, "error"))


def test_term_capitalization_is_normalized():
    r = check_placements([], [TermPlacement(year_index=0, term="Fall",
                                            course_ids=["CSE 21"])], today=TODAY)
    assert messages_of(r, "error") == []
    assert r["valid"][0]["term"] == "fall"


def test_grid_base_year_keeps_launch_anchor_then_reanchors():
    # Through FA27 the launch window still fits — stay at 24.
    assert planner_agent.grid_base_year(date(2024, 10, 1)) == 24
    assert planner_agent.grid_base_year(date(2027, 10, 1)) == 24
    # FA28 would be year_index 4 under the launch anchor — re-anchor to 28.
    assert planner_agent.grid_base_year(date(2028, 10, 1)) == 28
    # Winter/Spring belong to the prior fall's academic year.
    assert planner_agent.grid_base_year(date(2029, 2, 1)) == 28


AUG_2026 = date(2026, 8, 11)


def test_plan_window_anchors_to_the_students_catalog_year():
    # Mirrors planWindow in mern/client/src/utils/auditCoursePlanner.js —
    # if these two drift, the agent places courses into rows the client
    # labels differently.
    assert planner_agent.plan_window(26, AUG_2026) == (26, 4)  # 2026 freshman
    assert planner_agent.plan_window(24, AUG_2026) == (24, 4)  # mid-degree
    assert planner_agent.plan_window(22, AUG_2026) == (22, 5)  # fifth-year
    assert planner_agent.plan_window(5, AUG_2026)[1] == 8      # garbled: capped
    # No base year (no audit): fall back to the calendar anchor.
    assert planner_agent.plan_window(None, AUG_2026) == (
        planner_agent.grid_base_year(AUG_2026), 4)


def test_earliest_term_follows_the_students_own_year_one():
    # The bug this fixes: with a fixed 2024 anchor, a 2026 freshman could only
    # be given year_index 2-3 — 6 of 12 quarters of their own degree.
    assert planner_agent.next_enrollable_term(AUG_2026, 26) == (0, "fall")
    assert planner_agent.next_enrollable_term(AUG_2026, 24) == (2, "fall")
    # A fifth-year's current quarter is row 5, which only exists because the
    # window grew past four years.
    assert planner_agent.next_enrollable_term(AUG_2026, 22) == (4, "fall")


def test_fifth_year_can_be_given_their_current_quarter():
    # year_index 4 is out of bounds on a 4-row grid; with base_year=22 the
    # window is 5 rows and the placement is accepted.
    r = check_placements([], [place(4, "fall", "CSE 21")], today=AUG_2026,
                         base_year=22)
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert placed == ["CSE 21"]
    assert messages_of(r, "error") == []

    # Same placement without the base year: 4 rows, so it's out of the grid.
    r2 = check_placements([], [place(4, "fall", "CSE 21")], today=AUG_2026)
    assert r2["valid"] == []
    assert any("outside" in m for m in messages_of(r2, "error"))


def test_longer_saved_grid_is_never_truncated():
    # A fifth-year's 5-row plan must survive a request that didn't carry their
    # base year, or a turn of chat would silently delete their last year.
    grid = planner_agent.empty_grid(5)
    grid[4]["fall"][0] = {"course_id": "CSE 21", "credits": 4, "status": "planned"}
    coerced = planner_agent._coerce_grid(grid)
    assert len(coerced) == 5
    assert coerced[4]["fall"][0]["course_id"] == "CSE 21"


def test_future_academic_year_placements_are_not_all_past():
    # Regression: with a hard-coded BASE_YEAR=24, FA28 made every year_index
    # 0-3 placement look "already in the past". Re-anchoring keeps FA28 at
    # year_index 0 so the next enrollable term is placeable.
    today = date(2028, 10, 1)
    assert planner_agent.next_enrollable_term(today) == (0, "fall")
    r = check_placements([], [place(0, "fall", "CSE 21"), place(1, "winter", "CSE 100")],
                         today=today)
    assert not any("already in the past" in m for m in messages_of(r, "error"))
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert placed == ["CSE 21", "CSE 100"]


def test_aliases_for_mixed_cross_listings():
    assert catalog.aliases_for("HIUS 167/267/ETHN 180") == [
        "HIUS 167/267/ETHN 180", "HIUS 167", "HIUS 267", "ETHN 180"]
    assert catalog.aliases_for("HITO 193/POLI 194/COM GEN 194/USP 194") == [
        "HITO 193/POLI 194/COM GEN 194/USP 194",
        "HITO 193", "POLI 194", "COM GEN 194", "USP 194"]
    assert catalog.aliases_for("AAS/ANSC 185") == ["AAS/ANSC 185", "AAS 185", "ANSC 185"]
    assert catalog.aliases_for("CHIN 160/260") == ["CHIN 160/260", "CHIN 160", "CHIN 260"]
    assert catalog.aliases_for("EDS 31/CHEM 96") == ["EDS 31/CHEM 96", "EDS 31", "CHEM 96"]
    assert catalog.aliases_for("CSE 100") == ["CSE 100"]


def test_graded_from_audit_only_counts_graded_mentions():
    audit = [{"title": "Major", "status": "not_fulfilled",
              "items": ["COMPLETE: CSE 21 A+, DSC 80 B",
                        "NEEDS: CSE 100, DSC 106",
                        "WANT 4 units"]}]
    graded = planner_agent._graded_from_audit(audit)
    assert graded == {"CSE 21", "DSC 80/80R"}  # NEEDS courses excluded
    mentioned = planner_agent._mentioned_in_audit(audit)
    assert {"CSE 100", "DSC 106"} <= mentioned


GRADELESS_AUDIT = [{"title": "Major", "status": "not_fulfilled",
                    "items": ["Required: CSE 21, CSE 100"]}]
GRADED_AUDIT = [{"title": "Major", "status": "not_fulfilled",
                 "items": ["CSE 21 - Math for Algorithms (FA23, A-)"]}]


@pytest.mark.asyncio
async def test_ungradeable_audit_warns_that_prereq_checks_are_approximate():
    # No grades parsed -> every mention counts as done, which silently turns
    # prereq checking off. The student must be told.
    propose = placements_args((0, "fall", ["CSE 100"]))
    propose["explanation"] = "added"
    llm = FakeToolLLM([tool_msg("ProposeSchedule", propose)])
    out = await plan_chat("plan", GRADELESS_AUDIT, [], llm=llm, today=TODAY)
    assert any("couldn't read any course grades" in w for w in out["warnings"])


@pytest.mark.asyncio
async def test_no_fallback_warning_when_grades_parse():
    propose = placements_args((0, "fall", ["CSE 100"]))
    propose["explanation"] = "added"
    llm = FakeToolLLM([tool_msg("ProposeSchedule", propose)])
    out = await plan_chat("plan", GRADED_AUDIT, [], llm=llm, today=TODAY)
    assert not any("couldn't read any course grades" in w
                   for w in out.get("warnings") or [])


@pytest.mark.asyncio
async def test_no_fallback_warning_without_an_audit():
    # Nothing to misread when no audit was uploaded.
    propose = placements_args((0, "fall", ["CSE 21"]))
    propose["explanation"] = "added"
    llm = FakeToolLLM([tool_msg("ProposeSchedule", propose)])
    out = await plan_chat("plan", [], [], llm=llm, today=TODAY)
    assert not any("couldn't read any course grades" in w
                   for w in out.get("warnings") or [])


def test_audit_prompt_is_never_truncated():
    # Enforcement reads the whole audit, so the prompt must too: a completed
    # course near the end still blocks re-placement, and the model can only
    # avoid proposing it if it can see it.
    filler = [{"title": f"Section {i}", "status": "fulfilled",
               "items": [f"Requirement line {i} — " + "x" * 400]}
              for i in range(120)]
    audit = filler + [{"title": "Major", "status": "not_fulfilled",
                       "items": ["COMPLETE: CSE 21 A+"]}]
    text = planner_agent._format_audit(audit)
    assert len(text) > 40000, "fixture should exceed any plausible cap"
    assert "truncated" not in text
    assert "CSE 21 A+" in text  # the last line survives
    assert planner_agent._graded_from_audit(audit) == {"CSE 21"}


def test_needed_courses_are_placeable_and_graded_block():
    # Regression: NEEDS-list courses must not be rejected as "already completed".
    audit = [{"title": "Major", "status": "not_fulfilled",
              "items": ["COMPLETE: CSE 21 A", "NEEDS: CSE 100"]}]
    completed = planner_agent._graded_from_audit(audit)
    r = check_placements([], [place(0, "fall", "CSE 100"), place(0, "winter", "CSE 21")],
                         completed_ids=completed, today=TODAY)
    placed = [c["course_id"] for p in r["valid"] for c in p["courses"]]
    assert placed == ["CSE 100"]  # needed course places; completed one errors
    assert any("already completed" in m for m in messages_of(r, "error"))
    assert messages_of(r, "warning") == []  # CSE 21 grade satisfies the prereq


def test_available_codes_read_a_spaceless_token_like_the_client_does():
    # normalizeCode in auditProgress.js inserts the missing space. Without it
    # "DSC100" was dropped AND left last_subject unset, so the bare-number
    # continuations after it were dropped too — the two sides then disagreed
    # about what the audit offered.
    codes = planner_agent._parse_available_codes(
        "Available: DSC100, 102, CSE 101")
    assert codes[:3] == ["DSC 100", "DSC 102", "CSE 101"]


def test_major_codes_keep_courses_the_catalog_has_never_heard_of():
    # The JS keeps them; dropping them made the two disagree on any audit that
    # names an uncataloged major course — and when EVERY code was uncataloged
    # the filter switched itself off entirely.
    audit = [{
        "title": "MAJOR REQUIREMENTS", "status": "not_fulfilled", "items": [],
        "subrequirements": [
            {"title": "Core", "status": "not_fulfilled", "needType": "courses",
             "needAmount": 1, "groups": [["XYZ 152"]],
             "availableCodes": ["XYZ 152"]},
        ],
    }]
    codes = planner_agent._major_course_codes(audit)
    assert codes and planner_agent._counts_toward_major("XYZ 152", codes)
    assert not planner_agent._counts_toward_major("CSE 101", codes)


def test_major_codes_match_across_cross_listings():
    audit = [{
        "title": "MAJOR REQUIREMENTS", "status": "not_fulfilled", "items": [],
        "subrequirements": [
            {"title": "Core", "status": "not_fulfilled", "needType": "courses",
             "needAmount": 1, "groups": [["DSC 80"]], "availableCodes": ["DSC 80"]},
        ],
    }]
    codes = planner_agent._major_course_codes(audit)
    assert planner_agent._counts_toward_major("DSC 80/80R", codes)
    assert planner_agent._counts_toward_major("DSC 80R", codes)


def test_candidates_include_structured_prereqs():
    text = planner_agent._collect_candidates("thinking about CSE 100", [], [])
    assert "CSE 100" in text and "(CSE 21)" in text


def test_candidates_expand_prereq_closure():
    # Only CSE 101 is mentioned — but its whole prereq chain gets pre-seeded.
    text = planner_agent._collect_candidates("I need CSE 101", [], [])
    lines = text.splitlines()
    assert lines[0].startswith("CSE 101")           # mentioned course first
    assert any(l.startswith("CSE 100") for l in lines)  # direct prereq
    assert any(l.startswith("CSE 21") for l in lines)   # transitive prereq


def test_candidates_closure_respects_cap(monkeypatch):
    monkeypatch.setattr(planner_agent, "MAX_CANDIDATES", 2)
    text = planner_agent._collect_candidates("I need CSE 101", [], [])
    assert len(text.splitlines()) == 2


def _huge_audit_pool(count):
    """An audit whose Available: list is longer than the whole seed budget —
    the normal shape of a real audit (the Arts requirement alone lists 81)."""
    codes = [f"FAKE {i}" for i in range(1, count + 1)]
    for code in codes:
        catalog._by_norm[catalog._normalize(code)] = {
            "course_id": code, "course_name": "Filler", "credits": "4",
            "offerings": [], "prerequisites": "", "description": "",
        }
    return [{"title": "ELECTIVES", "status": "not_fulfilled",
             "items": [f"NEEDS: 1.0 more Courses | Available: {', '.join(codes)}"]}]


def test_huge_audit_pool_does_not_starve_the_prereq_closure():
    # 130 audit codes used to fill all 120 entries with seeds and emit ZERO
    # prereq chains — for exactly the students with the most complex audits.
    audit = _huge_audit_pool(130)
    text = planner_agent._collect_candidates("I need CSE 101", audit, [],
                                             today=TODAY)
    lines = text.splitlines()
    assert len(lines) <= planner_agent.MAX_CANDIDATES
    assert any(l.startswith("CSE 100") for l in lines)  # closure survived
    assert any(l.startswith("CSE 21") for l in lines)


def test_message_and_grid_courses_outrank_a_huge_audit_pool():
    audit = _huge_audit_pool(130)
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {"course_id": "DSC 106", "course_name": "",
                          "credits": 4}
    text = planner_agent._collect_candidates("I need CSE 101", audit, grid,
                                             today=TODAY)
    lines = text.splitlines()
    assert lines[0].startswith("CSE 101")               # the message wins
    assert any(l.startswith("DSC 106") for l in lines)  # then the grid


def test_entry_shows_unlocks():
    entry = planner_agent._format_course_entry(catalog.get_course("CSE 100"))
    assert "unlocks: CSE 101, CSE 158" in entry


# ---------------------------------------------------------------------------
# Catalog search + the SearchCourses tool
# ---------------------------------------------------------------------------

def test_search_exact_id_ranks_first():
    courses, _ = catalog.search_courses("CSE 100")
    assert courses[0]["course_id"] == "CSE 100"


def test_search_by_topic_hits_name_and_description():
    courses, _ = catalog.search_courses("machine learning")
    ids = [c["course_id"] for c in courses]
    # Name match ("Machine Learning") outranks description-only match.
    assert ids[0] == "DSC 240"
    assert "CSE 158" in ids


def test_search_filters():
    courses, _ = catalog.search_courses("machine learning", levels=["upper"])
    assert [c["course_id"] for c in courses] == ["CSE 158"]
    courses, _ = catalog.search_courses("", depts=["DSC"], quarters=["SP"])
    assert [c["course_id"] for c in courses] == ["DSC 106"]
    courses, _ = catalog.search_courses("", depts=["MUS"])
    assert [c["course_id"] for c in courses] == ["MUS 1A"]


def test_search_no_match_and_limit():
    courses, total = catalog.search_courses("underwater basket weaving")
    assert courses == [] and total == 0
    courses, total = catalog.search_courses("", depts=["CSE"], limit=2)
    assert len(courses) == 2 and total == 4


# ---------------------------------------------------------------------------
# Requirement coverage
# ---------------------------------------------------------------------------

AUDIT_WITH_NEEDS = [{
    "title": "MAJOR ELECTIVES", "status": "not_fulfilled",
    "items": ["NEEDS: 2.0 more Courses | Available: CSE 101, 158, DSC 106"],
}]

AUDIT_STRUCTURED = [{
    "title": "MAJOR ELECTIVES", "status": "not_fulfilled",
    "items": ["NEEDS: 2.0 more Courses | Available: CSE 101, 158, DSC 106"],
    "subrequirements": [
        {"status": "not_fulfilled", "needType": "courses", "needAmount": 2,
         "availableCodes": ["CSE 101", "CSE 158", "DSC 106"]},
        {"status": "fulfilled", "needType": "courses", "needAmount": 1,
         "availableCodes": ["CSE 21"]},
    ],
}]


def test_requirements_parse_legacy_items():
    reqs = planner_agent._requirements_from_audit(AUDIT_WITH_NEEDS)
    assert len(reqs) == 1
    assert reqs[0]["need_amount"] == 2.0 and reqs[0]["need_type"] == "courses"
    # bare numbers inherit the previous subject
    assert reqs[0]["candidates"] == ["CSE 101", "CSE 158", "DSC 106"]


def test_requirements_prefer_structured_and_skip_fulfilled():
    reqs = planner_agent._requirements_from_audit(AUDIT_STRUCTURED)
    assert len(reqs) == 1  # the fulfilled subrequirement is skipped
    assert reqs[0]["candidates"] == ["CSE 101", "CSE 158", "DSC 106"]


def test_coverage_range_token_matches_courses_in_the_band():
    audit = [{
        "title": "MAJOR ELECTIVES", "status": "not_fulfilled",
        "subrequirements": [
            {"status": "not_fulfilled", "needType": "courses", "needAmount": 1,
             "groups": [["CSE 100TO199"]], "availableCodes": ["CSE 100TO199"],
             "mode": "any"},
        ],
    }]
    assert planner_agent.check_coverage(
        audit, [], [place(0, "fall", "CSE 158")]) == []
    issues = planner_agent.check_coverage(
        audit, [], [place(0, "fall", "CSE 21")])
    assert issues and "still short" in issues[0]["message"]


def test_major_codes_range_token_counts_in_band_courses():
    audit = [{
        "title": "MAJOR REQUIREMENTS", "status": "not_fulfilled", "items": [],
        "subrequirements": [
            {"title": "Electives", "status": "not_fulfilled", "needType": "courses",
             "needAmount": 1, "groups": [["CSE 100TO199"]],
             "availableCodes": ["CSE 100TO199"]},
        ],
    }]
    codes = planner_agent._major_course_codes(audit)
    assert codes and planner_agent._counts_toward_major("CSE 158", codes)
    assert not planner_agent._counts_toward_major("CSE 21", codes)


def test_codes_named_by_audit_skip_range_tokens():
    audit = [{
        "title": "MAJOR ELECTIVES", "status": "not_fulfilled",
        "subrequirements": [
            {"groups": [["CSE 100TO199", "CSE 101"]],
             "availableCodes": ["CSE 100TO199", "CSE 101"]},
        ],
    }]
    named = planner_agent._codes_named_by_audit(audit)
    assert "CSE 101" in named
    assert "CSE 100TO199" not in named
    issues = planner_agent.check_coverage(
        AUDIT_WITH_NEEDS, [], [place(0, "fall", "CSE 101")])
    assert len(issues) == 1 and issues[0]["severity"] == "warning"
    msg = issues[0]["message"]
    assert "MAJOR ELECTIVES" in msg and "still short 1" in msg
    assert "CSE 158" in msg and "DSC 106" in msg  # unplaced options offered


def test_coverage_clean_when_met_via_alias():
    # "DSC 106" candidate; grid holds planned DSC 106 + proposal adds CSE 158.
    grid = planner_agent.empty_grid()
    grid[1]["spring"][0] = {"course_id": "DSC 106", "credits": 4, "status": "planned"}
    issues = planner_agent.check_coverage(
        AUDIT_WITH_NEEDS, grid, [place(1, "fall", "CSE 158")])
    assert issues == []


def test_coverage_ignores_completed_grid_courses():
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {"course_id": "CSE 101", "credits": 4, "status": "completed"}
    issues = planner_agent.check_coverage(AUDIT_WITH_NEEDS, grid, [])
    assert "still short 2" in issues[0]["message"]


def test_coverage_no_double_counting_within_section():
    # Two NEEDS rows in ONE section: a course fills at most one of them.
    audit = [{
        "title": "MAJOR ELECTIVES", "status": "not_fulfilled",
        "subrequirements": [
            {"status": "not_fulfilled", "needType": "courses", "needAmount": 1,
             "availableCodes": ["CSE 101"], "groups": [["CSE 101"]], "mode": "all"},
            {"status": "not_fulfilled", "needType": "courses", "needAmount": 1,
             "availableCodes": ["CSE 101", "CSE 158"],
             "groups": [["CSE 101"], ["CSE 158"]], "mode": "any"},
        ],
    }]
    issues = planner_agent.check_coverage(audit, [], [place(0, "fall", "CSE 101")])
    assert len(issues) == 1
    assert "still short" in issues[0]["message"] and "CSE 158" in issues[0]["message"]


def test_coverage_allows_same_course_across_sections():
    # Different audit sections may both credit the same planned course
    # (attribute / GE overlap). Matches the sidebar's per-section projection.
    audit = [
        {"title": "REQ A", "status": "not_fulfilled",
         "items": ["NEEDS: 1 more Courses | Available: CSE 101"]},
        {"title": "REQ B", "status": "not_fulfilled",
         "items": ["NEEDS: 1 more Courses | Available: CSE 101, CSE 158"]},
    ]
    issues = planner_agent.check_coverage(audit, [], [place(0, "fall", "CSE 101")])
    assert issues == []


UD_UNITS_AUDIT = [{
    "title": "48 Upper Division Unit Requirement", "status": "not_fulfilled",
    "items": ["NEEDS: 8.00 Units"],
}]


def test_listless_unit_requirement_gets_level_filter():
    reqs = planner_agent._requirements_from_audit(UD_UNITS_AUDIT)
    assert len(reqs) == 1
    assert reqs[0]["need_type"] == "units" and reqs[0]["need_amount"] == 8.0
    assert reqs[0]["candidates"] == [] and reqs[0]["level"] == "upper"


def test_coverage_counts_only_matching_level_units():
    # CSE 21 is lower-division: doesn't count. CSE 101 covers 4 of 8.
    issues = planner_agent.check_coverage(
        UD_UNITS_AUDIT, [], [place(0, "fall", "CSE 21", "CSE 101")])
    assert len(issues) == 1
    assert "still short 4" in issues[0]["message"]
    assert "upper-division" in issues[0]["message"]
    # Two upper-division courses cover it fully.
    issues = planner_agent.check_coverage(
        UD_UNITS_AUDIT, [], [place(0, "fall", "CSE 101", "CSE 158")])
    assert issues == []


def test_unit_requirement_shares_courses_with_list_requirements():
    audit = [
        {"title": "ELECTIVES", "status": "not_fulfilled",
         "items": ["NEEDS: 1 more Courses | Available: CSE 101"]},
        UD_UNITS_AUDIT[0],
    ]
    issues = planner_agent.check_coverage(
        audit, [], [place(0, "fall", "CSE 101", "CSE 158")])
    # CSE 101 fills ELECTIVES and still counts toward the 8 UD units.
    assert issues == []


def test_attribute_fallback_substitutes_only_when_list_is_junk():
    # Junk Available list → substitute the approved CCE sequence.
    junk = [{
        "title": ("Eighth College General Education RequirementsFor a list of "
                  "courses, please go tohttp://eighth.ucsd.edu/academics/"
                  "degree-requirements/first-year.html"),
        "status": "not_fulfilled",
        "subrequirements": [
            {"status": "not_fulfilled", "needType": "courses", "needAmount": 1,
             "availableCodes": ["GO TOHTTP"], "groups": [["GO TOHTTP"]],
             "mode": "all", "title": "Eighth GE"},
        ],
    }]
    reqs = planner_agent._requirements_from_audit(junk)
    assert len(reqs) == 1
    assert "CCE 120" in reqs[0]["candidates"]
    assert "GO TOHTTP" not in reqs[0]["candidates"]

    # Real Available lists (sibling CCE rows) stay authoritative — do NOT
    # widen each row to the whole sequence (that stole CCE 120 from its row).
    real = [{
        "title": junk[0]["title"],
        "status": "not_fulfilled",
        "subrequirements": [
            {"status": "fulfilled", "needType": None, "needAmount": None,
             "availableCodes": [], "groups": [], "mode": "any",
             "title": "Critical Community Engagement 1"},
            {"status": "not_fulfilled", "needType": "courses", "needAmount": 1,
             "availableCodes": ["CCE 3"], "groups": [["CCE 3"]], "mode": "all",
             "title": "Critical Community Engagement 3"},
            {"status": "not_fulfilled", "needType": "courses", "needAmount": 1,
             "availableCodes": ["CCE 120"], "groups": [["CCE 120"]], "mode": "all",
             "title": "Critical Community Engagement 120"},
        ],
    }]
    reqs = planner_agent._requirements_from_audit(real)
    assert [r["candidates"] for r in reqs] == [["CCE 3"], ["CCE 120"]]
    # CCE codes aren't in the fixture catalog, so seed them via the grid
    # (placements only count catalog hits).
    grid = planner_agent.empty_grid()
    grid[0]["winter"][0] = {
        "course_id": "CCE 120", "credits": 4, "status": "planned"
    }
    issues = planner_agent.check_coverage(real, grid, [])
    assert len(issues) == 1
    assert "Critical Community Engagement 3" in issues[0]["message"]
    grid[0]["fall"][0] = {"course_id": "CCE 3", "credits": 4, "status": "planned"}
    assert planner_agent.check_coverage(real, grid, []) == []


def test_get_course_resolves_one_quarter_of_a_sequence():
    # The catalog publishes multi-quarter sequences as one dash-joined entry;
    # audits and students name the individual quarters. 59 catalog entries use
    # this notation and hide 155 real courses behind it.
    assert catalog.get_course("HIST 4A")["course_id"] == "HIST 4A"
    assert catalog.get_course("HIST 4C")["course_id"] == "HIST 4C"
    # The sequence itself still resolves to itself.
    assert catalog.get_course("HIST 4A-B-C")["course_id"] == "HIST 4A-B-C"


def test_sequence_member_takes_its_own_quarter_credits():
    # "4-4-4" is per quarter and in order, NOT a 12-unit total. Reading it
    # whole would make one quarter of HIST 4 worth 12 units; Number("4-4-4")
    # on the client would make it worth 0.
    assert catalog.get_course("HIST 4B")["credits"] == "4"
    assert planner_agent.parse_credits(
        catalog.get_course("HIST 4B")["credits"]) == 4.0
    # A single value applies to every quarter.
    assert catalog.get_course("HIST 9B")["credits"] == "4"
    # Variable-unit sequences are handed back untouched rather than guessed.
    assert catalog.get_course("HIST 7B")["credits"] == "0-4/0-4/0-4"


def test_get_course_resolves_remote_and_global_seminar_variants():
    # The audit prints the variant the student took ("SIO  20R"); the General
    # Catalog lists only the base course. Without the fallback these codes
    # resolved nowhere, so a completed Arts course went unrecognized and
    # ProposeSchedule rejected the code as nonexistent.
    assert catalog.get_course("SIO 20R")["course_id"] == "SIO 20"
    assert catalog.get_course("SIO  20R")["course_id"] == "SIO 20"  # padded
    assert catalog.get_course("SIO 20GS")["course_id"] == "SIO 20"


def test_section_variant_fallback_never_shadows_a_real_course():
    # Only R and GS are variant markers. A trailing letter is normally part of
    # the number ("DSC 140A", "MATH 20B"), and stripping it would let one
    # course answer to a different one.
    assert catalog.get_course("SIO 20A") is None
    assert catalog.get_course("MUS 1A")["course_id"] == "MUS 1A"
    # A variant the catalog DOES list keeps its own entry, and the base it
    # implies resolves back to it rather than to nothing.
    assert catalog.get_course("SIO 109R")["course_id"] == "SIO 109R"
    assert catalog.get_course("SIO 109")["course_id"] == "SIO 109R"


def test_coverage_matches_audit_section_variant_against_base_course():
    audit = [{
        "title": "BREADTH", "status": "not_fulfilled",
        "items": ["NEEDS: 1 more Courses | Available: SIO 20R"],
    }]
    grid = planner_agent.empty_grid()
    grid[2]["fall"][0] = {"course_id": "SIO 20", "credits": 4, "status": "planned"}
    assert planner_agent.check_coverage(audit, grid, []) == []


def test_coverage_ignores_graded_grid_courses_without_status():
    # Restored sessions and search-dropped cards carry a grade and no status.
    # The sidebar reads the grade and calls the course completed (see
    # "graded grid courses without status are not treated as planned" in
    # auditProgress.test.mjs); counting it as planned here made the agent
    # report a requirement covered that the sidebar still showed open.
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {"course_id": "CSE 101", "credits": 4, "grade": "A-"}
    issues = planner_agent.check_coverage(AUDIT_WITH_NEEDS, grid, [])
    assert "still short 2" in issues[0]["message"]


def test_coverage_counts_wip_graded_courses_as_in_progress_not_planned():
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {"course_id": "CSE 101", "credits": 4, "grade": "WIP"}
    issues = planner_agent.check_coverage(AUDIT_WITH_NEEDS, grid, [])
    assert "still short 2" in issues[0]["message"]


def test_coverage_takes_best_status_for_a_repeated_course():
    # Same course in the grid twice: completed wins over planned, so it is not
    # available to cover a requirement. Mirrors coursesByBestStatus.
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {"course_id": "CSE 101", "credits": 4, "status": "completed"}
    grid[2]["winter"][0] = {"course_id": "CSE 101", "credits": 4, "status": "planned"}
    issues = planner_agent.check_coverage(AUDIT_WITH_NEEDS, grid, [])
    assert "still short 2" in issues[0]["message"]


def test_coverage_orphan_available_line_is_a_pick_one_requirement():
    # Legacy saved audits split NEEDS and Available across items and sometimes
    # lost the NEEDS. auditProgress.js treats the orphan as "pick 1"; dropping
    # it here let the agent call a plan complete that the sidebar showed short.
    audit = [{
        "title": "BREADTH", "status": "not_fulfilled",
        "items": ["Available: CSE 101, CSE 158"],
    }]
    issues = planner_agent.check_coverage(audit, [], [])
    assert len(issues) == 1 and "still short 1" in issues[0]["message"]
    assert planner_agent.check_coverage(
        audit, [], [place(0, "fall", "CSE 101")]) == []


def test_coverage_skips_rows_that_state_no_needs():
    # A subrequirement with no NEEDS carries no requirement. Synthesizing
    # "1 course" for it is what let the attribute fallback hand an
    # informational row the entire approved CCE list.
    audit = [{
        "title": "Eighth College General Education Requirements",
        "status": "not_fulfilled",
        "items": [],
        "subrequirements": [
            {"title": "Informational", "status": "unknown", "needType": None,
             "needAmount": None, "groups": [], "availableCodes": []},
        ],
    }]
    assert planner_agent.check_coverage(audit, [], []) == []


AUDIT_NAMING_UNCATALOGED = [{
    "title": "MAJOR ELECTIVES", "status": "not_fulfilled",
    "items": ["NEEDS: 1.0 more Courses | Available: CSE 101, XYZ 152"],
}]


def test_audit_vouched_course_is_placed_unverified_not_rejected():
    # DSC 152 was taught in SP26 and offered as a Core alternative while never
    # appearing in the General Catalog. Rejecting it as nonexistent stopped
    # students planning a course they could actually enrol in.
    codes = planner_agent._codes_named_by_audit(AUDIT_NAMING_UNCATALOGED)
    assert "XYZ 152" in codes
    result = check_placements([], [place(0, "fall", "XYZ 152")], today=TODAY,
                              audit_codes=codes)
    assert [i["severity"] for i in result["issues"]] == ["warning"]
    assert "isn't in the course catalog" in result["issues"][0]["message"]
    placed = result["valid"][0]["courses"][0]
    assert placed["course_id"] == "XYZ 152"
    assert placed["unverified"] is True
    # None, not 0 — the unit total must be able to say "unknown".
    assert placed["credits"] is None


def test_unvouched_unknown_course_is_still_rejected():
    result = check_placements([], [place(0, "fall", "XYZ 999")], today=TODAY,
                              audit_codes=planner_agent._codes_named_by_audit(
                                  AUDIT_NAMING_UNCATALOGED))
    assert [i["severity"] for i in result["issues"]] == ["error"]
    assert "not found in the course catalog" in result["issues"][0]["message"]
    assert result["valid"] == []


def test_audit_credit_placeholders_do_not_vouch_for_anything():
    # "AP **3" / "IB MU5" are credit placeholders, not courses.
    audit = [{"title": "ELECTIVES", "status": "not_fulfilled",
              "items": ["NEEDS: 1.0 more Courses | Available: AP **3, IB MU5"]}]
    assert planner_agent._codes_named_by_audit(audit) == set()


def test_unverified_course_shows_unknown_units_in_the_summary():
    result = check_placements([], [place(0, "fall", "XYZ 152")], today=TODAY,
                              audit_codes=planner_agent._codes_named_by_audit(
                                  AUDIT_NAMING_UNCATALOGED))
    _grid, summaries = merge_into_grid([], result["valid"])
    assert summaries[0]["courses"] == ["XYZ 152 (?u)"]


def test_coverage_ignores_placements_validation_dropped():
    # CSE 101 lands in a past term, so it never reaches the grid. Projecting it
    # as coverage would tell the student a requirement is met by a course they
    # were never given. CSE 158 still places (prereq already completed).
    proposal = ProposeSchedule(
        placements=[place(0, "fall", "CSE 101"), place(1, "fall", "CSE 158")],
        explanation="")
    out = planner_agent._accept(proposal, [], {"CSE 100"}, date(2025, 7, 1),
                                audit_sections=AUDIT_WITH_NEEDS)
    assert planner_agent._grid_course_ids(out["proposed_schedule"]) == {"CSE 158"}
    assert any("still short 1" in w for w in out["warnings"])


@pytest.mark.asyncio
async def test_checkplan_reports_coverage_to_model():
    short = placements_args((0, "fall", ["CSE 21"]))
    short["explanation"] = "partial"
    full = {
        "placements": [
            {"year_index": 0, "term": "fall", "course_ids": ["CSE 21"]},
            {"year_index": 0, "term": "winter", "course_ids": ["CSE 100"]},
            {"year_index": 1, "term": "fall", "course_ids": ["CSE 101", "CSE 158"]},
        ],
        "explanation": "electives covered",
    }
    llm = FakeToolLLM([
        # CSE 21 alone leaves MAJOR ELECTIVES short (no prereq ERROR noise).
        tool_msg("CheckPlan", placements_args((0, "fall", ["CSE 21"])), call_id="c0"),
        tool_msg("ProposeSchedule", short, call_id="c1"),
        tool_msg("ProposeSchedule", full, call_id="c2"),
    ])
    out = await plan_chat("plan", AUDIT_WITH_NEEDS, [], llm=llm, today=TODAY)
    check_reply = llm.seen[1][-1].content
    assert "still short" in check_reply
    # First ProposeSchedule on an empty grid must be rejected for coverage.
    reject_reply = llm.seen[2][-1].content
    assert "REJECTED" in reject_reply and "still short" in reject_reply
    ids = planner_agent._grid_course_ids(out["proposed_schedule"])
    assert {"CSE 21", "CSE 100", "CSE 101", "CSE 158"} <= ids
    assert not any("still short" in w for w in out.get("warnings") or [])


@pytest.mark.asyncio
async def test_targeted_add_allows_remaining_coverage_gaps():
    # Non-empty grid + single-course add: other electives may stay unmet.
    grid = planned_grid((0, "fall", "CSE 21"))
    propose = placements_args((0, "winter", ["CSE 100"]))
    propose["explanation"] = "add cse 100"
    llm = FakeToolLLM([tool_msg("ProposeSchedule", propose)])
    out = await plan_chat("add CSE 100", AUDIT_WITH_NEEDS, grid, llm=llm, today=TODAY)
    assert "CSE 100" in planner_agent._grid_course_ids(out["proposed_schedule"])
    assert any("still short" in w for w in out["warnings"])


@pytest.mark.asyncio
async def test_search_tool_round_trip():
    propose = {
        "placements": [
            {"year_index": 0, "term": "fall", "course_ids": ["CSE 21"]},
            {"year_index": 0, "term": "winter", "course_ids": ["CSE 100"]},
            {"year_index": 1, "term": "fall", "course_ids": ["CSE 158"]},
        ],
        "explanation": "ml elective added",
    }
    llm = FakeToolLLM([
        tool_msg("SearchCourses", {"query": "machine learning", "levels": ["upper"]}),
        tool_msg("ProposeSchedule", propose),
    ])
    out = await plan_chat("add an ML elective", [], [], llm=llm, today=TODAY)
    search_reply = llm.seen[1][-1].content
    assert "CSE 158" in search_reply and "unlocks" not in search_reply.split("CSE 158")[0]
    assert planner_agent._grid_course_ids(out["proposed_schedule"]) == {
        "CSE 21", "CSE 100", "CSE 158"
    }


SECTION_OPTIONS_FIXTURE = {
    "year": "2026",
    "term": "fall",
    "termLabel": "Fall 2026",
    "source": "live",
    "live": True,
    "refreshedAt": 1,
    "courses": [
        {
            "courseId": "CSE 100",
            "courseName": "ADS",
            "currentPackageId": "pkg-a",
            "offered": True,
            "packages": [
                {
                    "packageId": "pkg-a",
                    "currentlySelected": True,
                    "status": "open",
                    "seatsAvailable": 5,
                    "seatsTotal": 100,
                    "instructors": ["Gupta"],
                    "primarySectionId": "A00",
                    "primaryComponent": "LE",
                    "meetings": [{
                        "sectionId": "A00",
                        "component": "LE",
                        "days": ["M", "W", "F"],
                        "start": "10:00am",
                        "end": "10:50am",
                    }],
                    "blocks": [
                        {"day": "M", "startMin": 600, "endMin": 650},
                        {"day": "W", "startMin": 600, "endMin": 650},
                        {"day": "F", "startMin": 600, "endMin": 650},
                    ],
                },
                {
                    "packageId": "pkg-b",
                    "currentlySelected": False,
                    "status": "open",
                    "seatsAvailable": 8,
                    "seatsTotal": 100,
                    "instructors": ["Alt"],
                    "primarySectionId": "B00",
                    "primaryComponent": "LE",
                    "meetings": [{
                        "sectionId": "B00",
                        "component": "LE",
                        "days": ["T", "R"],
                        "start": "2:00pm",
                        "end": "3:20pm",
                    }],
                    "blocks": [
                        {"day": "T", "startMin": 840, "endMin": 920},
                        {"day": "R", "startMin": 840, "endMin": 920},
                    ],
                },
            ],
        },
        {
            "courseId": "DSC 80",
            "courseName": "Practice",
            "currentPackageId": None,
            "offered": True,
            "packages": [
                {
                    "packageId": "dsc-a",
                    "currentlySelected": False,
                    "status": "open",
                    "seatsAvailable": 20,
                    "seatsTotal": 80,
                    "instructors": ["Staff"],
                    "primarySectionId": "A00",
                    "primaryComponent": "LE",
                    "meetings": [{
                        "sectionId": "A00",
                        "component": "LE",
                        "days": ["M", "W", "F"],
                        "start": "10:00am",
                        "end": "10:50am",
                    }],
                    "blocks": [
                        {"day": "M", "startMin": 600, "endMin": 650},
                        {"day": "W", "startMin": 600, "endMin": 650},
                        {"day": "F", "startMin": 600, "endMin": 650},
                    ],
                },
                {
                    "packageId": "dsc-b",
                    "currentlySelected": False,
                    "status": "open",
                    "seatsAvailable": 10,
                    "seatsTotal": 80,
                    "instructors": ["Alt"],
                    "primarySectionId": "B00",
                    "primaryComponent": "LE",
                    "meetings": [{
                        "sectionId": "B00",
                        "component": "LE",
                        "days": ["T", "R"],
                        "start": "3:30pm",
                        "end": "4:50pm",
                    }],
                    "blocks": [
                        {"day": "T", "startMin": 930, "endMin": 1010},
                        {"day": "R", "startMin": 930, "endMin": 1010},
                    ],
                },
            ],
        },
    ],
}


@pytest.mark.asyncio
async def test_load_section_options_requests_browser_when_absent():
    goals = "avoid Fridays and keep Gupta if possible"
    llm = FakeToolLLM([
        tool_msg("LoadSectionOptions", {
            "goals": goals,
            "course_ids": ["CSE 100", "DSC 80"],
        }),
    ])
    out = await plan_chat(
        "Fix my conflicts — avoid Fridays and keep Gupta if possible",
        [],
        [],
        llm=llm,
        today=TODAY,
    )
    assert without_loop(out) == {
        "section_options_request": {
            "goals": goals,
            "course_ids": ["CSE 100", "DSC 80"],
        }
    }
    assert out["agent_loop"]["exit"] == "section_options_request"


def test_format_section_options_reports_current_conflicts():
    # Mirror Quarter View: unmarked packages still get a default current pick.
    with_default = {
        **SECTION_OPTIONS_FIXTURE,
        "courses": [
            {
                **SECTION_OPTIONS_FIXTURE["courses"][0],
                "selectionSource": "saved",
                "savedPackageId": "pkg-a",
            },
            {
                **SECTION_OPTIONS_FIXTURE["courses"][1],
                "currentPackageId": "dsc-b",
                "savedPackageId": None,
                "selectionSource": "default",
                "packages": [
                    SECTION_OPTIONS_FIXTURE["courses"][1]["packages"][0],
                    {
                        **SECTION_OPTIONS_FIXTURE["courses"][1]["packages"][1],
                        "currentlySelected": True,
                    },
                ],
            },
        ],
    }
    text = planner_agent._format_section_options(with_default)
    assert "Current selection conflicts: none" in text
    assert "Courses still on a default (unpicked) package: DSC 80" in text

    conflicting = {
        **SECTION_OPTIONS_FIXTURE,
        "courses": [
            {
                **SECTION_OPTIONS_FIXTURE["courses"][0],
                "selectionSource": "saved",
                "savedPackageId": "pkg-a",
            },
            {
                **SECTION_OPTIONS_FIXTURE["courses"][1],
                "currentPackageId": "dsc-a",
                "savedPackageId": None,
                "selectionSource": "default",
                "packages": [
                    {
                        **SECTION_OPTIONS_FIXTURE["courses"][1]["packages"][0],
                        "currentlySelected": True,
                    },
                    SECTION_OPTIONS_FIXTURE["courses"][1]["packages"][1],
                ],
            },
        ],
    }
    conflict_text = planner_agent._format_section_options(conflicting)
    assert "Current selection conflicts: CSE 100 × DSC 80" in conflict_text


@pytest.mark.asyncio
async def test_empty_section_options_does_not_re_request_browser():
    """Browser answered with zero courses — agent should not pause again."""
    llm = FakeToolLLM([
        tool_msg("LoadSectionOptions", {"goals": "check conflicts"}),
        AIMessage(content="Your enrollment quarter has no courses yet."),
    ])
    out = await plan_chat(
        "Do I have any conflicts in my quarter view?",
        [],
        [],
        llm=llm,
        today=TODAY,
        section_options={
            "year": "2026",
            "term": "fall",
            "termLabel": "Fall 2026",
            "live": True,
            "courses": [],
        },
    )
    assert out["content"] == "Your enrollment quarter has no courses yet."
    assert "section_options_request" not in out


@pytest.mark.asyncio
async def test_section_goals_reach_model_unchanged_when_options_loaded():
    goals = "nothing before 10; prefer open seats; change as little as possible"
    llm = FakeToolLLM([
        tool_msg("LoadSectionOptions", {"goals": goals}),
        AIMessage(content="Noted your priorities."),
    ])
    out = await plan_chat(
        goals,
        [],
        [],
        llm=llm,
        today=TODAY,
        section_options=SECTION_OPTIONS_FIXTURE,
    )
    assert out["content"] == "Noted your priorities."
    tool_reply = llm.seen[1][-1].content
    assert goals in tool_reply
    assert "SECTION PACKAGES" in llm.seen[0][0].content or "pkg-a" in tool_reply
    # No fixed ranking schema injected — goals stay plain language.
    assert "weight" not in tool_reply.lower()
    assert "rank_open_seats" not in tool_reply.lower()


def test_check_section_selection_rejects_conflicts_and_bad_ids():
    conflict = planner_agent.check_section_selection(
        SECTION_OPTIONS_FIXTURE,
        [
            {"course_id": "CSE 100", "package_id": "pkg-a"},
            {"course_id": "DSC 80", "package_id": "dsc-a"},
        ],
        require_no_conflicts=True,
    )
    assert conflict["ok"] is False
    assert any("Time conflict" in i["message"] for i in conflict["issues"])

    bad_id = planner_agent.check_section_selection(
        SECTION_OPTIONS_FIXTURE,
        [{"course_id": "CSE 100", "package_id": "nope"}],
        require_no_conflicts=True,
    )
    assert bad_id["ok"] is False
    assert any("not a valid option" in i["message"] for i in bad_id["issues"])


def test_different_priorities_can_yield_different_valid_selections():
    # "keep Gupta" → pkg-a + dsc-b; "avoid mornings" → pkg-b + dsc-b
    keep_gupta = planner_agent.check_section_selection(
        SECTION_OPTIONS_FIXTURE,
        [
            {"course_id": "CSE 100", "package_id": "pkg-a"},
            {"course_id": "DSC 80", "package_id": "dsc-b"},
        ],
    )
    avoid_mornings = planner_agent.check_section_selection(
        SECTION_OPTIONS_FIXTURE,
        [
            {"course_id": "CSE 100", "package_id": "pkg-b"},
            {"course_id": "DSC 80", "package_id": "dsc-b"},
        ],
    )
    assert keep_gupta["ok"] and avoid_mornings["ok"]
    assert {r["packageId"] for r in keep_gupta["resolved"]} == {"pkg-a", "dsc-b"}
    assert {r["packageId"] for r in avoid_mornings["resolved"]} == {"pkg-b", "dsc-b"}


@pytest.mark.asyncio
async def test_propose_section_selection_reaches_response_unchanged():
    llm = FakeToolLLM([
        tool_msg("ProposeSectionSelection", {
            "selections": [
                {"course_id": "CSE 100", "package_id": "pkg-a"},
                {"course_id": "DSC 80", "package_id": "dsc-b"},
            ],
            "explanation": "Kept Gupta and moved DSC later.",
            "require_no_conflicts": True,
        }),
    ])
    out = await plan_chat(
        "fix conflicts but keep Gupta",
        [],
        [],
        llm=llm,
        today=TODAY,
        section_options=SECTION_OPTIONS_FIXTURE,
    )
    assert out["content"] == "Kept Gupta and moved DSC later."
    prop = out["proposed_sections"]
    assert prop["termLabel"] == "Fall 2026"
    assert prop["live"] is True
    assert prop["afterConflicts"] == []
    ids = {s["courseId"]: s["packageId"] for s in prop["selections"]}
    assert ids == {"CSE 100": "pkg-a", "DSC 80": "dsc-b"}
    assert any(s["enrollment"]["packageId"] == "dsc-b" for s in prop["selections"])


def test_student_accepts_conflicts_needs_their_own_words():
    assert planner_agent._student_accepts_conflicts(
        "I accept remaining conflicts if needed") is True
    assert planner_agent._student_accepts_conflicts(
        "overlapping classes are fine, just pick something") is True
    assert planner_agent._student_accepts_conflicts(
        "fix my schedule") is False
    # Consent from an earlier user turn still counts; an assistant turn doesn't.
    assert planner_agent._student_accepts_conflicts(
        "go ahead",
        [{"role": "assistant", "content": "A conflict would be fine, right?"}],
    ) is False
    assert planner_agent._student_accepts_conflicts(
        "go ahead",
        [{"role": "user", "content": "a conflict is ok with me"}],
    ) is True


@pytest.mark.asyncio
async def test_model_cannot_self_authorize_a_conflicting_selection():
    # Same conflicting pair as the test below, but the student never said
    # conflicts were acceptable — require_no_conflicts=false must be ignored.
    llm = FakeToolLLM([
        tool_msg("ProposeSectionSelection", {
            "selections": [
                {"course_id": "CSE 100", "package_id": "pkg-a"},
                {"course_id": "DSC 80", "package_id": "dsc-a"},
            ],
            "explanation": "shipping it anyway",
            "require_no_conflicts": False,
        }),
        AIMessage(content="I couldn't find a conflict-free combination."),
    ])
    out = await plan_chat(
        "rearrange my sections",
        [],
        [],
        llm=llm,
        today=TODAY,
        section_options=SECTION_OPTIONS_FIXTURE,
    )
    reject = llm.seen[1][-1].content
    assert "REJECTED" in reject and "Time conflict" in reject
    assert "require_no_conflicts=false was ignored" in reject
    assert "proposed_sections" not in out


@pytest.mark.asyncio
async def test_check_section_selection_also_ignores_an_unauthorized_relax():
    llm = FakeToolLLM([
        tool_msg("CheckSectionSelection", {
            "selections": [
                {"course_id": "CSE 100", "package_id": "pkg-a"},
                {"course_id": "DSC 80", "package_id": "dsc-a"},
            ],
            "require_no_conflicts": False,
        }),
        AIMessage(content="Those two overlap."),
    ])
    await plan_chat("rearrange my sections", [], [], llm=llm, today=TODAY,
                    section_options=SECTION_OPTIONS_FIXTURE)
    reply = llm.seen[1][-1].content
    assert "ERROR: Time conflict" in reply
    assert "require_no_conflicts=false was ignored" in reply


@pytest.mark.asyncio
async def test_propose_section_selection_rejects_conflicts_then_accepts_best_effort():
    llm = FakeToolLLM([
        tool_msg("ProposeSectionSelection", {
            "selections": [
                {"course_id": "CSE 100", "package_id": "pkg-a"},
                {"course_id": "DSC 80", "package_id": "dsc-a"},
            ],
            "explanation": "trying conflicting",
            "require_no_conflicts": True,
        }, call_id="c1"),
        tool_msg("ProposeSectionSelection", {
            "selections": [
                {"course_id": "CSE 100", "package_id": "pkg-a"},
                {"course_id": "DSC 80", "package_id": "dsc-a"},
            ],
            "explanation": "Best effort with an unresolved conflict.",
            "require_no_conflicts": False,
        }, call_id="c2"),
    ])
    out = await plan_chat(
        "I accept remaining conflicts if needed",
        [],
        [],
        llm=llm,
        today=TODAY,
        section_options=SECTION_OPTIONS_FIXTURE,
    )
    reject = llm.seen[1][-1].content
    assert "REJECTED" in reject
    assert "Time conflict" in reject
    assert out["proposed_sections"]["afterConflicts"]
    assert "Best effort" in out["content"]
