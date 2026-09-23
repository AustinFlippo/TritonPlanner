"""MCP server exposing the planner's catalog + validation tools over stdio.

Run with `python3 app/mcp_server.py`; registered for this repo in /.mcp.json,
so Claude Code picks it up automatically. Any MCP client (Claude Desktop, etc.)
can point at the same command.

This wraps the exact executors the in-app planner agent uses — planner_agent's
_run_search / _run_lookup and the CheckPlan validation pipeline — so an MCP
client sees the identical catalog data, prereq groups, and ERROR/WARNING
verdicts as the web assistant, with no OpenAI key and no LLM loop. The two
browser round-trip tools (LookupLiveSections, LoadSectionOptions and the
section-selection pair) are deliberately NOT exposed: they pause the agent so
the student's frontend can answer, which a standalone server cannot do.
upcoming_sections serves the scraped Class Planner snapshot instead; its seat
counts are indicative only (the web app's /next-quarter/seats proxy is the
live path).
"""
import json
from typing import List, Literal, Optional

from pydantic import ValidationError

from catalog import UPCOMING_TERM_PATH
from planner_agent import (
    SearchCourses,
    TermPlacement,
    _format_issues,
    _run_lookup,
    _run_search,
)
from planner_terms import (
    _course_key_aliases,
    _norm_course_key,
    enrollment_term_code,
    next_enrollable_term,
    plan_window,
)
from planner_validation import (
    _codes_named_by_audit,
    _completed_from_grid,
    _graded_from_audit,
    _mentioned_in_audit,
    check_coverage,
    check_placements,
    check_removal_fallout,
    check_removals,
    merge_into_grid,
    remove_from_grid,
)

from mcp.server.mcpserver import MCPServer

server = MCPServer(
    "triton-planner",
    instructions=(
        "UCSD course catalog + degree-plan validation for the Triton planner. "
        "Discover courses with search_courses (never invent a course code), "
        "fetch exact data with lookup_courses, then validate draft placements "
        "with check_plan before presenting a plan. upcoming_sections shows the "
        "scraped next-quarter schedule; its seat counts are indicative, not "
        "live."
    ),
)


@server.tool()
def search_courses(
    query: str,
    departments: Optional[List[str]] = None,
    quarters: Optional[List[str]] = None,
    levels: Optional[List[str]] = None,
    live_only: bool = False,
    limit: int = 10,
) -> str:
    """Search the UCSD catalog by keywords, with optional filters.

    Use this to DISCOVER courses — electives matching an interest ("machine
    learning"), or browsing a department — instead of guessing codes from
    memory. `query` may be empty when filters are set (browses everything
    matching them). departments: codes like ["CSE", "DSC"]; quarters: any of
    "FA"/"WI"/"SP"; levels: any of "lower" (1-99), "upper" (100-199),
    "grad" (200+). Set live_only=true to restrict results to the live Class
    Planner schedule for the upcoming enrollment quarter (required when
    picking courses to actually enroll in next quarter); it is ignored when
    no live snapshot is loaded. limit: 1-25.
    """
    try:
        args = SearchCourses(
            query=query or "", departments=departments, quarters=quarters,
            levels=levels, live_only=live_only, limit=limit)
    except ValidationError as exc:
        return f"ERROR: invalid search arguments — {exc}"
    return _run_search(args)


@server.tool()
def lookup_courses(codes: List[str]) -> str:
    """Look up catalog data for specific UCSD course codes.

    Returns name, credits, quarter offerings, structured prerequisite groups,
    what each course unlocks, professor ratings, and (when a live snapshot
    covers the enrollment quarter) whether it is offered next quarter. Batch
    every code you need into one call, e.g. ["CSE 100", "DSC 80"]. A code the
    catalog cannot resolve is reported as NOT FOUND — do not place it.
    """
    return _run_lookup([str(c) for c in (codes or [])])


@server.tool()
def check_plan(
    placements: List[dict],
    remove_course_ids: Optional[List[str]] = None,
    schedule: Optional[List[dict]] = None,
    audit_sections: Optional[List[dict]] = None,
    scope: Literal["multi_quarter", "next_quarter"] = "multi_quarter",
) -> str:
    """Validate draft course placements — the same deterministic check the
    in-app planner agent runs before any schedule is accepted.

    placements: [{"year_index": 0-3, "term": "fall"|"winter"|"spring",
    "course_ids": ["CSE 100", ...]}, ...]. year_index 0 is the first academic
    year of the grid. Returns ERROR lines (nonexistent course, duplicate,
    past term, already completed, not on the live schedule for the enrollment
    quarter) and WARNING lines (offerings mismatch, unsatisfied prerequisite,
    overload, audit coverage still short) — or "No issues found." The first
    line of the response states which calendar year year_index 0 maps to and
    the earliest term still plannable — read it before retrying a "past term"
    error.

    schedule (optional): the student's current planner grid, a list of year
    objects {"fall": [card...], "winter": [...], "spring": [...]} where each
    card has at least {"course_id": "CSE 100"}; omit to validate against an
    empty grid. remove_course_ids clears those courses from the grid before
    validating, so a course can be moved without a duplicate error.
    audit_sections (optional): the parsed degree-audit sections from the web
    app — when present, completed courses block re-placement and satisfy
    prerequisites, and multi_quarter scope also reports requirements the plan
    leaves short. scope "next_quarter" skips that coverage report.
    """
    try:
        tps = [TermPlacement(**p) for p in (placements or [])]
    except (ValidationError, TypeError) as exc:
        return (
            "ERROR: invalid placements — each entry needs year_index (0-3), "
            f"term (fall/winter/spring), and course_ids. Details: {exc}"
        )
    audit_sections = audit_sections or []
    schedule = schedule or []
    audit_completed = _graded_from_audit(audit_sections)
    completed_ids = audit_completed | _completed_from_grid(schedule)
    # Same fallback as plan_chat: an audit whose grades didn't parse lets
    # every mention satisfy prereqs rather than nagging falsely.
    satisfied_ids = (
        _mentioned_in_audit(audit_sections) if not audit_completed else set()
    )
    audit_codes = _codes_named_by_audit(audit_sections)

    removals = check_removals(
        schedule, remove_course_ids or [], completed_ids)
    working, _removed = remove_from_grid(schedule, removals["allowed"])
    result = check_placements(
        working, tps, completed_ids, None, satisfied_ids, None, audit_codes,
        None)
    merged, _spilled = merge_into_grid(working, result["valid"])
    coverage = (
        [] if scope == "next_quarter" or not audit_sections
        else check_coverage(audit_sections, merged, [])
    )
    fallout = check_removal_fallout(
        merged, removals["allowed"], completed_ids, satisfied_ids)
    base, _year_count = plan_window(None, None)
    enroll_yi, enroll_term = next_enrollable_term()
    header = (
        f"[grid: year_index 0 = fall 20{base}; earliest plannable term is "
        f"year_index {enroll_yi} {enroll_term} "
        f"({enrollment_term_code()})]"
    )
    return header + "\n" + _format_issues(
        removals["issues"] + result["issues"] + coverage + fallout)


MAX_SECTION_CODES = 24  # matches the /next-quarter/seats proxy cap


@server.tool()
def upcoming_sections(codes: List[str]) -> str:
    """List next quarter's scraped sections (instructors, meeting times, seat
    counts) for specific course codes, up to 24 per call.

    Data comes from the periodic Class Planner scrape, so seat counts are
    INDICATIVE of demand, not live — say so if a course looks nearly full. A
    course with no rows is not on the upcoming-term schedule at all.
    """
    # catalog.load_upcoming_term() summarizes the snapshot down to seat
    # statuses; the section rows live only in the raw scrape file.
    try:
        snap = json.loads(UPCOMING_TERM_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        snap = None
    if (not isinstance(snap, dict)
            or not isinstance(snap.get("courses"), dict)
            or not snap.get("term_code")):
        return ("No upcoming-term snapshot is available — the schedule feed "
                "has not been scraped. Fall back to lookup_courses' "
                "historical quarter offerings.")
    by_key = {}
    for course_id, sections in snap["courses"].items():
        by_key.setdefault(_norm_course_key(course_id), (course_id, sections))
    lines = [
        f"{snap['term_code']} sections (scraped {snap.get('scraped_at', '?')}; "
        "seat counts indicative, not live):"
    ]
    for raw in (codes or [])[:MAX_SECTION_CODES]:
        code = str(raw or "").strip().upper()
        keys = _course_key_aliases(code) or {_norm_course_key(code)}
        keys.discard("")
        hit = next((by_key[k] for k in keys if k in by_key), None)
        if not hit:
            lines.append(f"{code}: not on the {snap['term_code']} schedule.")
            continue
        course_id, sections = hit
        lines.append(f"{course_id}:")
        for s in sections:
            days = "".join(s.get("days") or []) or "TBA"
            time = (f"{s.get('start')}-{s.get('end')}"
                    if s.get("start") and s.get("end") else "TBA")
            seats = (f"{s.get('seatsAvailable', '?')}/{s.get('seatsTotal', '?')} "
                     f"open ({s.get('status', '?')}"
                     + (f", waitlist {s['waitlisted']}"
                        if s.get("waitlisted") else "")
                     + ")")
            lines.append(
                f"  {s.get('sectionId', '?')} {s.get('componentName') or s.get('component') or ''}"
                f" — {days} {time} — {s.get('instructor') or 'staff'} — {seats}"
            )
    if len(codes or []) > MAX_SECTION_CODES:
        lines.append(f"({len(codes) - MAX_SECTION_CODES} more codes not "
                     "shown — call again with the rest.)")
    return "\n".join(lines)


if __name__ == "__main__":
    server.run(transport="stdio")
