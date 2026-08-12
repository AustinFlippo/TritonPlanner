"""v1 chat planner: an agentic tool loop.

The LLM plans against eight tools:
  - SearchCourses: ranked keyword/filter search over the full catalog, for
    discovering courses (electives by interest) instead of recalling codes
  - LookupCourses: real catalog entries (offerings, credits, structured prereqs)
    for any course codes, or "not found"
  - LookupLiveSections: browser-assisted live seat/section lookup (Class
    Planner proxy; TSS extension only as fallback)
  - LoadSectionOptions: browser-assisted enrollable packages for the
    enrollment quarter (agent chooses packages from user priorities)
  - CheckSectionSelection / ProposeSectionSelection: validate and commit
    section-package picks (rejected while errors remain)
  - CheckPlan: the same deterministic validation that used to run post-hoc,
    returned to the model so it can fix problems before the student sees them
  - ProposeSchedule: the final commit — rejected back to the model while
    error-level issues remain. placements only add; remove_course_ids drops
    or frees courses already on the grid so they can be moved

The loop is capped at MAX_LLM_CALLS. Whatever the model proposes is ALSO
validated server-side at commit (never trust that the agent checked): errors
drop the offending course, warnings surface to the student.

Validation severity:
  error   — course doesn't exist, duplicate placement, term in the past,
            placement outside the 4-year grid, unsatisfied prerequisites
            (unless prereq-graph confidence is "partial"), (when a live Class
            Planner snapshot covers the enrollment quarter) a course absent
            from that snapshot placed into the enrollment quarter, or a
            REMOVAL of a course the degree audit shows as completed (see
            check_removals — refused, because it is silent, irreversible
            through the agent, and deletes the student's record of passed
            coursework)
  warning — historical catalog offerings mismatch, partial-confidence prereq
            hedges, prereqs a removal broke for courses still on the grid,
            audit coverage shortfalls (blocking on first/full-plan proposes —
            see ProposeSchedule), and a quarter loaded past MAX_TERM_UNITS.

Corequisites are NOT prerequisites: the prereq graph's meta.concurrent_allowed
lists courses UCSD lets a student take in the SAME quarter (ECE 65 with ECE
100), so those are satisfied by position <= the dependent course's term rather
than strictly before it.

Only OPENAI_API_KEY is required for this path — no Pinecone.
"""
import os
import re
from collections import Counter
from copy import deepcopy
from datetime import date
from typing import List, Optional

from pydantic import BaseModel, Field, ValidationError, field_validator

from audit_requirements import (
    assign_section_courses,
    evaluate_subrequirement,
    requirement_mode,
)
from catalog import (
    aliases_for,
    get_course,
    get_prereq_entry,
    extract_course_codes,
    iter_course_codes,
    is_offered_in_upcoming_term,
    level_of,
    load_upcoming_term,
    search_courses,
)
from planner_metrics import record_loop_turn

TERMS = ["fall", "winter", "spring"]
TERM_CODES = {"fall": "FA", "winter": "WI", "spring": "SP"}
TERM_LABELS = {"fall": "Fall", "winter": "Winter", "spring": "Spring"}
# Launch anchor: year_index 0 was 2024-2025. Slides forward once the next
# enrollable term would otherwise fall past year_index 3 (see grid_base_year).
_LAUNCH_BASE_YEAR = 24
# Budget for the prompt's COURSE CATALOG DATA block, split in two. "Seeds" are
# the courses the audit, the message and the grid name; the rest of the budget
# is reserved for the transitive prereq CLOSURE of those seeds. Counting both
# against one cap starved the closure to nothing on realistic audits — the Arts
# requirement alone lists 81 "Available:" slots, so a 130-code audit filled all
# 120 entries with seeds and emitted ZERO prereq chains, for exactly the
# students whose plans depend on them most.
MAX_CANDIDATES = 120
MAX_SEED_CANDIDATES = 90
# UCSD's per-quarter unit ceiling without an approved overload. Warning-level:
# students do petition past it, but nothing at all used to check, so a 40-unit
# quarter proposed and applied cleanly.
MAX_TERM_UNITS = 19.5
# Grid spans at least 4 years, more for fifth-years; capped so a garbled
# catalog year can't produce hundreds of rows. Mirrors MIN/MAX_PLAN_YEARS in
# mern/client/src/utils/auditCoursePlanner.js.
MIN_PLAN_YEARS = 4
MAX_PLAN_YEARS = 8
# No MAX_AUDIT_CHARS: the audit is sent in full (see _format_audit).
MAX_SEAT_CHARS = 8000
MAX_LLM_CALLS = 12
MAX_HISTORY_MESSAGES = 16
MAX_HISTORY_CHARS = 12000


# ---------------------------------------------------------------------------
# Tool schemas (bound to the LLM; class name == tool name)
# ---------------------------------------------------------------------------

class TermPlacement(BaseModel):
    year_index: int = Field(description="0-3; 0 is the first academic year of the grid")
    term: str = Field(description="One of: fall, winter, spring")
    course_ids: List[str] = Field(description='Course codes to place, e.g. "CSE 100"')

    @field_validator("term")
    @classmethod
    def _lowercase_term(cls, v: str) -> str:
        return (v or "").strip().lower()


class LookupCourses(BaseModel):
    """Look up catalog data (name, credits, quarter offerings, prerequisites)
    for one or more course codes. Batch every code you need into one call.
    Use this before placing any course whose data isn't already in context."""

    codes: List[str] = Field(description='Course codes, e.g. ["CSE 100", "DSC 80"]')


class LookupLiveSections(BaseModel):
    """Fetch current sections, instructors, and seat counts for specific course
    codes via the student's browser (Class Planner live-seat proxy; TSS
    extension only if the proxy fails). Use after discovering courses when they
    are not already listed under LIVE SECTIONS / SEATS. Just call the tool —
    never tell the student you need to refresh TSS or WebReg."""

    codes: List[str] = Field(
        description='Course codes to load live seats for, e.g. ["MGT 167", "MAE 154"]'
    )


class SearchCourses(BaseModel):
    """Search the full UCSD catalog by keywords, with optional filters. Use
    this to DISCOVER courses — electives matching an interest ("machine
    learning"), or browsing a department — instead of guessing codes from
    memory. Empty query + filters browses everything matching the filters."""

    query: str = Field(description="Topic keywords, title words, or an id prefix "
                                   'like "DSC 1"; may be empty when filters are set')
    departments: Optional[List[str]] = Field(
        default=None, description='Department codes, e.g. ["CSE", "DSC"]')
    quarters: Optional[List[str]] = Field(
        default=None, description='Only courses offered in one of: "FA", "WI", "SP"')
    levels: Optional[List[str]] = Field(
        default=None, description='Any of "lower" (1-99), "upper" (100-199), "grad" (200+)')
    limit: int = Field(default=10, ge=1, le=25)


class CheckPlan(BaseModel):
    """Validate draft placements before proposing. Returns ERROR lines (must
    fix: nonexistent course, duplicate, past term, unsatisfied prerequisite)
    and WARNING lines (offerings mismatch, audit coverage still short, overload).

    Fix ERRORS and coverage shortfalls before ProposeSchedule on a first/full
    plan. To move or drop courses already on the planner, list them in
    remove_course_ids — they are cleared from the grid before validation, so
    they can be re-placed in a new term without a duplicate error."""

    placements: List[TermPlacement]
    remove_course_ids: List[str] = Field(
        default_factory=list,
        description='Course codes to remove from the planner before validating '
                    'placements, e.g. ["DSC 100"]. Required when moving a course '
                    'that is already on the grid.',
    )


class ProposeSchedule(BaseModel):
    """Submit the final schedule. Rejected while ERRORs remain, and rejected on
    first/full plans while audit coverage is still short — fix those and
    resubmit. Historical-offerings / overload warnings may remain; mention
    them in the explanation.

    placements alone only ADD courses. To remove or move a course already on
    the planner, put it in remove_course_ids (and, for a move, also place it in
    the new term). A remove-only proposal with empty placements is valid."""

    placements: List[TermPlacement]
    remove_course_ids: List[str] = Field(
        default_factory=list,
        description='Course codes to remove from the planner before applying '
                    'placements, e.g. ["DSC 100"]. Use alone to drop a course, '
                    'or with a new placement to move it.',
    )
    explanation: str = Field(
        description="Short friendly explanation of the plan and key ordering decisions"
    )


class CoursePackagePick(BaseModel):
    course_id: str = Field(description='Course code, e.g. "CSE 100"')
    package_id: str = Field(
        description="Exact packageId from LoadSectionOptions for that course"
    )


class LoadSectionOptions(BaseModel):
    """Ask the student's browser for enrollable section packages for the
    current enrollment quarter (lecture + discussion/lab grouped by packageId).
    Use this when the student wants to rearrange sections, remove time conflicts,
    pick professors/times, or otherwise organize Quarter View sections.

    Pass a short plain-language summary of what they asked for. Do NOT convert
    their preferences into ranked weights — keep their words. After options
    load, choose packageIds yourself, then CheckSectionSelection / ProposeSectionSelection."""

    goals: str = Field(
        description="Plain-language summary of the student's section priorities "
                    "from their message (e.g. no Fridays, keep Gupta, nothing before 10)"
    )
    course_ids: Optional[List[str]] = Field(
        default=None,
        description="Optional subset of course codes to load; omit to load every "
                    "course in the enrollment quarter"
    )


class CheckSectionSelection(BaseModel):
    """Validate a draft section-package selection against the loaded options.
    Returns ERROR lines (invalid package, time conflict when require_no_conflicts)
    and WARNING lines. Fix errors before ProposeSectionSelection."""

    selections: List[CoursePackagePick]
    require_no_conflicts: bool = Field(
        default=True,
        description="When true (default), overlapping meeting times are errors. "
                    "Setting it false is only honored when the STUDENT has said "
                    "they accept conflicts in their own words; otherwise the "
                    "server keeps conflicts as errors and tells you so."
    )


class ProposeSectionSelection(BaseModel):
    """Submit the final section-package selection for the enrollment quarter.
    Rejected while CheckSectionSelection would report errors. The student must
    click Apply in the UI before Quarter View updates."""

    selections: List[CoursePackagePick]
    explanation: str = Field(
        description="Short friendly explanation of the section choices and how "
                    "they match the student's request"
    )
    require_no_conflicts: bool = Field(
        default=True,
        description="Must match the CheckSectionSelection setting used for this "
                    "draft. Only honored as false when the student themselves "
                    "accepted overlapping meeting times — you cannot waive a "
                    "conflict on their behalf."
    )


# ---------------------------------------------------------------------------
# Term / grid helpers
# ---------------------------------------------------------------------------

def grid_base_year(today: Optional[date] = None) -> int:
    """Two-digit Fall year that maps to year_index 0.

    Stays at the 2024 launch anchor while the next enrollable term still fits
    in year_index 0-3. Once FA28+ would land past the grid, re-anchor year 0
    to the current academic year so planning keeps a full 4-year window.
    Mirrored by gridBaseYear in mern/client/src/utils/auditCoursePlanner.js.
    """
    today = today or date.today()
    yy = today.year % 100
    # Winter/Spring YY belong to the academic year that started Fall (YY-1).
    current_fall = yy if today.month >= 7 else yy - 1
    if current_fall - _LAUNCH_BASE_YEAR <= 3:
        return _LAUNCH_BASE_YEAR
    return current_fall


# Back-compat for tests/importers that still read BASE_YEAR as the launch anchor.
BASE_YEAR = _LAUNCH_BASE_YEAR


def plan_window(base_year: Optional[int] = None, today: Optional[date] = None):
    """(base_year, year_count) for the student's grid.

    base_year is the student's catalog year (their matriculation catalog, read
    from the audit header by the client and sent with the request). Falling back
    to grid_base_year keeps the old calendar anchor when no audit is loaded.

    The grid spans at least MIN_PLAN_YEARS and stretches to cover the academic
    year in progress, so a fifth-year student can still be given the quarter
    they are actually enrolling in.
    Mirrors planWindow in mern/client/src/utils/auditCoursePlanner.js.
    """
    today = today or date.today()
    base = base_year if isinstance(base_year, int) else grid_base_year(today)
    yy = today.year % 100
    current_fall = yy if today.month >= 7 else yy - 1
    span = current_fall - base + 1
    return base, max(MIN_PLAN_YEARS, min(MAX_PLAN_YEARS, span))


def next_enrollable_term(today: Optional[date] = None,
                         base_year: Optional[int] = None):
    """Approximate the next term a student can still plan for.
    Jan-Mar -> that year's winter, Apr-Jun -> spring, Jul-Dec -> fall."""
    today = today or date.today()
    yy = today.year % 100
    if today.month <= 3:
        term = "winter"
    elif today.month <= 6:
        term = "spring"
    else:
        term = "fall"
    base, year_count = plan_window(base_year, today)
    year_index = (yy - base) if term == "fall" else (yy - base - 1)
    # Defense in depth: never report an earliest term outside the grid.
    year_index = max(0, min(year_count - 1, year_index))
    return year_index, term


def enrollment_term_code(today: Optional[date] = None,
                         base_year: Optional[int] = None) -> str:
    """UCSD-style term code for next_enrollable_term (e.g. FA26)."""
    today = today or date.today()
    year_index, term = next_enrollable_term(today, base_year)
    base, _ = plan_window(base_year, today)
    yy = base + year_index + (0 if term == "fall" else 1)
    return f"{TERM_CODES[term]}{yy % 100:02d}"


def live_upcoming_for_enrollment(today: Optional[date] = None,
                                 base_year: Optional[int] = None):
    """Class Planner snapshot when it covers the student's enrollment quarter.

    Returns the catalog.load_upcoming_term() dict only when its term_code
    matches enrollment_term_code(...). Wrong-term or missing scrapes return
    None so check_placements falls back to historical offerings only.
    """
    snap = load_upcoming_term()
    if not snap:
        return None
    if snap["term_code"] != enrollment_term_code(today, base_year):
        return None
    return snap


def term_sort_key(year_index: int, term: str) -> int:
    return year_index * 3 + TERMS.index(term)


def parse_credits(raw) -> float:
    if isinstance(raw, (int, float)):
        return float(raw)
    m = re.search(r"\d+(\.\d+)?", str(raw or ""))
    return float(m.group(0)) if m else 0.0


def empty_grid(year_count: int = MIN_PLAN_YEARS):
    return [{t: [None, None, None] for t in TERMS} for _ in range(year_count)]


def _coerce_grid(schedule, year_count: int = MIN_PLAN_YEARS):
    """Grid of at least year_count years. Never truncates a longer incoming
    grid: a fifth-year's saved plan must survive a request that didn't carry
    their base year."""
    grid = deepcopy(schedule) if schedule else empty_grid(year_count)
    while len(grid) < year_count:
        grid.append({t: [None, None, None] for t in TERMS})
    for year in grid:
        for t in TERMS:
            if not isinstance(year.get(t), list):
                year[t] = [None, None, None]
    return grid


def _grid_course_ids(schedule) -> set:
    """Uppercase ids of every card on the grid.

    Whitespace is collapsed the same way every other normalizer in this module
    does it (" ".join(split())), not with a single .replace("  ", " ") — a card
    saved as "DSC   152" survived that replace as "DSC  152", failed to match a
    proposal of "DSC 152", and got placed a second time with no duplicate error.
    """
    ids = set()
    for year in schedule or []:
        for t in TERMS:
            for c in (year or {}).get(t) or []:
                if isinstance(c, dict) and c.get("course_id"):
                    ids.add(" ".join(c["course_id"].upper().split()))
    return ids


def _normalize_term_slots(slots: list) -> list:
    courses = [c for c in slots if isinstance(c, dict)]
    out = list(courses)
    while len(out) < 2:
        out.append(None)
    out.append(None)  # always keep one open slot
    while len(out) < 3:
        out.append(None)
    return out


def _canonical(code: str) -> Optional[str]:
    course = get_course(code)
    return course["course_id"].upper() if course else None


def _grid_positions(grid, satisfied_ids=None) -> dict:
    """Canonical course id -> term sort key, for prereq ordering checks.
    Courses the student already has sit at -1, before every term."""
    position = {cid: -1 for cid in satisfied_ids or ()}
    for yi, year in enumerate(grid):
        for t in TERMS:
            for c in year.get(t) or []:
                if isinstance(c, dict) and c.get("course_id"):
                    cid = (_canonical(c["course_id"]) or c["course_id"].upper())
                    position.setdefault(cid, term_sort_key(yi, t))
    return position


def _concurrent_members(entry) -> set:
    """Canonical ids the prereq graph marks as COREQUISITES for a course.

    build-prereq-graph.mjs has emitted meta.concurrent_allowed since it was
    written, and nothing read it: 71 courses carry the flag and 16 name the
    same course in both `requires` and `concurrent_allowed` (ECE 100 with
    ECE 65, ECE 102 with ECE 100, DOC 1 with AWP 3...). Treating those as
    strict prerequisites told students to push a course back a quarter for a
    constraint UCSD does not impose, and it compounds along coreq chains
    (ECE 65 -> 100 -> 102 -> 187 invented up to three phantom quarters).
    """
    out = set()
    for code in ((entry or {}).get("meta") or {}).get("concurrent_allowed") or []:
        cid = _canonical(code) or " ".join(str(code or "").upper().split())
        if cid:
            out.add(cid)
    return out


def _prereq_groups(course_id: str) -> list:
    """[(member ids, display text, concurrent-ok members)] per OR-group.

    build-prereq-graph.mjs canonicalizes group members, but the graph is a
    build artifact that can lag the catalog, and an unresolved cross-listing
    alias ("POLI 30" where the catalog says "POLI 30/30D") matches nothing —
    warning the student about a prerequisite they already satisfied. So resolve
    again here. A course listed as its own prereq is dropped: nothing can sit
    strictly earlier than itself, so that group could never be satisfied.

    The third element is the subset of the group that may be taken in the SAME
    quarter as the course requiring it (see _concurrent_members).
    """
    entry = get_prereq_entry(course_id) or {}
    concurrent = _concurrent_members(entry)
    groups = []
    for group in entry.get("requires") or []:
        members = {
            cid for cid in (_canonical(m) or str(m or "").strip().upper()
                            for m in group)
            if cid and cid != course_id.upper()
        }
        if members:
            groups.append((members, " or ".join(group), members & concurrent))
    return groups


def _prereq_satisfied(members, concurrent, position, key) -> bool:
    """Is one OR-group satisfied for a course sitting at term sort key `key`?

    A plain prerequisite must sit strictly earlier; a corequisite may sit in
    the same quarter."""
    for member in members:
        if member not in position:
            continue
        at = position[member]
        if at < key or (member in concurrent and at <= key):
            return True
    return False


def _prereq_timing_phrase(members, concurrent) -> str:
    if not concurrent:
        return "in an earlier quarter"
    if concurrent >= members:
        return "in the same quarter or earlier"
    return ("in an earlier quarter (the same quarter is fine for "
            + ", ".join(sorted(concurrent)) + ")")


def _codes_match(course_id: str, code: str) -> bool:
    """Course-code equality for requirement matching, via the catalog so
    cross-listings resolve ("DSC 80/80R" in the audit vs "DSC 80R" planned).
    Falls back to normalized string equality for codes not in the catalog."""
    a = _canonical(course_id) or " ".join(str(course_id or "").upper().split())
    b = _canonical(code) or " ".join(str(code or "").upper().split())
    return a == b


# ---------------------------------------------------------------------------
# Deterministic validation (pure) + merge
# ---------------------------------------------------------------------------

def check_placements(schedule, placements: List[TermPlacement],
                     completed_ids=None, today: Optional[date] = None,
                     satisfied_ids=None, base_year: Optional[int] = None,
                     audit_codes=None) -> dict:
    """Validate placements against the catalog, prereq graph, and current grid.

    Returns {"issues": [...], "valid": [...]}:
      issues — [{severity: "error"|"warning", message: str}], in grid order
      valid  — [{"year_index", "term", "courses": [course_obj, ...]}] containing
               exactly what merge_into_grid should place (warnings still place)

    completed_ids: canonical uppercase ids the student finished (graded in the
    audit) — they satisfy prereqs AND must not be re-placed.
    satisfied_ids: additional ids assumed to satisfy prereqs only (e.g. every
    audit mention, which includes still-needed courses) — placing them is fine.
    audit_codes: codes the degree audit names (see _codes_named_by_audit). One
    that the catalog cannot resolve is placed anyway, as UNVERIFIED with a
    warning and no unit count, rather than rejected as nonexistent — the audit
    is a better authority on what a student may take than a catalog that lags
    behind it. Everything the catalog would have supplied (units, offerings,
    prerequisites) is genuinely unknown for these, so nothing is guessed:
    downstream reads credits=None and says so instead of counting zero.
    """
    completed_ids = {c.upper() for c in (completed_ids or set())}
    audit_codes = {" ".join(str(c).split()).upper() for c in (audit_codes or ())}
    satisfied_ids = {c.upper() for c in (satisfied_ids or set())} | completed_ids
    issues = []
    valid = []
    enroll_yi, enroll_term = next_enrollable_term(today, base_year)
    earliest = term_sort_key(enroll_yi, enroll_term)
    # Live Class Planner allowlist for the enrollment quarter only. None when
    # the scrape is missing, empty, or for a different term — then we never
    # hard-block on "not offered next quarter".
    live_upcoming = live_upcoming_for_enrollment(today, base_year)

    # The grid defines its own length: a fifth-year's saved plan has 5 rows.
    _base, min_years = plan_window(base_year, today)
    grid = _coerce_grid(schedule, min_years)
    year_count = len(grid)
    in_shape = [p for p in placements
                if p.term in TERMS and 0 <= p.year_index < year_count]
    if len(in_shape) < len(placements):
        issues.append({
            "severity": "error",
            "message": f"Ignored {len(placements) - len(in_shape)} placement(s) outside "
                       f"the grid (year_index 0-{year_count - 1}, "
                       "terms fall/winter/spring).",
        })
    ordered = sorted(in_shape, key=lambda p: term_sort_key(p.year_index, p.term))

    # Position of every satisfiable course: completed courses come before
    # everything; grid and proposed courses sit at their term's sort key.
    position = _grid_positions(grid, satisfied_ids)
    for p in ordered:
        key = term_sort_key(p.year_index, p.term)
        if key < earliest:
            continue  # past-term placements are dropped below; they satisfy nothing
        for code in p.course_ids:
            cid = _canonical(code)
            if cid is not None:
                # setdefault: the earliest surviving placement is the one that
                # actually places (later ones error as duplicates), and a
                # doomed re-placement must never pull a grid/completed course
                # to an earlier position than where it really sits.
                position.setdefault(cid, key)

    already_placed = set()
    for cid in _grid_course_ids(grid):
        already_placed.add(_canonical(cid) or cid)

    # Units already booked per term, so an added course is weighed against
    # what the grid already holds and not just against this proposal.
    term_units = {}
    for yi, year in enumerate(grid):
        for t in TERMS:
            term_units[term_sort_key(yi, t)] = sum(
                parse_credits(c.get("credits"))
                for c in year.get(t) or []
                if isinstance(c, dict) and c.get("course_id")
            )

    for p in ordered:
        label = f"Year {p.year_index + 1} {TERM_LABELS[p.term]}"
        key = term_sort_key(p.year_index, p.term)
        if key < earliest:
            issues.append({
                "severity": "error",
                "message": f"{label}: skipped — that term is already in the past.",
            })
            continue

        placed_here = []
        for code in p.course_ids:
            course = get_course(code)
            unverified = False
            if not course:
                tidy = " ".join(str(code or "").split()).upper()
                if tidy not in audit_codes:
                    issues.append({
                        "severity": "error",
                        "message": f"{code}: not found in the course catalog — skipped.",
                    })
                    continue
                # The audit names it, so it exists and counts even though the
                # catalog has no entry. Place it, but claim nothing about it.
                unverified = True
                course = {"course_id": tidy, "course_name": "", "credits": None,
                          "prerequisites": "", "offerings": []}
                issues.append({
                    "severity": "warning",
                    "message": f"{tidy}: your degree audit lists it, but it isn't in "
                               "the course catalog, so its unit count, prerequisites "
                               "and offered quarters could not be checked. Placed as "
                               "unverified — confirm the units with your advisor.",
                })
            cid = course["course_id"].upper()
            if cid in completed_ids:
                issues.append({
                    "severity": "error",
                    "message": f"{course['course_id']}: already completed per the "
                               "degree audit — skipped.",
                })
                continue
            if cid in already_placed:
                issues.append({
                    "severity": "error",
                    "message": f"{course['course_id']}: already on the planner — skipped.",
                })
                continue
            already_placed.add(cid)

            offerings = course.get("offerings") or []
            if offerings and TERM_CODES[p.term] not in offerings:
                issues.append({
                    "severity": "warning",
                    "message": f"{course['course_id']}: catalog says it's usually offered "
                               f"{', '.join(offerings)} — double-check it runs in "
                               f"{TERM_LABELS[p.term]}.",
                })

            # Enrollment quarter + live Class Planner snapshot: absence is an
            # error (skip), not a soft catalog warning. Later quarters still
            # use historical offerings only — we only scrape the next term.
            if (live_upcoming
                    and p.year_index == enroll_yi
                    and p.term == enroll_term
                    and is_offered_in_upcoming_term(course["course_id"]) is False):
                issues.append({
                    "severity": "error",
                    "message": (
                        f"{course['course_id']}: not on the live "
                        f"{live_upcoming['term_code']} Class Planner schedule — "
                        f"skipped for the enrollment quarter. Place it in a later "
                        f"term, or pick a course that is offered {live_upcoming['term_code']}."
                    ),
                })
                already_placed.discard(cid)
                continue

            entry = get_prereq_entry(course["course_id"]) or {}
            partial = entry.get("confidence") == "partial"
            hedge = (" (prereq parsing was partial — verify)" if partial else "")
            prereq_blocked = False
            for members, opts, concurrent in _prereq_groups(course["course_id"]):
                if _prereq_satisfied(members, concurrent, position, key):
                    continue
                when = _prereq_timing_phrase(members, concurrent)
                # Hard-block when we trust the graph: placing CSE 100 without
                # CSE 21 is a real plan bug the agent must fix. Partial parses
                # stay warnings so fuzzy audit text cannot strand a student.
                issues.append({
                    "severity": "warning" if partial else "error",
                    "message": f"{course['course_id']} in {label}: needs {opts} {when} "
                               f"— not found in the audit, grid, or "
                               f"this plan{hedge}.",
                })
                if not partial:
                    prereq_blocked = True
            if prereq_blocked:
                already_placed.discard(cid)
                continue

            # Unverified courses keep credits=None rather than 0: the unit
            # total must be able to say "unknown", not quietly under-count.
            placed_here.append({
                "course_id": course["course_id"],
                "course_name": course.get("course_name", ""),
                "credits": None if unverified else parse_credits(course.get("credits")),
                "status": "planned",
                "prerequisites": course.get("prerequisites", ""),
                "offerings": offerings,
                "unverified": unverified,
            })

        # Nothing used to check unit load at all: the prompt asks for 12-16
        # units a quarter, merge_into_grid appends past the three visible
        # slots, and a 40-unit term proposed and applied without a murmur.
        # Unverified courses carry credits=None (genuinely unknown) and are
        # counted as zero here rather than guessed at.
        loaded = term_units.get(key, 0.0) + sum(
            c["credits"] or 0.0 for c in placed_here)
        if placed_here and loaded > MAX_TERM_UNITS:
            term_units[key] = loaded
            issues.append({
                "severity": "warning",
                "message": f"{label}: {loaded:g} units after this plan — over "
                           f"UCSD's {MAX_TERM_UNITS:g}-unit quarter limit, which "
                           f"needs an approved overload. Move a course to another "
                           f"quarter (aim for 12-16 units).",
            })
        else:
            term_units[key] = loaded

        if placed_here:
            valid.append({"year_index": p.year_index, "term": p.term,
                          "courses": placed_here})

    return {"issues": issues, "valid": valid}


# ---------------------------------------------------------------------------
# Requirement coverage (mirrors mern/client/src/utils/auditProgress.js so the
# agent and the left-sidebar "Graduation Progress" panel agree)
# ---------------------------------------------------------------------------

_NEEDS_RE = re.compile(r"NEEDS:\s*([\d.]+)\s*(?:(?:more\s+)?(course|unit)s?)", re.I)
_AVAILABLE_RE = re.compile(r"Available:\s*(.+)$", re.I)


def _normalize_code(value) -> str:
    """Port of normalizeCode in mern/client/src/utils/auditProgress.js.

    Crucially it INSERTS the missing space in a spaceless token ("DSC100" ->
    "DSC 100"). Normalizing whitespace alone dropped such a token outright and,
    worse, left last_subject unset — so every bare-number continuation after it
    ("DSC100, 102, 106") was dropped too, and Python and JS disagreed about
    what the audit offered.
    """
    s = str(value if value is not None else "").upper().replace("\u00a0", " ")
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"^([A-Z]{2,6})\s*(\d)", r"\1 \2", s)
    return s.strip()


def _code_variants(code) -> set:
    """Every id form a course code answers to: the code as written and its
    catalog entry, each expanded across cross-listing slashes. Port of
    courseIdVariants in mern/client/src/utils/courseIds.js."""
    seed = _normalize_code(code)
    if not seed:
        return set()
    forms = [seed]
    course = get_course(seed)
    if course and course.get("course_id"):
        forms.append(course["course_id"])
    return {_normalize_code(alias)
            for form in forms for alias in aliases_for(form)}


def _parse_available_codes(text: str) -> list:
    """Course codes from an 'Available: ...' clause. Audit lists abbreviate
    ('DSC 100, 102, 106') — bare numbers inherit the previous subject.
    Mirrors parseAvailableCodes in auditProgress.js, including its habit of
    handing back a token it could not classify (callers filter with
    _plausible_code)."""
    m = _AVAILABLE_RE.search(text or "")
    if not m:
        return []
    codes, last_subject = [], ""
    for raw in re.split(r"\s*(?:,|;|\bor\b)\s*", m.group(1), flags=re.I):
        code = _normalize_code(raw)
        if not code:
            continue
        full = re.match(r"^([A-Z]{2,6})\s+(.+)$", code)
        if full:
            last_subject = full.group(1)
            codes.append(code)
        elif last_subject and re.match(r"^\d", code):
            codes.append(f"{last_subject} {code}")
        else:
            codes.append(code)
    return codes


def _level_from_title(title: str) -> Optional[str]:
    """'48 Upper Division Unit Requirement' enumerates no course list — the
    qualifying level is implied by the title. Mirrors auditProgress.js."""
    if re.search(r"upper[\s-]*div", title or "", re.I):
        return "upper"
    if re.search(r"lower[\s-]*div", title or "", re.I):
        return "lower"
    return None


# "Minimum of 48 upper division units in the major" is scoped to the major but
# enumerates no course list, so a level-only filter counted any upper-division
# course and let a plan padded with unrelated electives project it satisfied.
_IN_THE_MAJOR_RE = re.compile(r"\bin the major\b", re.I)


def _major_course_codes(audit_sections) -> Optional[set]:
    """Canonical ids of every course the audit names inside the major's own
    requirement rows — the audit's definition of "counts toward the major".

    None when nothing is derivable (every major row already fulfilled, so the
    parser recorded no course lists); callers then fall back to the level-only
    filter rather than counting nothing. Mirrors majorCourseCodes in
    mern/client/src/utils/auditProgress.js.

    Codes are kept as ALIAS SETS, not round-tripped through the catalog and
    dropped when it has never heard of them. The JS keeps them, so the two
    sides disagreed the moment an audit named an uncataloged major course
    (DSC 152) — and when every code in the major rows was uncataloged, the old
    `codes or None` handed callers None and switched the major filter off
    entirely, counting any upper-division elective toward the major."""
    codes = set()
    for s in audit_sections or []:
        if not re.search(r"\bmajor\b", s.get("title") or "", re.I):
            continue
        for sub in s.get("subrequirements") or []:
            for group in sub.get("groups") or []:
                for code in group:
                    codes |= _code_variants(code)
    return codes or None


def _counts_toward_major(course_id, major_codes) -> bool:
    """Port of countsTowardMajor in auditProgress.js: any alias in common."""
    if not major_codes:
        return False
    return bool(_code_variants(course_id) & major_codes)


# Requirements the audit prints with NO Available list — attribute-based
# (JTCCER climate tag) or delegated to an external page (Eighth College GE).
# We substitute the known approved lists so coverage checking works.
# Mirrors mern/client/src/utils/attributeRequirements.js — keep in sync.
# Sources (Aug 2026): https://undergrad.ucsd.edu/academics/jtccer.html,
# https://eighth.ucsd.edu/academics/degree-requirements/first-year.html
_ATTRIBUTE_REQUIREMENTS = [
    (re.compile(r"climate\s*change|teranes|jtccer", re.I), [
        "ASTR 65", "CGS 134", "ECON 131", "ENVR 30", "MCWP 40C", "MMW 15",
        "PHIL 51", "PHYS 12", "POLI 117R", "SIO 3", "SIO 15", "SIO 20R",
        "SIO 30", "SIO 35", "SIO 40", "SIO 102", "SIO 109R", "SYN 2",
        "SYN 150", "USP 171", "ANTH 10", "ANTH 109", "ANTH 111", "HILD 43",
        "PHIL 148",
    ]),
    # CCE 110 is the transfer-track substitute for CCE 1-3; both tracks end in
    # CCE 120. One audit section covers either track, so list them all.
    (re.compile(r"eighth\s*college\s*general\s*education", re.I), [
        "CCE 1", "CCE 2", "CCE 3", "CCE 110", "CCE 120",
    ]),
]


def _attribute_course_list(title: str):
    for title_re, courses in _ATTRIBUTE_REQUIREMENTS:
        if title_re.search(title or ""):
            return list(courses)
    return None


# A token that plausibly names a course ("CCE 3", "DSC 80/80R") rather than
# junk lifted from a "see this website" note ("GO TOHTTP"). Mirrors
# looksLikeCourseCode in mern/client/src/utils/attributeRequirements.js.
_COURSE_CODE_RE = re.compile(r"^[A-Z]{2,6}\s*\d")


def _plausible_code(code) -> bool:
    return bool(_COURSE_CODE_RE.match(str(code or "").strip().upper()))


def _requirements_from_audit(audit_sections) -> list:
    """Unmet requirements: [{title, need_type, need_amount, candidates, level}].
    Prefers the structured subrequirements newer audits carry; falls back to
    parsing 'NEEDS: ... | Available: ...' items for older saved audits.
    A requirement needs either a candidate list or (for units) a level filter
    inferred from the title; anything else isn't checkable and is dropped."""
    requirements = []
    for index, s in enumerate(audit_sections or []):
        title = s.get("title", "Untitled")
        level = _level_from_title(title)
        subs = s.get("subrequirements") or []
        if subs:
            for sub in subs:
                if sub.get("status") == "fulfilled":
                    continue
                # In-progress rows are being satisfied right now by courses the
                # student is enrolled in; the audit closes them when grades
                # post. Treating one as unmet made it claim a SIBLING row's
                # planned course (Eighth GE's CCE 120) and then warn that the
                # sibling was short. Mirrors auditProgress.js.
                if sub.get("status") == "in_progress":
                    continue
                # No NEEDS stated means no requirement to check. The parser
                # only fills needType/needAmount for not_fulfilled rows, so
                # without one there is nothing to satisfy — and synthesizing
                # "1 course" here is what let the attribute fallback below
                # hand an informational row the entire approved list.
                if not sub.get("needType"):
                    continue
                sub_title = (sub.get("title") or "").strip()
                requirements.append({
                    # Prefer the audit subcategory label when present so
                    # coverage warnings say "Arts" not just the parent category.
                    "title": sub_title or title,
                    "need_type": "units" if str(sub.get("needType", "")).lower()
                                            .startswith("unit") else "courses",
                    "need_amount": float(sub.get("needAmount") or 1),
                    "candidates": sub.get("availableCodes") or [],
                    "parsed_groups": sub.get("groups") or None,
                    "level": level,
                    "major_only": bool(
                        _IN_THE_MAJOR_RE.search(f"{sub_title} {title}")),
                    "section": index,
                    "section_title": title,
                })
            continue
        for item in s.get("items") or []:
            if not isinstance(item, str):
                continue
            needs = _NEEDS_RE.search(item)
            candidates = _parse_available_codes(item)
            if not needs and candidates:
                # Older audits split NEEDS and Available into adjacent items.
                prev = requirements[-1] if requirements else None
                if prev is not None and prev["section"] == index \
                        and not prev["candidates"]:
                    prev["candidates"] = candidates
                else:
                    # An orphan "Available:" with no NEEDS to attach to is a
                    # pick-one requirement, same as legacySubrequirements in
                    # auditProgress.js. Dropping it here let the agent call a
                    # plan complete that the sidebar still showed short.
                    requirements.append({
                        "title": title,
                        "need_type": "courses",
                        "need_amount": 1.0,
                        "candidates": candidates,
                        "level": level,
                        "major_only": bool(_IN_THE_MAJOR_RE.search(title or "")),
                        "section": index,
                        "section_title": title,
                    })
                continue
            if needs:
                requirements.append({
                    "title": title,
                    "need_type": "units" if needs.group(2).lower() == "unit"
                                  else "courses",
                    "need_amount": float(needs.group(1)),
                    "candidates": candidates,
                    "level": level,
                    "major_only": bool(_IN_THE_MAJOR_RE.search(title or "")),
                    "section": index,
                    "section_title": title,
                })
    for r in requirements:
        if r["need_type"] == "courses":
            # Attribute sections (JTCCER, Eighth GE) print NO course list, or
            # junk codes parsed from a "see this website" note. Substitute the
            # known approved list ONLY then. When the audit names real courses
            # (Eighth GE's own "CCE 3" / "CCE 120" rows), its list is
            # authoritative — widening it makes one row demand the whole
            # approved sequence and swallow its siblings' courses. Matched on
            # the SECTION title (sub titles like "Critical Community
            # Engagement 3" don't carry the attribute wording); mirrors
            # auditProgress.js.
            fallback = _attribute_course_list(r["section_title"])
            if fallback and not any(_plausible_code(c) for c in r["candidates"]):
                r["candidates"] = fallback
                r["parsed_groups"] = None  # junk groups die with the junk codes
        r.pop("section_title", None)
        # OR-groups are the real structure, used as-is with their derived mode.
        # Audits parsed before groups existed (saved sessions) only have a flat
        # list, whose slot structure cannot be recovered — one group per code
        # reproduces the old pick-any-N result.
        parsed_groups = r.pop("parsed_groups", None)
        if parsed_groups:
            r["groups"] = parsed_groups
            r["mode"] = requirement_mode(parsed_groups, r["need_type"],
                                         r["need_amount"])
        else:
            r["groups"] = [[c] for c in r["candidates"]]
            r["mode"] = "any"
    return [r for r in requirements
            if r["groups"] or r["need_type"] == "units"]


def _is_wip_grade(grade) -> bool:
    g = str(grade if grade is not None else "").strip().lower()
    return not g or g in ("nr", "wip") or "progress" in g


def _infer_course_status(course: dict) -> str:
    """Best-effort status for a grid card. Port of inferStatus in
    mern/client/src/utils/auditProgress.js — keep the two in sync.

    Explicit status wins; otherwise a grade means the course is behind the
    student, not ahead of them. Restored sessions and search-dropped cards
    often carry a grade and no status, and counting those as 'planned' made
    the agent credit them toward requirements the sidebar treated as already
    satisfied."""
    status = str(course.get("status") or "").strip().lower()
    if status == "failed":
        return "failed"
    if status == "completed":
        return "completed"
    if status in ("current", "in_progress"):
        return "current"
    if status == "planned":
        return "planned"
    grade = course.get("grade")
    if grade is not None and str(grade).strip() != "":
        if _is_wip_grade(grade):
            return "current"
        # An F/W/NP/I completes nothing. _graded_from_audit already filters on
        # _COMPLETED_GRADES, so treating any non-WIP grade as 'completed' here
        # made this function disagree with the agent's own completed set — and
        # with the sidebar, which had the same bug.
        return "completed" if str(grade).strip().upper() in _COMPLETED_GRADES \
            else "failed"
    return "planned"


# 'failed' is deliberately absent -> rank 0, so a passing retake outranks the
# failed attempt for the same course code.
_STATUS_RANK = {"completed": 3, "current": 2, "planned": 1}


def _planned_credits_by_id(schedule) -> dict:
    """Canonical id -> credits for grid courses that are merely PLANNED.

    A course sitting in the grid twice takes its best status, so a card
    repeated as both completed and planned counts as completed and drops out
    — matching coursesByBestStatus in auditProgress.js."""
    best = {}  # canonical id -> (rank, credits)
    for year in _coerce_grid(schedule):
        for t in TERMS:
            for c in year.get(t) or []:
                if not isinstance(c, dict) or not c.get("course_id"):
                    continue
                cid = _canonical(c["course_id"]) or c["course_id"].upper()
                rank = _STATUS_RANK[_infer_course_status(c)]
                if cid not in best or rank > best[cid][0]:
                    best[cid] = (rank, parse_credits(c.get("credits")))
    return {cid: credits for cid, (rank, credits) in best.items()
            if rank == _STATUS_RANK["planned"]}


def check_coverage(audit_sections, schedule, placements: List[TermPlacement]) -> list:
    """Warning-level issues for unmet requirements this plan leaves short.
    Counts planned courses only (grid cards that are merely planned — see
    _planned_credits_by_id — plus these placements), like the sidebar's
    projection. Rows the audit already marks fulfilled or in progress need
    nothing from the plan. A course fills at most one requirement
    WITHIN an audit section, but may credit several sections — attribute
    requirements (JTCCER, Eighth GE) overlap other categories by design, and
    the sidebar projects per-section the same way."""
    requirements = _requirements_from_audit(audit_sections)
    if not requirements:
        return []
    major_codes = _major_course_codes(audit_sections)

    planned = _planned_credits_by_id(schedule)  # canonical id -> credits
    year_count = max(len(schedule or []), MIN_PLAN_YEARS)
    for p in placements:
        if p.term not in TERMS or not 0 <= p.year_index < year_count:
            continue
        for code in p.course_ids:
            course = get_course(code)
            if course:
                planned[course["course_id"].upper()] = parse_credits(course.get("credits"))

    issues = []
    # Requirements arrive in document order; regroup them by audit section so
    # one assignment can run across ALL the course rows of a section at once
    # (see assign_section_courses). Deciding row by row let a broad row swallow
    # the only course a narrow sibling could ever accept.
    sections = []
    for req in requirements:
        if not sections or sections[-1][0] != req.get("section"):
            sections.append((req.get("section"), []))
        sections[-1][1].append(req)

    for _section, rows in sections:
        available = [{"course_id": cid, "credits": credits}
                     for cid, credits in planned.items()]
        course_rows = [r for r in rows
                       if r["groups"] and r["need_type"] == "courses"]
        assignments = assign_section_courses(
            [{"groups": r["groups"], "needAmount": r["need_amount"],
              "mode": r.get("mode")} for r in course_rows],
            available,
            _codes_match,
        )
        by_row = {id(r): a for r, a in zip(course_rows, assignments)}
        # A course fills at most one requirement within this section. Unit rows
        # listing courses are pools scored by credits, not slots, so they can't
        # join the matching — they take what the course rows left, in document
        # order.
        assigned = {c["course_id"] for a in assignments
                    for c in a["matched_courses"]}
        for req in rows:
            needed = req["need_amount"]
            if not req["groups"]:
                # List-less unit requirement: any planned course at the title's
                # level counts, with no cross-requirement exclusion — a course
                # legitimately credits both its named requirement and e.g. the
                # 48-upper-division-unit total.
                level = req["level"]
                # Rows scoped "in the major" additionally require the course to
                # be one the audit's own major lists name; with no such lists
                # (all major rows fulfilled) fall back to level-only.
                major_only = req.get("major_only") and major_codes
                progress = sum(
                    credits for cid, credits in planned.items()
                    if (not level or level_of(cid) == level)
                    and (not major_only
                         or _counts_toward_major(cid, major_codes))
                )
                if progress < needed:
                    scope = f"{level}-division " if level else ""
                    if major_only:
                        scope = f"{scope}major "
                    issues.append({
                        "severity": "warning",
                        "message": f"Requirement '{req['title']}': needs "
                                   f"{needed:g} units, this plan covers "
                                   f"{progress:g} — still short "
                                   f"{needed - progress:g}. Add more "
                                   f"{scope}courses (SearchCourses can filter "
                                   f"by level).",
                    })
                continue

            if id(req) in by_row:
                result = by_row[id(req)]
            else:
                # Unit row with a course list: score the leftovers by credits.
                result = evaluate_subrequirement(
                    {
                        "needType": req["need_type"],
                        "needAmount": needed,
                        "groups": req["groups"],
                        "mode": req.get("mode"),
                    },
                    [c for c in available if c["course_id"] not in assigned],
                    _codes_match,
                )
                for course in result["matched_courses"]:
                    assigned.add(course["course_id"])

            if not result["satisfied"]:
                # In "all" mode the open slots ARE the answer: naming the
                # specific unfilled choices beats "still short 2".
                if result["open_groups"]:
                    slots = ["/".join(group)
                             for group in result["open_groups"][:6]]
                    options = f" Still needed: {', '.join(slots)}."
                else:
                    placed = {c["course_id"] for c in result["matched_courses"]}
                    unplaced = [code for group in req["groups"] for code in group
                                if _canonical(code) not in placed][:6]
                    options = (f" Options: {', '.join(unplaced)}."
                               if unplaced else "")
                short = result["needed"] - result["progress"]
                issues.append({
                    "severity": "warning",
                    "message": f"Requirement '{req['title']}': needs "
                               f"{result['needed']:g} {req['need_type']}, this "
                               f"plan covers {result['progress']:g} — still "
                               f"short {short:g}.{options}",
                })
    return issues


def _grid_has_courses(schedule) -> bool:
    for year in schedule or []:
        if not isinstance(year, dict):
            continue
        for term in TERMS:
            if year.get(term):
                return True
    return False


def _is_full_plan_proposal(schedule, proposal: ProposeSchedule) -> bool:
    """First plans and multi-term fills must close audit coverage gaps.

    A targeted "add CSE 158" / single-term tweak may leave other electives
    unmet — those stay advisory. An empty grid, 2+ terms touched, or 4+
    courses in one proposal is treated as a full planning pass.
    """
    if not _grid_has_courses(schedule):
        return True
    n_courses = sum(len(p.course_ids or []) for p in (proposal.placements or []))
    n_terms = sum(1 for p in (proposal.placements or []) if p.course_ids)
    return n_terms >= 2 or n_courses >= 4


def check_removals(schedule, remove_course_ids, completed_ids=None) -> dict:
    """Validate removals BEFORE they touch the grid.

    Returns {"issues": [...], "allowed": [codes safe to remove]}.

    Removing a course the degree audit shows as COMPLETED is an error and is
    refused. remove_from_grid performs no checks of its own (unknown codes are
    ignored by design), and the only other removal check — check_removal_fallout
    — looks solely at broken prereqs, so a proposal of
    remove_course_ids=["CSE 12"] used to empty a completed CSE 12 off the grid
    with warnings == []. It is also unrecoverable through the agent, because
    check_placements errors on any attempt to re-place a completed course. One
    vague "clean up my planner" must not be able to strip passed coursework.
    """
    completed = {c.upper() for c in (completed_ids or set())}
    issues, allowed = [], []
    for code in remove_course_ids or []:
        cid = _canonical(code) or " ".join(str(code or "").upper().split())
        if not cid:
            continue
        if cid in completed:
            issues.append({
                "severity": "error",
                "message": f"{cid}: your degree audit shows it as completed, so "
                           "I won't remove it from the planner — completed "
                           "coursework is your record of what you passed, and "
                           "it can't be put back once dropped.",
            })
            continue
        allowed.append(code)
    return {"issues": issues, "allowed": allowed}


def remove_from_grid(schedule, course_ids):
    """Remove courses from a grid copy (first matching occurrence per code).

    Returns (grid, removed_summaries) where removed_summaries mirrors the
    placement summary shape so the UI can show what left the plan.
    Unknown / not-on-grid codes are ignored (no error) — the model may list
    a course it already moved in a prior turn.

    This function performs NO severity checks by design; run check_removals
    first and pass its "allowed" list, so a completed course is never dropped.
    """
    grid = _coerce_grid(schedule)
    want = []
    seen = set()
    for code in course_ids or []:
        cid = _canonical(code) or " ".join(str(code or "").upper().split())
        if not cid or cid in seen:
            continue
        seen.add(cid)
        want.append(cid)
    if not want:
        return grid, []

    want_set = set(want)
    removed_by_term = {}  # (yi, term) -> [course_id, ...]
    for yi, year in enumerate(grid):
        for t in TERMS:
            kept = []
            for c in year.get(t) or []:
                if not isinstance(c, dict) or not c.get("course_id"):
                    kept.append(c)
                    continue
                cid = (_canonical(c["course_id"]) or c["course_id"].upper())
                if cid in want_set:
                    removed_by_term.setdefault((yi, t), []).append(c["course_id"])
                    want_set.discard(cid)
                else:
                    kept.append(c)
            year[t] = kept
    for year in grid:
        for t in TERMS:
            year[t] = _normalize_term_slots(year[t])

    summaries = []
    for (yi, t), courses in sorted(
        removed_by_term.items(),
        key=lambda item: term_sort_key(item[0][0], item[0][1]),
    ):
        summaries.append({
            "label": f"Removed · Year {yi + 1} · {TERM_LABELS[t]}",
            "courses": list(courses),
        })
    return grid, summaries


def check_removal_fallout(grid, removed_ids, completed_ids=None,
                          satisfied_ids=None) -> list:
    """Warnings for courses left on the grid whose prereqs a removal broke.

    check_placements only validates the courses being placed, so dropping a
    course that a later one depends on used to pass silently. Scoped to groups
    that lost a removed member: prereq gaps the student already had are not
    this edit's doing and stay quiet.

    Run against the FINAL (post-merge) grid, so a move — remove plus re-place —
    reports nothing when the new term still precedes the dependent course.
    """
    removed = set()
    for code in removed_ids or []:
        cid = _canonical(code) or " ".join(str(code or "").upper().split())
        if cid:
            removed.add(cid)
    if not removed:
        return []

    satisfied = ({c.upper() for c in (satisfied_ids or set())}
                 | {c.upper() for c in (completed_ids or set())})
    position = _grid_positions(grid, satisfied)
    issues = []
    for yi, year in enumerate(grid):
        for t in TERMS:
            key = term_sort_key(yi, t)
            for c in year.get(t) or []:
                if not isinstance(c, dict) or not c.get("course_id"):
                    continue
                course = get_course(c["course_id"])
                if not course:
                    continue
                for members, opts, concurrent in _prereq_groups(course["course_id"]):
                    if not members & removed:
                        continue  # this group never depended on what left
                    if _prereq_satisfied(members, concurrent, position, key):
                        continue  # still satisfied another way
                    when = _prereq_timing_phrase(members, concurrent)
                    issues.append({
                        "severity": "warning",
                        "message": f"{course['course_id']} in Year {yi + 1} "
                                   f"{TERM_LABELS[t]} now needs {opts} {when} "
                                   "— removing it left that prerequisite "
                                   "unmet. Re-place it earlier or drop the course "
                                   "that needs it.",
                    })
    return issues


def merge_into_grid(schedule, valid_placements):
    """Write already-validated placements into a copy of the grid.
    Returns (grid, placement_summaries)."""
    grid = _coerce_grid(schedule)
    summaries = []
    for p in valid_placements:
        placed = []
        for course_obj in p["courses"]:
            slots = grid[p["year_index"]][p["term"]]
            for i, slot in enumerate(slots):
                if slot is None:
                    slots[i] = course_obj
                    break
            else:
                slots.append(course_obj)
            credits = course_obj["credits"]
            unit_str = f"{credits:g}u" if credits else "?u"
            placed.append(f"{course_obj['course_id']} ({unit_str})")
        if placed:
            summaries.append({
                "label": f"Year {p['year_index'] + 1} · {TERM_LABELS[p['term']]}",
                "courses": placed,
            })
    for year in grid:
        for t in TERMS:
            year[t] = _normalize_term_slots(year[t])
    return grid, summaries


def build_plan_grid(current_schedule, placements: List[TermPlacement],
                    completed_ids=None, today: Optional[date] = None,
                    satisfied_ids=None, remove_course_ids=None,
                    base_year=None, audit_codes=None):
    """One-shot check + merge (the pre-agent API, kept for the fallback path).
    Returns (grid, placement_summaries, warning_strings)."""
    removals = check_removals(current_schedule, remove_course_ids, completed_ids)
    working, removed = remove_from_grid(current_schedule, removals["allowed"])
    result = check_placements(working, placements, completed_ids, today,
                              satisfied_ids, base_year, audit_codes)
    grid, summaries = merge_into_grid(working, result["valid"])
    fallout = check_removal_fallout(grid, removals["allowed"], completed_ids,
                                    satisfied_ids)
    return (grid, removed + summaries,
            [i["message"]
             for i in removals["issues"] + result["issues"] + fallout])


# ---------------------------------------------------------------------------
# Context formatting
# ---------------------------------------------------------------------------

def _format_audit(audit_sections) -> str:
    """The FULL audit — never truncated.

    Enforcement reads every section (a completed course anywhere in the audit
    blocks re-placement, see _graded_from_audit), so clipping the prompt made
    the model propose courses it had no way of knowing were already done, then
    burn revision attempts on rejections it could not explain. The audit is the
    one input where the model must see exactly what the validator sees.
    """
    parts = []
    for s in audit_sections or []:
        title = s.get("title", "Untitled")
        status = s.get("status", "unknown")
        parts.append(f"## {title} [{status}]")
        for item in s.get("items") or []:
            parts.append(f"- {item}")
    return "\n".join(parts) or "(no degree audit uploaded)"


def _format_schedule(schedule) -> str:
    if not schedule:
        return "(planner grid is empty)"
    lines = []
    for yi, year in enumerate(schedule):
        for t in TERMS:
            ids = [
                c["course_id"]
                for c in ((year or {}).get(t) or [])
                if isinstance(c, dict) and c.get("course_id")
            ]
            if ids:
                lines.append(f"Year {yi + 1} {TERM_LABELS[t]}: {', '.join(ids)}")
    return "\n".join(lines) or "(planner grid is empty)"


def _format_ui_context(ui_context) -> str:
    """Which app tab the student is looking at, plus the enrollment quarter.

    Frontend sends a dict shaped like:
      { view: "planner"|"quarter"|"storage"|"admin",
        enrollment: { label, year_index, term } }
    """
    if not isinstance(ui_context, dict):
        return "(active view unknown for this turn)"

    view = str(ui_context.get("view") or "").strip().lower()
    view_labels = {
        "planner": "Course Planner (4-year grid)",
        "quarter": "Quarter View (enrollment quarter)",
        "storage": "Saved Plans / Storage",
        "admin": "Admin",
    }
    lines = [f"Active view: {view_labels.get(view, view or 'unknown')}"]

    enrollment = ui_context.get("enrollment")
    if isinstance(enrollment, dict):
        label = enrollment.get("label") or "enrollment quarter"
        yi = enrollment.get("year_index")
        term = str(enrollment.get("term") or "").strip().lower()
        if isinstance(yi, int) and term in TERM_LABELS:
            lines.append(
                f"Enrollment quarter: {label} "
                f"(year_index {yi}, {term} — Year {yi + 1} {TERM_LABELS[term]})"
            )
        else:
            lines.append(f"Enrollment quarter: {label}")
    elif view == "quarter":
        lines.append(
            "Enrollment quarter: see SECTION PACKAGES / LIVE SECTIONS below."
        )
    return "\n".join(lines)


def _format_seat_availability(seat_availability) -> str:
    """Compact seat/section block for the system prompt.

    Frontend sends a dict shaped like:
      { termLabel, source, live, refreshedAt, courses: [
          { courseId, offered, sections: [{ sectionId, component, days,
            start, end, instructor, seatsAvailable, seatsTotal, waitlisted,
            status }] } ] }

    `live` means the client refreshed seats this turn (Class Planner
    /next-quarter/seats, or TSS extension fallback). Otherwise rows still
    come from the Class Planner schedule snapshot — usable seat counts, not
    a reason to ask the student for a TSS refresh.
    """
    if not isinstance(seat_availability, dict):
        return (
            "(no seat data attached this turn — call LookupLiveSections for "
            "any course codes you need seats for; the client refreshes "
            "automatically)"
        )
    courses = seat_availability.get("courses") or []
    if not courses:
        return (
            "(no seat data attached this turn — call LookupLiveSections for "
            "any course codes you need seats for; the client refreshes "
            "automatically)"
        )

    term = seat_availability.get("termLabel") or "enrollment quarter"
    source = seat_availability.get("source") or "unknown"
    live = bool(seat_availability.get("live"))
    age = (
        "live seats (Class Planner)"
        if live
        else f"schedule snapshot ({source}) — seats usable this turn"
    )
    lines = [f"Term: {term} · source: {age}"]
    if seat_availability.get("refreshedAt"):
        lines.append(f"Refreshed at (ms epoch): {seat_availability['refreshedAt']}")

    for course in courses:
        if not isinstance(course, dict):
            continue
        cid = course.get("courseId") or "?"
        sections = course.get("sections") or []
        if course.get("offered") is False or not sections:
            lines.append(f"{cid}: not on the {term} schedule (or no section rows)")
            continue
        lines.append(f"{cid}:")
        for s in sections:
            if not isinstance(s, dict):
                continue
            sid = s.get("sectionId") or "?"
            comp = s.get("component") or "?"
            days = "".join(s.get("days") or []) or "?"
            start = s.get("start") or "?"
            end = s.get("end") or "?"
            seats = s.get("seatsAvailable")
            total = s.get("seatsTotal")
            wait = s.get("waitlisted")
            status = s.get("status") or ""
            if isinstance(seats, (int, float)) and isinstance(total, (int, float)):
                seat_bit = f"{int(seats)}/{int(total)} open"
            elif isinstance(seats, (int, float)):
                seat_bit = f"{int(seats)} open"
            else:
                seat_bit = "seats unknown"
            if isinstance(wait, (int, float)) and wait:
                seat_bit += f", {int(wait)} waitlisted"
            if status:
                seat_bit += f" [{status}]"
            instr = s.get("instructor") or ""
            instr_bit = f" · {instr}" if instr else ""
            lines.append(
                f"  - {sid} {comp} {days} {start}-{end}: {seat_bit}{instr_bit}"
            )

    text = "\n".join(lines)
    if len(text) > MAX_SEAT_CHARS:
        text = text[:MAX_SEAT_CHARS] + "\n[... seat data truncated ...]"
    return text


def _norm_course_key(code) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(code or "").upper())


def _course_key_aliases(code) -> set:
    """Every normalized key one course code answers to, via the catalog.

    The two sides of a seat lookup spell the same course differently: the
    client keys off the TSS / Class Planner id, which is never slashed
    ("AAS 10R"), while the agent reads the CATALOG id out of its own prompt
    ("AAS 10/10R") — and 147 catalog entries are slashed. Comparing raw keys
    therefore missed, the server asked the browser for a lookup it had already
    performed, the client computed zero additions and raised "The assistant
    repeated an already completed TSS lookup", and the student saw "Sorry,
    something went wrong. Is the Express server running on port 5050?" with the
    whole turn lost. Expanding both sides through aliases_for collapses the two
    spellings onto the same key.
    """
    tidy = " ".join(str(code or "").split())
    if not tidy:
        return set()
    forms = [tidy]
    course = get_course(tidy)
    if course and course.get("course_id"):
        forms.append(course["course_id"])
    keys = set()
    for form in forms:
        for alias in aliases_for(form):
            key = _norm_course_key(alias)
            if key:
                keys.add(key)
    return keys


def _seat_course_keys(seat_availability) -> set:
    """Normalized course ids already attempted by the browser, plus every
    alias each of them answers to (see _course_key_aliases).

    Courses with zero rows still count as attempted: asking the browser again
    in the same turn cannot manufacture an offering that the schedule feed
    did not return.
    """
    keys = set()
    if not isinstance(seat_availability, dict):
        return keys
    for course in seat_availability.get("courses") or []:
        if not isinstance(course, dict):
            continue
        keys |= _course_key_aliases(course.get("courseId"))
    return keys


def _current_selected_packages(section_options) -> list:
    """[(courseId, package_dict, selectionSource), ...] as drawn on Quarter View."""
    selected = []
    for course in (section_options or {}).get("courses") or []:
        if not isinstance(course, dict):
            continue
        cid = course.get("courseId") or "?"
        pkgs = course.get("packages") or []
        current_id = course.get("currentPackageId")
        pkg = next(
            (
                p for p in pkgs
                if isinstance(p, dict) and (
                    p.get("currentlySelected")
                    or (current_id and p.get("packageId") == current_id)
                )
            ),
            None,
        )
        if pkg:
            source = course.get("selectionSource") or (
                "saved" if course.get("savedPackageId") else "default"
            )
            selected.append((cid, pkg, source))
    return selected


def _format_section_options(section_options) -> str:
    """Human-readable package menu for the system prompt / tool reply."""
    if not isinstance(section_options, dict):
        return (
            "(section packages not loaded — you MUST call LoadSectionOptions "
            "before answering about Quarter View conflicts or sections; "
            "never ask which quarter — Quarter View is always this enrollment quarter)"
        )
    courses = section_options.get("courses") or []
    if not courses:
        return "(no courses in the enrollment quarter)"
    term = section_options.get("termLabel") or "enrollment quarter"
    source = (
        "live seats (Class Planner)"
        if section_options.get("live")
        else (
            f"schedule snapshot ({section_options.get('source') or 'unknown'}) "
            "— seats usable this turn"
        )
    )
    lines = [
        f"Term: {term} · source: {source}",
        "currentPackageId is what Quarter View draws (saved pick, or default "
        "first package when the student has not picked yet).",
    ]
    defaults = []
    for course in courses:
        if not isinstance(course, dict):
            continue
        cid = course.get("courseId") or "?"
        pkgs = course.get("packages") or []
        if not course.get("offered") or not pkgs:
            lines.append(f"{cid}: no enrollable packages with known times")
            continue
        current = course.get("currentPackageId") or "none"
        sel_src = course.get("selectionSource") or (
            "saved" if course.get("savedPackageId") else "default"
        )
        if sel_src == "default":
            defaults.append(cid)
        lines.append(
            f"{cid} (current package: {current} [{sel_src}]):"
        )
        for pkg in pkgs:
            if not isinstance(pkg, dict):
                continue
            pid = pkg.get("packageId") or "?"
            seats = pkg.get("seatsAvailable")
            total = pkg.get("seatsTotal")
            if isinstance(seats, (int, float)) and isinstance(total, (int, float)):
                seat_bit = f"{int(seats)}/{int(total)} open"
            elif isinstance(seats, (int, float)):
                seat_bit = f"{int(seats)} open"
            else:
                seat_bit = "seats unknown"
            status = pkg.get("status") or ""
            if status:
                seat_bit += f" [{status}]"
            instr = ", ".join(pkg.get("instructors") or []) or "instructor TBA"
            mark = " ★current" if pkg.get("currentlySelected") else ""
            meetings = pkg.get("meetings") or []
            meet_bits = []
            for m in meetings:
                if not isinstance(m, dict):
                    continue
                days = "".join(m.get("days") or []) or "?"
                meet_bits.append(
                    f"{m.get('component') or '?'} {m.get('sectionId') or '?'} "
                    f"{days} {m.get('start') or '?'}-{m.get('end') or '?'}"
                )
            meet_txt = "; ".join(meet_bits) or "no meetings"
            lines.append(
                f"  - {pid}{mark}: {seat_bit} · {instr} · {meet_txt}"
            )

    selected = _current_selected_packages(section_options)
    conflicts = []
    for i, (ca, pa, _) in enumerate(selected):
        for cb, pb, _ in selected[i + 1:]:
            if _packages_clash(pa.get("blocks"), pb.get("blocks")):
                conflicts.append(f"{ca} × {cb}")
    if conflicts:
        lines.append("Current selection conflicts: " + "; ".join(conflicts))
        lines.append(
            "These are the same conflicts Quarter View shows — answer conflict "
            "questions from this line."
        )
    else:
        lines.append(
            "Current selection conflicts: none"
            + (
                " (among packages currently drawn on Quarter View)"
                if selected
                else " (no packages on Quarter View yet)"
            )
        )
    if defaults:
        lines.append(
            "Courses still on a default (unpicked) package: " + ", ".join(defaults)
            + " — Quarter View draws the first package until the student picks one."
        )

    text = "\n".join(lines)
    if len(text) > MAX_SEAT_CHARS:
        text = text[:MAX_SEAT_CHARS] + "\n[... section options truncated ...]"
    return text


def _blocks_overlap(a, b) -> bool:
    return (
        a.get("day") == b.get("day")
        and a.get("startMin") < b.get("endMin")
        and b.get("startMin") < a.get("endMin")
    )


def _packages_clash(a_blocks, b_blocks) -> bool:
    for x in a_blocks or []:
        for y in b_blocks or []:
            if _blocks_overlap(x, y):
                return True
    return False


def check_section_selection(section_options, selections,
                            require_no_conflicts: bool = True) -> dict:
    """Deterministic validation of agent-chosen package ids.

    Mirrors mern/client/src/utils/sectionOptimizer.js validateSectionSelection.
    """
    issues = []
    options_by = {}
    for course in (section_options or {}).get("courses") or []:
        if not isinstance(course, dict):
            continue
        key = _norm_course_key(course.get("courseId"))
        if key:
            options_by[key] = course

    resolved = []
    seen = set()
    for raw in selections or []:
        if hasattr(raw, "model_dump"):
            raw = raw.model_dump()
        course_id = str((raw or {}).get("course_id") or (raw or {}).get("courseId") or "").strip()
        package_id = str((raw or {}).get("package_id") or (raw or {}).get("packageId") or "").strip()
        if not course_id or not package_id:
            issues.append({
                "severity": "error",
                "message": "Each selection needs course_id and package_id.",
            })
            continue
        key = _norm_course_key(course_id)
        if key in seen:
            issues.append({
                "severity": "error",
                "message": f"{course_id}: multiple packages selected; pick at most one.",
            })
            continue
        seen.add(key)
        course_opt = options_by.get(key)
        if not course_opt:
            issues.append({
                "severity": "error",
                "message": f"{course_id}: not in the loaded section options for this term.",
            })
            continue
        pkgs = course_opt.get("packages") or []
        if not course_opt.get("offered") or not pkgs:
            issues.append({
                "severity": "error",
                "message": f"{course_id}: no enrollable packages with known meeting times.",
            })
            continue
        pkg = next((p for p in pkgs if isinstance(p, dict)
                    and p.get("packageId") == package_id), None)
        if not pkg:
            issues.append({
                "severity": "error",
                "message": f"{course_id}: package {package_id} is not a valid option.",
            })
            continue
        resolved.append({
            "courseId": course_opt.get("courseId") or course_id,
            "packageId": package_id,
            "pkg": pkg,
            "courseOpt": course_opt,
        })

    conflicts = []
    for i, a in enumerate(resolved):
        for b in resolved[i + 1:]:
            if _packages_clash(a["pkg"].get("blocks"), b["pkg"].get("blocks")):
                pair = f"{a['courseId']} × {b['courseId']}"
                conflicts.append(pair)
                severity = "error" if require_no_conflicts else "warning"
                issues.append({
                    "severity": severity,
                    "message": f"Time conflict: {pair}",
                })

    for course in (section_options or {}).get("courses") or []:
        if not isinstance(course, dict) or not course.get("offered"):
            continue
        key = _norm_course_key(course.get("courseId"))
        if key in seen:
            continue
        issues.append({
            "severity": "warning",
            "message": f"{course.get('courseId')}: no package selected "
                       "(current selection kept if any).",
        })

    return {
        "ok": not any(i["severity"] == "error" for i in issues),
        "issues": issues,
        "conflicts": conflicts,
        "resolved": resolved,
    }


# Overlapping meeting times are the student's problem to accept, not the
# model's. require_no_conflicts is model-supplied, so leaving it authoritative
# let the agent self-authorize a conflicting timetable — the same clashing pair
# validated or not depending on what the model claimed, with neither the prompt
# instruction nor the field docstring enforcing anything.
_CONFLICT_WORD_RE = re.compile(r"conflict|overlap|clash|double[- ]?book", re.I)
_ACCEPT_CONFLICT_RE = re.compile(
    r"\b(ok|okay|fine|accept|acceptable|allow|ignore|tolerate|whatever|willing|"
    r"don'?t mind|do not mind|don'?t care|do not care|doesn'?t matter|"
    r"does not matter|live with)\b", re.I)


def _student_accepts_conflicts(message, history=None) -> bool:
    """True only when the STUDENT said overlapping section times are okay.

    Checked against their own turns (this message and prior user turns) — the
    person who would have to attend both classes is the only one who can waive
    the constraint.
    """
    texts = [str(message or "")]
    for turn in history or []:
        if isinstance(turn, dict) and turn.get("role") == "user":
            texts.append(str(turn.get("content") or ""))
    return any(
        _CONFLICT_WORD_RE.search(t) and _ACCEPT_CONFLICT_RE.search(t)
        for t in texts
    )


_CONFLICT_OVERRIDE_NOTE = (
    "Note: require_no_conflicts=false was ignored — the student has not said "
    "they accept overlapping meeting times. Pick non-conflicting packages, or "
    "ask them first and let them answer."
)


def _effective_require_no_conflicts(requested: bool, student_allows: bool) -> bool:
    """Conflicts stay errors unless the model asked to relax them AND the
    student actually consented."""
    return bool(requested) or not student_allows


def _accept_section_selection(proposal: ProposeSectionSelection,
                              section_options,
                              student_allows_conflicts: bool = False) -> dict:
    require = _effective_require_no_conflicts(
        proposal.require_no_conflicts, student_allows_conflicts)
    result = check_section_selection(
        section_options,
        proposal.selections,
        require_no_conflicts=require,
    )
    if not result["ok"]:
        output = ("REJECTED — fix these errors and call ProposeSectionSelection "
                  "again:\n" + _format_issues(result["issues"]))
        if require and not proposal.require_no_conflicts:
            output += "\n" + _CONFLICT_OVERRIDE_NOTE
        return {"rejected": True, "output": output}

    selections_out = []
    changes = []
    for row in result["resolved"]:
        pkg = row["pkg"]
        course_opt = row["courseOpt"]
        prev = course_opt.get("currentPackageId")
        enrollment = {
            "packageId": pkg.get("packageId"),
            "instructors": list(pkg.get("instructors") or []),
            "primarySectionId": pkg.get("primarySectionId"),
            "primaryComponent": pkg.get("primaryComponent"),
            "meetings": list(pkg.get("meetings") or []),
            "selectedAt": None,
        }
        changed = prev != pkg.get("packageId")
        selections_out.append({
            "courseId": row["courseId"],
            "courseName": course_opt.get("courseName"),
            "packageId": pkg.get("packageId"),
            "previousPackageId": prev,
            "changed": changed,
            "status": pkg.get("status"),
            "seatsAvailable": pkg.get("seatsAvailable"),
            "seatsTotal": pkg.get("seatsTotal"),
            "instructors": list(pkg.get("instructors") or []),
            "primarySectionId": pkg.get("primarySectionId"),
            "primaryComponent": pkg.get("primaryComponent"),
            "meetings": list(pkg.get("meetings") or []),
            "enrollment": enrollment,
        })
        if changed:
            changes.append({
                "courseId": row["courseId"],
                "from": prev,
                "to": pkg.get("packageId"),
            })

    warnings = [i["message"] for i in result["issues"] if i["severity"] == "warning"]
    return {
        "rejected": False,
        "content": proposal.explanation or "Here's a section arrangement.",
        "proposed_sections": {
            "year": (section_options or {}).get("year"),
            "term": (section_options or {}).get("term"),
            "termLabel": (section_options or {}).get("termLabel"),
            "source": (section_options or {}).get("source"),
            "live": bool((section_options or {}).get("live")),
            "refreshedAt": (section_options or {}).get("refreshedAt"),
            "explanation": proposal.explanation or "",
            "afterConflicts": result["conflicts"],
            "changes": changes,
            "selections": selections_out,
        },
        "warnings": warnings,
    }


def _format_course_entry(course, live_upcoming=None) -> str:
    offerings = ", ".join(course.get("offerings") or []) or "unknown"
    entry = get_prereq_entry(course["course_id"])
    if entry and entry.get("requires"):
        # Mark corequisites inline. check_placements accepts these in the SAME
        # quarter, so if the prompt renders them as plain prerequisites the
        # model tells the student "no, take it earlier" about a pairing the
        # validator would have allowed — UCSD lets ECE 65 and ECE 100 run
        # together. The two surfaces have to agree.
        concurrent = _concurrent_members(entry)
        groups = " AND ".join(
            "("
            + " or ".join(
                f"{m} (may be taken concurrently)" if m in concurrent else m
                for m in g
            )
            + ")"
            for g in entry["requires"]
        )
        prereqs = f"{groups} [{entry.get('confidence', 'parsed')}]"
    else:
        prereqs = (course.get("prerequisites") or "None listed")[:300]
    line = (
        f"{course['course_id']} | {course.get('course_name', '')} | "
        f"{course.get('credits', '?')} units | offered: {offerings} | prereqs: {prereqs}"
    )
    # Annotate against the live enrollment-quarter schedule when we have one.
    # "offered:" above is historical catalog seasons only.
    if live_upcoming is None:
        live_upcoming = live_upcoming_for_enrollment()
    if live_upcoming:
        on_live = is_offered_in_upcoming_term(course["course_id"])
        flag = "yes" if on_live else "NO"
        line += f" | {live_upcoming['term_code']} live: {flag}"
    unlocks = (entry or {}).get("unlocks") or []
    if unlocks:
        shown = ", ".join(unlocks[:8]) + (" …" if len(unlocks) > 8 else "")
        line += f" | unlocks: {shown}"
    return line


def _collect_candidates(message, audit_sections, schedule,
                        today: Optional[date] = None,
                        base_year: Optional[int] = None) -> str:
    """Catalog entries for every real course mentioned in the message, the
    current grid, or the audit — PLUS the transitive prereq closure of those
    courses (BFS, nearest first), so the model sees complete prereq chains on
    its first pass instead of discovering them through LookupCourses round-trips.

    Seeds are capped at MAX_SEED_CANDIDATES so the closure always gets a share
    of MAX_CANDIDATES; and they are collected message-first, grid-second so a
    long audit "Available:" pool cannot evict the courses the student is
    actually asking about.
    """
    codes = list(extract_course_codes(message))
    codes.extend(_grid_course_ids(schedule))
    for s in audit_sections or []:
        for item in s.get("items") or []:
            codes.extend(extract_course_codes(item))

    live_upcoming = live_upcoming_for_enrollment(today, base_year)
    seen, seeds = set(), []
    for code in codes:
        if len(seeds) >= MAX_SEED_CANDIDATES:
            break
        course = get_course(code)
        if not course or course["course_id"] in seen:
            continue
        seen.add(course["course_id"])
        seeds.append(course)

    entries = [_format_course_entry(c, live_upcoming=live_upcoming)
               for c in seeds]
    queue = list(seeds)
    while queue and len(entries) < MAX_CANDIDATES:
        course = queue.pop(0)
        for group in (get_prereq_entry(course["course_id"]) or {}).get("requires") or []:
            for member in group:
                prereq = get_course(member)
                if not prereq or prereq["course_id"] in seen:
                    continue
                seen.add(prereq["course_id"])
                queue.append(prereq)
                if len(entries) < MAX_CANDIDATES:
                    entries.append(
                        _format_course_entry(prereq, live_upcoming=live_upcoming))
    return "\n".join(entries) or "(none)"


def _format_live_upcoming(today: Optional[date] = None,
                          base_year: Optional[int] = None) -> str:
    """Prompt block for the Class Planner snapshot covering the enrollment quarter."""
    snap = live_upcoming_for_enrollment(today, base_year)
    if not snap:
        return (
            "No live Class Planner schedule is loaded for the enrollment quarter "
            "(common well before registration). Do NOT invent next-quarter "
            "availability — use historical catalog offerings only, and treat them "
            "as approximate."
        )
    scraped = snap.get("scraped_at") or "unknown time"
    return (
        f"Live Class Planner snapshot for {snap['term_code']} "
        f"({snap['course_count']} courses, scraped {scraped}). "
        f"This is authoritative for what is offered in the enrollment quarter "
        f"(year_index / term of {snap['term_code']}). "
        f"Do NOT place a course into that enrollment quarter unless COURSE "
        f"CATALOG DATA marks it \"{snap['term_code']} live: yes\", or "
        f"LookupCourses / CheckPlan confirms it. Courses marked "
        f"\"{snap['term_code']} live: NO\" will be rejected for that quarter — "
        f"schedule them in a later term instead. Later quarters still use "
        f"historical catalog offerings only."
    )


# Grades that mean "this course is done (or underway) — don't re-place it, and
# it satisfies prereqs". F/NP/W/I don't complete anything; WIP (in progress,
# stamped by the audit parser) and TP (transfer pass) both count.
_COMPLETED_GRADES = {
    "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-",
    "P", "S", "TP", "WIP",
}
# The frontend audit parsers emit completed courses as
# "CSE 21 - Math for Algorithms (FA23, A-)" — grade last inside the trailing
# parenthetical (SidebarAuditTracker.jsx / auditParser.js).
_TRAILING_GRADE_RE = re.compile(r"\(([^,()]*),\s*([A-Z]{1,3}[+-]?)\s*\)\s*$")
# Fallback for plainer formats: a grade token immediately after the code
# ("DSC 10 A-,"). "DSC 80," in a NEEDS list and "CSE 100 or ..." don't match.
_IMMEDIATE_GRADE_RE = re.compile(
    r"^\s*[:\-]?\s*(A\+|A-|B\+|B-|C\+|C-|D\+|D-|WIP|TP|[ABCDPS])(?=[\s,;.)]|$)")


def _graded_from_audit(audit_sections) -> set:
    """Canonical ids of courses the audit shows with a completing grade.
    These must not be re-placed and satisfy prereqs."""
    ids = set()
    for s in audit_sections or []:
        for item in s.get("items") or []:
            upper = item.upper() if item else ""
            codes = iter_course_codes(item)
            if not codes:
                continue
            m = _TRAILING_GRADE_RE.search(upper)
            if m:
                # Completed-course line: the leading code is the course itself
                # (later codes may just appear in the description).
                if m.group(2) in _COMPLETED_GRADES:
                    cid = _canonical(codes[0][0])
                    if cid:
                        ids.add(cid)
                continue
            for code, end in codes:
                gm = _IMMEDIATE_GRADE_RE.match(upper[end:])
                if gm and gm.group(1) in _COMPLETED_GRADES:
                    cid = _canonical(code)
                    if cid:
                        ids.add(cid)
    return ids


def _codes_named_by_audit(audit_sections) -> set:
    """Course codes the audit names, WHETHER OR NOT the catalog knows them.

    Unlike _mentioned_in_audit this deliberately does not round-trip through
    the catalog, because its whole purpose is the codes that fail to. A degree
    audit is an authoritative statement that a course exists and counts toward
    a requirement, and it is routinely ahead of the General Catalog: DSC 152
    was taught in SP26 and offered as a Core alternative while never appearing
    in the catalog at all. Rejecting those as "nonexistent" blocked students
    from planning courses they can actually enrol in, so check_placements
    treats membership here as vouching for a code it cannot otherwise verify.

    Returns normalized uppercase codes, filtered to plausible course codes so
    the audit's AP/IB credit placeholders ("AP **3", "IB MU5") stay out."""
    codes = set()
    for s in audit_sections or []:
        for sub in s.get("subrequirements") or []:
            for group in sub.get("groups") or []:
                codes.update(group)
            codes.update(sub.get("availableCodes") or [])
            for c in sub.get("completedCourses") or []:
                if isinstance(c, dict) and c.get("course_id"):
                    codes.add(c["course_id"])
        for item in s.get("items") or []:
            if isinstance(item, str):
                codes.update(_parse_available_codes(item))
    tidy = {" ".join(str(c).split()).upper() for c in codes if c}
    return {c for c in tidy if _plausible_code(c)}


def _mentioned_in_audit(audit_sections) -> set:
    """Canonical ids of every catalog course the audit mentions, including
    still-needed ones. Only used as a prereq-satisfaction fallback when grade
    parsing found nothing (unfamiliar audit format): better to miss a real
    prereq warning than to nag about courses the student already passed."""
    ids = set()
    for s in audit_sections or []:
        for item in s.get("items") or []:
            for code in extract_course_codes(item):
                cid = _canonical(code)
                if cid:
                    ids.add(cid)
    return ids


# ---------------------------------------------------------------------------
# Tool execution
# ---------------------------------------------------------------------------

def _run_lookup(codes: List[str], today: Optional[date] = None,
                base_year: Optional[int] = None) -> str:
    live_upcoming = live_upcoming_for_enrollment(today, base_year)
    lines = []
    for code in codes[:40]:
        course = get_course(code)
        lines.append(
            _format_course_entry(course, live_upcoming=live_upcoming) if course
            else f"{code}: NOT FOUND in the catalog — do not place it."
        )
    return "\n".join(lines) or "(no codes given)"


def _run_search(args: SearchCourses, today: Optional[date] = None,
                base_year: Optional[int] = None) -> str:
    courses, total = search_courses(
        args.query, levels=args.levels, depts=args.departments,
        quarters=args.quarters, limit=args.limit)
    if not courses:
        return ("No catalog courses matched. Try broader keywords or fewer "
                "filters; never invent a course code.")
    live_upcoming = live_upcoming_for_enrollment(today, base_year)
    lines = [_format_course_entry(c, live_upcoming=live_upcoming) for c in courses]
    if total > len(courses):
        lines.append(f"({total - len(courses)} more matches not shown — "
                     "narrow the query or raise limit.)")
    return "\n".join(lines)


def _format_issues(issues) -> str:
    if not issues:
        return "No issues found. The plan is valid."
    return "\n".join(
        f"{i['severity'].upper()}: {i['message']}" for i in issues
    )


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

SYSTEM_TEMPLATE = """You are the TritonPlanner course assistant for a UC San Diego student.

You can see the student's degree audit, their current 4-year planner grid, \
catalog data (credits, quarter offerings, prerequisites) for relevant courses, \
live seat/section availability (Class Planner), and — when loaded — enrollable \
section packages for the current enrollment quarter.

You have eight tools:
- SearchCourses: keyword/filter search over the full UCSD catalog. Use it whenever \
you need to DISCOVER courses — electives matching the student's interests, or \
anything you'd otherwise recall from memory. Never invent a course code.
- LookupCourses: catalog data for specific course codes. Before placing a course \
whose data is NOT already in the context below, look it up (batch all codes into \
one call). Never place a course you haven't seen catalog data for.
- LookupLiveSections: asks the student's browser to refresh seat/section rows for \
specific course codes (Class Planner live-seat proxy; TSS extension only if that \
fails). When the student asks for current offerings, professors, sections, or seats \
and the relevant courses are not already listed under LIVE SECTIONS / SEATS, call \
this tool after discovering the course codes. Batch all needed codes into one call. \
The client retries the turn automatically — never tell the student you need to \
"refresh TSS", open WebReg, or pull live data yourself. Never claim current \
availability from catalog quarter history alone.
- LoadSectionOptions: asks the browser for enrollable section packages (lecture + \
DI/lab) for courses in the enrollment quarter (Quarter View). Call this whenever \
SECTION PACKAGES says they are not loaded and the student asks about conflicts, \
section times, professors, or rearranging packages. Summarize their priorities in \
plain language — do NOT invent fixed ranking weights. Choose packageIds yourself \
from the returned options.
- CheckSectionSelection: validates a draft package selection (invalid ids, time \
conflicts). Fix ERROR lines before proposing.
- ProposeSectionSelection: submits the final section arrangement. Rejected while \
errors remain. The student must click Apply before Quarter View updates.
- CheckPlan: validates draft course placements on the 4-year grid. Pass \
remove_course_ids when the draft drops or moves courses already on the grid.
- ProposeSchedule: submits the final 4-year course plan. Rejected while ERRORs remain. \
placements only ADD courses — to remove or move a course already on the planner, \
you MUST pass remove_course_ids (and for a move, also place it in the new term). \
A remove-only call with empty placements is valid.

When the student asks you to plan, fill out, generate, edit, move, or remove courses \
on their multi-quarter schedule: draft placements (and remove_course_ids when needed), \
run CheckPlan, fix what it reports, then ProposeSchedule. A planning request MUST end \
with an accepted ProposeSchedule call — never stop at a text explanation. If a course \
can't be placed (not found, already completed), drop it, place the rest, and mention \
the omission in the explanation. Rules:
- The grid has year_index 0-{last_year_index} (0 = {base_label} academic year) and terms fall/winter/spring.
- The earliest term you may place courses into is year_index {earliest_year}, {earliest_term} \
({earliest_code}). Never place courses in earlier terms.
- Do NOT re-place courses the student already completed (they appear in the audit with \
grades). Courses already on the planner grid must be listed in remove_course_ids before \
you can place them again in a different term.
- Transfer and AP credit: the audit posts these as UCSD equivalents with grade TP \
(transfer pass), e.g. "MATH 20A - … (SP22, TP)" or "CSE 8A - … (TP)". Treat TP (and \
WIP / letter grades / P / S) as already completed for prerequisites — do not re-place \
those courses and do not ask the student to take them again. Raw placeholders like \
"AP **3" or "IB MU5" are NOT course codes; only the UCSD equivalent line counts.
- Prioritize unmet requirements (sections marked not_fulfilled, especially NEEDS lines), \
and satisfy prerequisites in an earlier quarter than the course that needs them. \
COREQUISITES are the exception: when CheckPlan says a requirement may be taken in the \
same quarter, do not push it back a term.
- Never put a course the audit shows as COMPLETED into remove_course_ids — that would \
delete the student's record of passed coursework and it will be refused.
- Only schedule a course in quarters it is offered. Historical catalog seasons \
("offered: FA, WI") are approximate. When LIVE NEXT-QUARTER SCHEDULE is loaded, \
it is authoritative for the enrollment quarter — never place a course marked \
"live: NO" into that quarter (CheckPlan / ProposeSchedule will reject it). For the \
enrollment quarter, prefer courses that appear under LIVE SECTIONS / SEATS with open \
seats when students are already signing up; if seats are missing for a candidate, call \
LookupLiveSections before committing that quarter.
- Do NOT ProposeSchedule while CheckPlan still reports ERRORS (including unsatisfied \
prerequisites) or — on a first/full plan — coverage "still short" lines. Place the \
missing prereq earlier, or SearchCourses / add the listed elective options, then \
CheckPlan again. Only leave coverage shortfalls on a targeted single-course add/move \
when the student did not ask for a full plan; say what is still unmet in the explanation.
- When LIVE SECTIONS / SEATS lists a course, answer open/full/waitlisted from that \
data. Snapshot rows and live-refreshed rows are both Class Planner seat counts for \
this turn — do not hedge that you still need a TSS refresh when a course is listed. \
If a course you care about is missing from that block, call LookupLiveSections \
(silent browser refresh) instead of asking the student to refresh anything.
- Aim for 3-4 courses (roughly 12-16 units) per quarter unless asked otherwise. \
A quarter over {max_term_units:g} units exceeds UCSD's limit without an approved \
overload and CheckPlan will warn about it.

Respect ACTIVE UI when interpreting vague schedule language ("my schedule", \
"replace this", "swap", "no seats", "looking at"):
- If Active view is Quarter View: the student is looking at the enrollment quarter \
above (same term as LIVE SECTIONS / SECTION PACKAGES). Course replacements, swaps, \
or seat-driven changes for a course on that quarter MUST stay in that same \
year_index/term unless they explicitly name a different quarter. Use \
ProposeSchedule with remove_course_ids + a placement in the enrollment quarter — \
do NOT move the course to another term just to find an offering.
- If Active view is Course Planner: multi-quarter moves and full-plan edits are \
expected; place courses wherever the plan needs them.
- Storage / Admin: answer questions, but do not assume they are editing a visible \
term unless they say so.

When the student asks about Quarter View, section times, professors, conflicts, or \
rearranging packages:
- "Quarter View" ALWAYS means the enrollment quarter in SECTION PACKAGES / ACTIVE UI. \
Never ask which quarter they mean.
- If SECTION PACKAGES are not loaded, you MUST call LoadSectionOptions immediately. \
Never reply that packages aren't loaded or ask the student to load them.
- For a yes/no conflict check ("do I have conflicts?"), answer from the \
"Current selection conflicts" line after packages are loaded. Only rearrange when \
they ask you to fix/change sections.
- To rearrange SECTION PACKAGES (times/professors): LoadSectionOptions → choose \
packageIds from their stated priorities → CheckSectionSelection → \
ProposeSectionSelection. Never invent packageIds. Never move or remove courses from \
the quarter while only rearranging sections. If no conflict-free combination exists, \
say so and either ask what to compromise or propose with require_no_conflicts=false \
only if they accept conflicts.
- To replace or drop a COURSE while on Quarter View (full / no seats / wrong class): \
use ProposeSchedule (remove_course_ids + same-quarter placement), not \
ProposeSectionSelection.

For any other question, just answer helpfully using the audit, catalog, and seat \
context — no tools needed unless the student asks about a course not shown below. \
Be honest when the context doesn't contain the answer.

=== ACTIVE UI ===
{ui_context}

=== DEGREE AUDIT ===
{audit}

=== CURRENT PLANNER GRID ===
{schedule}

=== LIVE NEXT-QUARTER SCHEDULE ===
{live_upcoming}

=== LIVE SECTIONS / SEATS ===
{seats}

=== SECTION PACKAGES (enrollment quarter) ===
{section_options}

=== COURSE CATALOG DATA ===
{candidates}"""


# ---------------------------------------------------------------------------
# The agent loop
# ---------------------------------------------------------------------------

def _default_llm():
    from langchain_openai import ChatOpenAI

    # Planning is low-volume but reasoning-heavy (prereq ordering across
    # quarters), so it defaults to the GPT-5.6 flagship (Sol). Chat path
    # uses Terra/Luna. GPT-5.6 rejects custom temperature — omit it.
    model = os.getenv("PLANNER_MODEL", "gpt-5.6-sol")
    kwargs = {}
    if model.startswith(("gpt-5", "o")):
        # GPT-5.x on /v1/chat/completions only allows function tools with
        # reasoning_effort "none" (reasoning + tools needs /v1/responses,
        # which this langchain-openai version doesn't drive).
        kwargs["reasoning_effort"] = os.getenv("PLANNER_REASONING_EFFORT", "none")
    return ChatOpenAI(
        model=model,
        openai_api_key=os.getenv("OPENAI_API_KEY"),
        # The loop makes several calls per request, so a TPM blip mid-loop
        # would otherwise kill an almost-finished plan.
        max_retries=6,
        **kwargs,
    ).bind_tools([
        SearchCourses,
        LookupCourses,
        LookupLiveSections,
        LoadSectionOptions,
        CheckSectionSelection,
        ProposeSectionSelection,
        CheckPlan,
        ProposeSchedule,
    ])


def _accept(proposal: ProposeSchedule, schedule, completed_ids, today,
            satisfied_ids=None, extra_warnings=None, audit_sections=None,
            base_year=None, describe_actual=False):
    """Server-side commit: validate once more, merge, and build the response.
    Error-level courses are dropped; all issue messages surface to the student.

    describe_actual: ignore proposal.explanation and describe what was really
    applied. The cap-hit path ships the LAST REJECTED proposal, whose prose
    names courses check_placements is about to drop — the student read "I've
    put you in CSE 21 and DSC 152 for Fall" while only CSE 21 reached the grid.
    """
    removals = check_removals(schedule, proposal.remove_course_ids, completed_ids)
    working, removed = remove_from_grid(schedule, removals["allowed"])
    result = check_placements(working, proposal.placements, completed_ids, today,
                              satisfied_ids, base_year,
                              _codes_named_by_audit(audit_sections))
    grid, summaries = merge_into_grid(working, result["valid"])
    # Both read the FINAL grid: the raw placements still include courses
    # check_placements just dropped as errors (which would project coverage the
    # student never gets), and a move only looks prereq-broken before the merge.
    coverage = check_coverage(audit_sections, grid, [])
    fallout = check_removal_fallout(grid, removals["allowed"],
                                    completed_ids, satisfied_ids)
    warnings = ([i["message"] for i in
                 removals["issues"] + result["issues"] + coverage + fallout]
                + list(extra_warnings or []))
    all_summaries = removed + summaries
    if not all_summaries:
        lead = "" if describe_actual else (proposal.explanation or "")
        return {
            "content": (lead
                        + "\n\nI couldn't place any valid courses — "
                        + " ".join(warnings)).strip()
        }
    if describe_actual:
        applied = "\n".join(f"{s['label']}: {', '.join(s['courses'])}"
                            for s in all_summaries)
        content = ("I hit my revision limit, so here's what actually made it "
                   "onto your planner:\n" + applied)
    else:
        content = proposal.explanation or "Here's a proposed schedule."
    return {
        "content": content,
        "proposed_schedule": grid,
        "placements": all_summaries,
        "warnings": warnings,
    }


async def plan_chat(message: str, audit_sections: list, schedule: list,
                    llm=None, today: Optional[date] = None,
                    history: Optional[list] = None,
                    seat_availability: Optional[dict] = None,
                    section_options: Optional[dict] = None,
                    ui_context: Optional[dict] = None,
                    base_year: Optional[int] = None) -> dict:
    from langchain_core.messages import (
        AIMessage,
        HumanMessage,
        SystemMessage,
        ToolMessage,
    )

    earliest_year, earliest_term = next_enrollable_term(today, base_year)
    base, year_count = plan_window(base_year, today)
    completed_ids = _graded_from_audit(audit_sections)
    # Grade parsing found nothing? Unfamiliar audit format — fall back to
    # letting every audit mention satisfy prereqs so we don't nag falsely.
    satisfied_ids = _mentioned_in_audit(audit_sections) if not completed_ids else set()
    # That fallback switches prereq checking off in all but name: every course
    # the audit names counts as already held, including ones still needed. It
    # is the right default (better quiet than wrong), but silent it is a trap —
    # nobody can tell a clean plan from an unchecked one. Say so once, on the
    # proposal, where the student is about to act on it.
    # Codes the audit vouches for, so a course the catalog has never published
    # (DSC 152) can still be planned — as unverified. See check_placements.
    audit_codes = _codes_named_by_audit(audit_sections)
    fallback_warnings = []
    if not completed_ids and satisfied_ids:
        fallback_warnings.append(
            "Heads up: I couldn't read any course grades from your degree "
            "audit, so I treated every course it mentions as already done when "
            "checking prerequisites. Prerequisite order in this plan is "
            "approximate — please double-check it."
        )
    system = SYSTEM_TEMPLATE.format(
        max_term_units=MAX_TERM_UNITS,
        last_year_index=year_count - 1,
        earliest_year=earliest_year,
        earliest_term=earliest_term,
        earliest_code=f"{TERM_CODES[earliest_term]}{base + earliest_year + (0 if earliest_term == 'fall' else 1)}",
        base_label=f"20{base}-20{base + 1}",
        ui_context=_format_ui_context(ui_context),
        audit=_format_audit(audit_sections),
        schedule=_format_schedule(schedule),
        live_upcoming=_format_live_upcoming(today, base_year),
        seats=_format_seat_availability(seat_availability),
        section_options=_format_section_options(section_options),
        candidates=_collect_candidates(
            "\n".join(
                [
                    str(turn.get("content", ""))[:2000]
                    for turn in (history or [])
                    if isinstance(turn, dict) and turn.get("role") == "user"
                ][-MAX_HISTORY_MESSAGES:]
                + [message]
            ),
            audit_sections,
            schedule,
            today=today,
            base_year=base_year,
        ),
    )

    llm = llm or _default_llm()
    messages = [SystemMessage(content=system)]
    prior_messages = []
    history_chars = 0
    # Work backward so the cap preserves the most recent context, then restore
    # chronological order before invoking the model.
    for turn in reversed((history or [])[-MAX_HISTORY_MESSAGES:]):
        if not isinstance(turn, dict):
            continue
        role = turn.get("role")
        content = str(turn.get("content", "")).strip()
        if role not in {"user", "assistant"} or not content:
            continue
        remaining = MAX_HISTORY_CHARS - history_chars
        if remaining <= 0:
            break
        content = content[-remaining:]
        history_chars += len(content)
        prior_messages.append(
            HumanMessage(content=content)
            if role == "user"
            else AIMessage(content=content)
        )
    messages.extend(reversed(prior_messages))
    messages.append(HumanMessage(content=message))
    last_proposal = None
    last_section_proposal = None
    student_allows_conflicts = _student_accepts_conflicts(message, history)
    seat_course_keys = _seat_course_keys(seat_availability)
    # Present (even with zero courses) means the browser already answered
    # LoadSectionOptions — do not pause again for the same turn.
    section_options_loaded = (
        isinstance(section_options, dict)
        and isinstance(section_options.get("courses"), list)
    )
    llm_rounds = 0
    tool_calls = 0
    tools_used: Counter = Counter()

    def _finish(result: dict, exit_reason: str, hit_cap: bool = False) -> dict:
        """Stamp loop stats onto every exit and append a metrics JSONL row."""
        stats = record_loop_turn(
            llm_rounds=llm_rounds,
            tool_calls=tool_calls,
            tools=dict(tools_used),
            exit_reason=exit_reason,
            hit_cap=hit_cap,
            max_llm_calls=MAX_LLM_CALLS,
        )
        out = dict(result or {})
        out["agent_loop"] = stats
        return out

    for _ in range(MAX_LLM_CALLS):
        llm_rounds += 1
        response = await llm.ainvoke(messages)

        if not getattr(response, "tool_calls", None):
            if last_section_proposal is not None:
                accepted = _accept_section_selection(
                    last_section_proposal, section_options,
                    student_allows_conflicts)
                if not accepted.get("rejected"):
                    if isinstance(response.content, str) and response.content:
                        accepted["content"] = response.content
                    return _finish(accepted, "propose_sections")
            if last_proposal is not None:
                # The model gave up in text after a rejected proposal. Ship the
                # proposal's valid subset anyway — its text explains the gaps.
                if isinstance(response.content, str) and response.content:
                    last_proposal.explanation = response.content
                return _finish(
                    _accept(last_proposal, schedule, completed_ids, today,
                            satisfied_ids, extra_warnings=fallback_warnings,
                            audit_sections=audit_sections,
                            base_year=base_year),
                    "propose_after_text",
                )
            return _finish(
                {"content": response.content or
                 "Sorry, I couldn't come up with a response."},
                "text",
            )

        messages.append(response)
        for call in response.tool_calls:
            name, args, call_id = call["name"], call["args"], call["id"]
            tool_calls += 1
            tools_used[name] += 1
            try:
                if name == "LookupCourses":
                    output = _run_lookup(
                        LookupCourses(**args).codes, today=today,
                        base_year=base_year)
                elif name == "SearchCourses":
                    output = _run_search(
                        SearchCourses(**args), today=today,
                        base_year=base_year)
                elif name == "LookupLiveSections":
                    lookup = LookupLiveSections(**args)
                    requested = []
                    seen = set()
                    for raw in lookup.codes:
                        code = str(raw or "").strip().upper()
                        # Both sides expand through the catalog, so the agent's
                        # "AAS 10/10R" and the client's "AAS 10R" are one course.
                        keys = _course_key_aliases(code) or {
                            _norm_course_key(code)}
                        keys.discard("")
                        if not keys or keys & seen:
                            continue
                        seen |= keys
                        if not (keys & seat_course_keys):
                            requested.append(code)
                    if requested:
                        # Live seats come from the browser (Class Planner
                        # proxy, TSS extension fallback). Pause this
                        # stateless run; the frontend fetches and retries.
                        return _finish(
                            {"seat_lookup": requested[:15]},
                            "seat_lookup",
                        )
                    output = (
                        "Live seat lookup already completed for these courses. "
                        "Use the LIVE SECTIONS / SEATS data in the system context; "
                        "a course with no section rows is not on this term's "
                        "schedule feed."
                    )
                elif name == "LoadSectionOptions":
                    load = LoadSectionOptions(**args)
                    if not section_options_loaded:
                        # Browser builds package options from live/published TSS.
                        return _finish(
                            {
                                "section_options_request": {
                                    "goals": load.goals,
                                    "course_ids": load.course_ids,
                                }
                            },
                            "section_options_request",
                        )
                    output = (
                        "Section packages already loaded for this turn. Goals noted: "
                        f"{load.goals}\n\n"
                        + _format_section_options(section_options)
                    )
                elif name == "CheckSectionSelection":
                    draft = CheckSectionSelection(**args)
                    if not section_options_loaded:
                        output = (
                            "ERROR: section packages are not loaded. "
                            "Call LoadSectionOptions first."
                        )
                    else:
                        require = _effective_require_no_conflicts(
                            draft.require_no_conflicts,
                            student_allows_conflicts)
                        result = check_section_selection(
                            section_options,
                            draft.selections,
                            require_no_conflicts=require,
                        )
                        output = _format_issues(result["issues"])
                        if require and not draft.require_no_conflicts:
                            output += "\n" + _CONFLICT_OVERRIDE_NOTE
                elif name == "ProposeSectionSelection":
                    proposal = ProposeSectionSelection(**args)
                    if not section_options_loaded:
                        output = (
                            "REJECTED — section packages are not loaded. "
                            "Call LoadSectionOptions first."
                        )
                    else:
                        accepted = _accept_section_selection(
                            proposal, section_options,
                            student_allows_conflicts)
                        if not accepted.get("rejected"):
                            return _finish(accepted, "propose_sections")
                        last_section_proposal = proposal
                        output = accepted["output"]
                elif name == "CheckPlan":
                    draft = CheckPlan(**args)
                    removals = check_removals(
                        schedule, draft.remove_course_ids, completed_ids)
                    working, _removed = remove_from_grid(
                        schedule, removals["allowed"])
                    result = check_placements(
                        working, draft.placements, completed_ids, today,
                        satisfied_ids, base_year, audit_codes)
                    merged, _s = merge_into_grid(working, result["valid"])
                    coverage = check_coverage(audit_sections, merged, [])
                    fallout = check_removal_fallout(
                        merged, removals["allowed"], completed_ids,
                        satisfied_ids)
                    output = _format_issues(
                        removals["issues"] + result["issues"] + coverage
                        + fallout)
                elif name == "ProposeSchedule":
                    proposal = ProposeSchedule(**args)
                    removals = check_removals(
                        schedule, proposal.remove_course_ids, completed_ids)
                    working, _removed = remove_from_grid(
                        schedule, removals["allowed"])
                    result = check_placements(
                        working, proposal.placements, completed_ids, today,
                        satisfied_ids, base_year, audit_codes)
                    merged, _s = merge_into_grid(working, result["valid"])
                    coverage = check_coverage(audit_sections, merged, [])
                    fallout = check_removal_fallout(
                        merged, removals["allowed"], completed_ids,
                        satisfied_ids)
                    errors = [i for i in removals["issues"] + result["issues"]
                              if i["severity"] == "error"]
                    # First/full plans: coverage shortfalls must be fixed before
                    # commit (same loop pattern as errors). Targeted single-course
                    # edits may leave other electives unmet.
                    coverage_block = (
                        coverage
                        if _is_full_plan_proposal(schedule, proposal)
                        else []
                    )
                    blocking = errors + coverage_block
                    # Remove-only proposals (empty placements after removals) are
                    # valid — _accept ships the cleared grid.
                    if not blocking:
                        return _finish(
                            _accept(proposal, schedule, completed_ids, today,
                                    satisfied_ids,
                                    extra_warnings=fallback_warnings,
                                    audit_sections=audit_sections,
                                    base_year=base_year),
                            "propose_schedule",
                        )
                    last_proposal = proposal
                    if errors and not coverage_block:
                        output = (
                            "REJECTED — fix these errors and call ProposeSchedule "
                            "again. Drop any course that is not found or already "
                            "completed; place missing prerequisites in an earlier "
                            "term (or the same term for corequisites); to move a "
                            "course already on the planner, include it in "
                            "remove_course_ids. Never try to remove a course the "
                            "audit shows as completed. Keep the rest; do not "
                            "answer with text until a proposal is accepted:\n"
                            + _format_issues(errors)
                        )
                    elif coverage_block and not errors:
                        output = (
                            "REJECTED — this plan still leaves degree requirements "
                            "unmet. Add the missing courses (SearchCourses / the "
                            "Options listed below), run CheckPlan, then "
                            "ProposeSchedule again. Do not answer with text until "
                            "coverage is closed or you truly cannot fill a "
                            "requirement:\n"
                            + _format_issues(coverage_block)
                        )
                    else:
                        output = (
                            "REJECTED — fix these errors and unmet requirements, "
                            "then call ProposeSchedule again. Do not answer with "
                            "text until a proposal is accepted:\n"
                            + _format_issues(blocking + fallout)
                        )
                else:
                    output = f"Unknown tool: {name}"
            except ValidationError as e:
                output = f"Invalid arguments for {name}: {e}"
            messages.append(ToolMessage(content=output, tool_call_id=call_id))

    # Cap hit. Ship the best rejected proposal (error courses drop out in
    # _accept) rather than nothing — matching the old post-hoc behavior.
    if last_section_proposal is not None:
        accepted = _accept_section_selection(
            last_section_proposal, section_options, student_allows_conflicts)
        if not accepted.get("rejected"):
            warnings = list(accepted.get("warnings") or [])
            warnings.append(
                "The assistant hit its revision limit — section choices may be incomplete."
            )
            accepted["warnings"] = warnings
            return _finish(accepted, "cap_propose_sections", hit_cap=True)
    if last_proposal is not None:
        # describe_actual: last_proposal is by construction the REJECTED one,
        # and its explanation names courses check_placements is about to drop.
        return _finish(
            _accept(
                last_proposal, schedule, completed_ids, today, satisfied_ids,
                extra_warnings=(["The assistant hit its revision limit — some courses "
                                 "could not be placed; the rest are shown."]
                                + fallback_warnings),
                audit_sections=audit_sections,
                base_year=base_year,
                describe_actual=True,
            ),
            "cap_propose_schedule",
            hit_cap=True,
        )
    return _finish(
        {"content": "Sorry — I couldn't finish drafting a schedule. "
                    "Please try rephrasing your request."},
        "cap_empty",
        hit_cap=True,
    )
