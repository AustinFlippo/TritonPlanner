"""Term math, planner-grid primitives, and shared constants.

Split out of planner_agent.py (which re-exports every name here, so importers
and the test suite keep one stable surface). Lowest layer of the planner
package: depends only on catalog.
"""
import re
from copy import deepcopy
from datetime import date
from typing import Optional

import catalog
from catalog import get_course


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
    snap = catalog.load_upcoming_term()
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


def _completed_key(code) -> Optional[str]:
    """Canonical catalog id, or a tidy code if the catalog doesn't know it.

    Catalog-missing completed courses must still block re-placement: a degree
    audit is an authoritative record that the student took the class, even
    when v5.json has never listed it.
    """
    cid = _canonical(code)
    if cid:
        return cid
    tidy = " ".join(str(code or "").split()).upper()
    return tidy or None


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


def _grid_has_courses(schedule) -> bool:
    for year in schedule or []:
        if not isinstance(year, dict):
            continue
        for term in TERMS:
            if year.get(term):
                return True
    return False


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
        for alias in catalog.aliases_for(form):
            key = _norm_course_key(alias)
            if key:
                keys.add(key)
    return keys
