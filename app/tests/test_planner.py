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
]

FIXTURE_PREREQS = {
    "CSE 21": {"requires": [], "confidence": "parsed", "notes": "",
               "unlocks": ["CSE 100"]},
    "CSE 100": {"requires": [["CSE 21"]], "confidence": "parsed", "notes": "",
                "unlocks": ["CSE 101", "CSE 158"]},
    "CSE 101": {"requires": [["CSE 100"]], "confidence": "parsed", "notes": ""},
    "CSE 158": {"requires": [["CSE 100"]], "confidence": "parsed", "notes": ""},
    "DSC 106": {"requires": [["DSC 80/80R"]], "confidence": "parsed", "notes": ""},
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


def test_prereq_unsatisfied_is_warning():
    r = check_placements([], [place(0, "fall", "CSE 100")], today=TODAY)
    assert any("needs CSE 21" in m for m in messages_of(r, "warning"))


def test_prereq_satisfied_by_earlier_placement():
    r = check_placements(
        [], [place(0, "fall", "CSE 21"), place(0, "winter", "CSE 100")], today=TODAY)
    assert messages_of(r, "warning") == []


def test_prereq_not_satisfied_by_same_term():
    r = check_placements([], [place(0, "fall", "CSE 21", "CSE 100")], today=TODAY)
    assert any("needs CSE 21" in m for m in messages_of(r, "warning"))


def test_prereq_satisfied_by_audit_completed():
    r = check_placements([], [place(0, "fall", "CSE 100")],
                         completed_ids={"CSE 21"}, today=TODAY)
    assert messages_of(r, "warning") == []


def test_prereq_satisfied_through_cross_listing_alias():
    # Grid holds "DSC 80"; the prereq graph wants "DSC 80/80R".
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {"course_id": "DSC 80", "course_name": "", "credits": 4}
    r = check_placements(grid, [place(1, "spring", "DSC 106")], today=TODAY)
    assert messages_of(r, "warning") == []


def test_prereq_chain_across_proposal():
    r = check_placements(
        [],
        [place(0, "fall", "CSE 21"), place(0, "winter", "CSE 100"),
         place(1, "fall", "CSE 101")],
        today=TODAY)
    assert messages_of(r) == []


# ---------------------------------------------------------------------------
# merge + build_plan_grid
# ---------------------------------------------------------------------------

def test_merge_skips_errors_places_warnings():
    grid, summaries, warnings = build_plan_grid(
        [], [place(0, "fall", "CSE 100", "FAKE 999")], today=TODAY)
    ids = planner_agent._grid_course_ids(grid)
    assert "CSE 100" in ids and "FAKE 999" not in ids
    assert any("not found" in w for w in warnings)       # the error surfaced
    assert any("needs CSE 21" in w for w in warnings)     # the warning surfaced


def test_merge_keeps_open_slot_and_existing_courses():
    grid = planner_agent.empty_grid()
    grid[0]["fall"][0] = {"course_id": "MUS 1A", "course_name": "", "credits": 4}
    out, summaries, _ = build_plan_grid(grid, [place(0, "fall", "CSE 21")], today=TODAY)
    fall = out[0]["fall"]
    assert [c["course_id"] for c in fall if c] == ["MUS 1A", "CSE 21"]
    assert fall[-1] is None  # always one open slot
    assert summaries[0]["label"] == "Year 1 · Fall"


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


def placements_args(*triples):
    return {"placements": [
        {"year_index": y, "term": t, "course_ids": codes} for y, t, codes in triples
    ]}


@pytest.mark.asyncio
async def test_plain_answer_passthrough():
    llm = FakeToolLLM([AIMessage(content="CSE 100 is offered fall and winter.")])
    out = await plan_chat("when is CSE 100 offered?", [], [], llm=llm, today=TODAY)
    assert out == {"content": "CSE 100 is offered fall and winter."}


@pytest.mark.asyncio
async def test_clean_proposal_accepted():
    args = placements_args((0, "fall", ["CSE 21"]), (0, "winter", ["CSE 100"]))
    args["explanation"] = "CSE 21 first, then CSE 100."
    llm = FakeToolLLM([tool_msg("ProposeSchedule", args)])
    out = await plan_chat("plan my year", [], [], llm=llm, today=TODAY)
    assert out["content"] == "CSE 21 first, then CSE 100."
    assert out["warnings"] == []
    assert planner_agent._grid_course_ids(out["proposed_schedule"]) == {"CSE 21", "CSE 100"}


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


@pytest.mark.asyncio
async def test_invalid_tool_args_bounce_back():
    llm = FakeToolLLM([
        tool_msg("CheckPlan", {"placements": [{"bogus": True}]}),
        AIMessage(content="giving up"),
    ])
    out = await plan_chat("plan", [], [], llm=llm, today=TODAY)
    assert "Invalid arguments" in llm.seen[1][-1].content
    assert out == {"content": "giving up"}


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


def test_immediate_grade_format_excludes_non_passing():
    audit = [{"title": "Major", "status": "fulfilled",
              "items": ["COMPLETE: CSE 21 F, DSC 80 B"]}]
    assert planner_agent._graded_from_audit(audit) == {"DSC 80/80R"}


def test_past_term_placement_does_not_satisfy_prereqs():
    # CSE 21 lands in a past term (dropped) — it must not satisfy CSE 100.
    r = check_placements(
        [], [place(0, "winter", "CSE 21"), place(1, "fall", "CSE 100")],
        today=date(2025, 7, 1))  # earliest = year 1 fall
    assert any("needs CSE 21" in m for m in messages_of(r, "warning"))


def test_rejected_duplicate_does_not_move_prereq_earlier():
    # Grid: CSE 21 in Y2 Winter. Proposal re-places it in Y1 Fall (error) and
    # puts CSE 100 in Y1 Winter — before where CSE 21 REALLY sits.
    grid = planner_agent.empty_grid()
    grid[1]["winter"][0] = {"course_id": "CSE 21", "course_name": "", "credits": 4}
    r = check_placements(
        grid, [place(0, "fall", "CSE 21"), place(0, "winter", "CSE 100")], today=TODAY)
    assert any("already on the planner" in m for m in messages_of(r, "error"))
    assert any("needs CSE 21" in m for m in messages_of(r, "warning"))


def test_term_capitalization_is_normalized():
    r = check_placements([], [TermPlacement(year_index=0, term="Fall",
                                            course_ids=["CSE 21"])], today=TODAY)
    assert messages_of(r, "error") == []
    assert r["valid"][0]["term"] == "fall"


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


def test_coverage_warns_when_short():
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


def test_coverage_no_double_counting_across_requirements():
    audit = [
        {"title": "REQ A", "status": "not_fulfilled",
         "items": ["NEEDS: 1 more Courses | Available: CSE 101"]},
        {"title": "REQ B", "status": "not_fulfilled",
         "items": ["NEEDS: 1 more Courses | Available: CSE 101, CSE 158"]},
    ]
    issues = planner_agent.check_coverage(audit, [], [place(0, "fall", "CSE 101")])
    # CSE 101 fills REQ A; REQ B stays short and suggests CSE 158.
    assert len(issues) == 1
    assert "REQ B" in issues[0]["message"] and "CSE 158" in issues[0]["message"]


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


@pytest.mark.asyncio
async def test_checkplan_reports_coverage_to_model():
    propose = placements_args((0, "fall", ["CSE 101"]))
    propose["explanation"] = "partial"
    llm = FakeToolLLM([
        tool_msg("CheckPlan", placements_args((0, "fall", ["CSE 101"]))),
        tool_msg("ProposeSchedule", propose),
    ])
    out = await plan_chat("plan", AUDIT_WITH_NEEDS, [], llm=llm, today=TODAY)
    check_reply = llm.seen[1][-1].content
    assert "still short 1" in check_reply
    assert any("still short 1" in w for w in out["warnings"])


@pytest.mark.asyncio
async def test_search_tool_round_trip():
    propose = placements_args((0, "fall", ["CSE 158"]))
    propose["explanation"] = "ml elective added"
    llm = FakeToolLLM([
        tool_msg("SearchCourses", {"query": "machine learning", "levels": ["upper"]}),
        tool_msg("ProposeSchedule", propose),
    ])
    out = await plan_chat("add an ML elective", [], [], llm=llm, today=TODAY)
    search_reply = llm.seen[1][-1].content
    assert "CSE 158" in search_reply and "unlocks" not in search_reply.split("CSE 158")[0]
    assert planner_agent._grid_course_ids(out["proposed_schedule"]) == {"CSE 158"}
