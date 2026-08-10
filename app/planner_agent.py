"""v1 chat planner: an agentic tool loop.

The LLM plans against four tools:
  - SearchCourses: ranked keyword/filter search over the full catalog, for
    discovering courses (electives by interest) instead of recalling codes
  - LookupCourses: real catalog entries (offerings, credits, structured prereqs)
    for any course codes, or "not found"
  - CheckPlan: the same deterministic validation that used to run post-hoc,
    returned to the model so it can fix problems before the student sees them
  - ProposeSchedule: the final commit — rejected back to the model while
    error-level issues remain

The loop is capped at MAX_LLM_CALLS. Whatever the model proposes is ALSO
validated server-side at commit (never trust that the agent checked): errors
drop the offending course, warnings surface to the student.

Validation severity:
  error   — course doesn't exist, duplicate placement, term in the past,
            placement outside the 4-year grid
  warning — offerings mismatch (offerings data is historical/heuristic) and
            unsatisfied prereqs (audit parsing is fuzzy), so both are
            advisory: the model should fix them, but they never hard-block

Only OPENAI_API_KEY is required for this path — no Pinecone.
"""
import os
import re
from copy import deepcopy
from datetime import date
from typing import List, Optional

from pydantic import BaseModel, Field, ValidationError, field_validator

from catalog import (
    get_course,
    get_prereq_entry,
    extract_course_codes,
    iter_course_codes,
    level_of,
    search_courses,
)

TERMS = ["fall", "winter", "spring"]
TERM_CODES = {"fall": "FA", "winter": "WI", "spring": "SP"}
TERM_LABELS = {"fall": "Fall", "winter": "Winter", "spring": "Spring"}
BASE_YEAR = 24  # year_index 0 == 2024-2025 academic year, matching the frontend
MAX_CANDIDATES = 120
MAX_AUDIT_CHARS = 14000
MAX_LLM_CALLS = 8


# ---------------------------------------------------------------------------
# Tool schemas (bound to the LLM; class name == tool name)
# ---------------------------------------------------------------------------

class TermPlacement(BaseModel):
    year_index: int = Field(description="0-3; 0 is the 2024-2025 academic year")
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
    fix: nonexistent course, duplicate, past term) and WARNING lines
    (double-check: offerings mismatch, unsatisfied prerequisite)."""

    placements: List[TermPlacement]


class ProposeSchedule(BaseModel):
    """Submit the final schedule. Rejected if error-level issues remain — fix
    them and resubmit. Warnings are allowed but mention them in the explanation."""

    placements: List[TermPlacement]
    explanation: str = Field(
        description="Short friendly explanation of the plan and key ordering decisions"
    )


# ---------------------------------------------------------------------------
# Term / grid helpers
# ---------------------------------------------------------------------------

def next_enrollable_term(today: Optional[date] = None):
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
    year_index = (yy - BASE_YEAR) if term == "fall" else (yy - BASE_YEAR - 1)
    return year_index, term


def term_sort_key(year_index: int, term: str) -> int:
    return year_index * 3 + TERMS.index(term)


def parse_credits(raw) -> float:
    if isinstance(raw, (int, float)):
        return float(raw)
    m = re.search(r"\d+(\.\d+)?", str(raw or ""))
    return float(m.group(0)) if m else 0.0


def empty_grid():
    return [{t: [None, None, None] for t in TERMS} for _ in range(4)]


def _coerce_grid(schedule):
    grid = deepcopy(schedule) if schedule else empty_grid()
    while len(grid) < 4:
        grid.append({t: [None, None, None] for t in TERMS})
    grid = grid[:4]
    for year in grid:
        for t in TERMS:
            if not isinstance(year.get(t), list):
                year[t] = [None, None, None]
    return grid


def _grid_course_ids(schedule) -> set:
    ids = set()
    for year in schedule or []:
        for t in TERMS:
            for c in (year or {}).get(t) or []:
                if isinstance(c, dict) and c.get("course_id"):
                    ids.add(c["course_id"].upper().replace("  ", " "))
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


# ---------------------------------------------------------------------------
# Deterministic validation (pure) + merge
# ---------------------------------------------------------------------------

def check_placements(schedule, placements: List[TermPlacement],
                     completed_ids=None, today: Optional[date] = None,
                     satisfied_ids=None) -> dict:
    """Validate placements against the catalog, prereq graph, and current grid.

    Returns {"issues": [...], "valid": [...]}:
      issues — [{severity: "error"|"warning", message: str}], in grid order
      valid  — [{"year_index", "term", "courses": [course_obj, ...]}] containing
               exactly what merge_into_grid should place (warnings still place)

    completed_ids: canonical uppercase ids the student finished (graded in the
    audit) — they satisfy prereqs AND must not be re-placed.
    satisfied_ids: additional ids assumed to satisfy prereqs only (e.g. every
    audit mention, which includes still-needed courses) — placing them is fine.
    """
    completed_ids = {c.upper() for c in (completed_ids or set())}
    satisfied_ids = {c.upper() for c in (satisfied_ids or set())} | completed_ids
    issues = []
    valid = []
    earliest = term_sort_key(*next_enrollable_term(today))

    in_shape = [p for p in placements if p.term in TERMS and 0 <= p.year_index <= 3]
    if len(in_shape) < len(placements):
        issues.append({
            "severity": "error",
            "message": f"Ignored {len(placements) - len(in_shape)} placement(s) outside "
                       "the 4-year grid (year_index 0-3, terms fall/winter/spring).",
        })
    ordered = sorted(in_shape, key=lambda p: term_sort_key(p.year_index, p.term))

    # Position of every satisfiable course: completed courses come before
    # everything; grid and proposed courses sit at their term's sort key.
    grid = _coerce_grid(schedule)
    position = {cid: -1 for cid in satisfied_ids}
    for yi, year in enumerate(grid):
        for t in TERMS:
            for c in year.get(t) or []:
                if isinstance(c, dict) and c.get("course_id"):
                    cid = (_canonical(c["course_id"]) or c["course_id"].upper())
                    position.setdefault(cid, term_sort_key(yi, t))
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
            if not course:
                issues.append({
                    "severity": "error",
                    "message": f"{code}: not found in the course catalog — skipped.",
                })
                continue
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

            entry = get_prereq_entry(course["course_id"])
            for group in (entry or {}).get("requires") or []:
                satisfied = any(
                    (member.upper() in position and position[member.upper()] < key)
                    for member in group
                )
                if not satisfied:
                    opts = " or ".join(group)
                    hedge = (" (prereq parsing was partial — verify)"
                             if entry.get("confidence") == "partial" else "")
                    issues.append({
                        "severity": "warning",
                        "message": f"{course['course_id']} in {label}: needs {opts} in an "
                                   f"earlier quarter — not found in the audit, grid, or "
                                   f"this plan{hedge}.",
                    })

            credits = parse_credits(course.get("credits"))
            placed_here.append({
                "course_id": course["course_id"],
                "course_name": course.get("course_name", ""),
                "credits": credits,
                "status": "planned",
                "prerequisites": course.get("prerequisites", ""),
                "offerings": offerings,
            })

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


def _parse_available_codes(text: str) -> list:
    """Course codes from an 'Available: ...' clause. Audit lists abbreviate
    ('DSC 100, 102, 106') — bare numbers inherit the previous subject."""
    m = _AVAILABLE_RE.search(text or "")
    if not m:
        return []
    codes, last_subject = [], ""
    for raw in re.split(r"\s*(?:,|;|\bor\b)\s*", m.group(1), flags=re.I):
        code = re.sub(r"\s+", " ", raw or "").strip().upper()
        if not code:
            continue
        full = re.match(r"^([A-Z]{2,6})\s+(.+)$", code)
        if full:
            last_subject = full.group(1)
            codes.append(code)
        elif last_subject and re.match(r"^\d", code):
            codes.append(f"{last_subject} {code}")
    return codes


def _level_from_title(title: str) -> Optional[str]:
    """'48 Upper Division Unit Requirement' enumerates no course list — the
    qualifying level is implied by the title. Mirrors auditProgress.js."""
    if re.search(r"upper[\s-]*div", title or "", re.I):
        return "upper"
    if re.search(r"lower[\s-]*div", title or "", re.I):
        return "lower"
    return None


def _requirements_from_audit(audit_sections) -> list:
    """Unmet requirements: [{title, need_type, need_amount, candidates, level}].
    Prefers the structured subrequirements newer audits carry; falls back to
    parsing 'NEEDS: ... | Available: ...' items for older saved audits.
    A requirement needs either a candidate list or (for units) a level filter
    inferred from the title; anything else isn't checkable and is dropped."""
    requirements = []
    for s in audit_sections or []:
        title = s.get("title", "Untitled")
        level = _level_from_title(title)
        subs = s.get("subrequirements") or []
        if subs:
            for sub in subs:
                if sub.get("status") == "fulfilled":
                    continue
                requirements.append({
                    "title": title,
                    "need_type": "units" if str(sub.get("needType", "")).lower()
                                            .startswith("unit") else "courses",
                    "need_amount": float(sub.get("needAmount") or 1),
                    "candidates": sub.get("availableCodes") or [],
                    "level": level,
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
                if prev is not None and prev["title"] == title and not prev["candidates"]:
                    prev["candidates"] = candidates
                continue
            if needs:
                requirements.append({
                    "title": title,
                    "need_type": "units" if needs.group(2).lower() == "unit"
                                  else "courses",
                    "need_amount": float(needs.group(1)),
                    "candidates": candidates,
                    "level": level,
                })
    return [r for r in requirements
            if r["candidates"] or r["need_type"] == "units"]


def check_coverage(audit_sections, schedule, placements: List[TermPlacement]) -> list:
    """Warning-level issues for unmet requirements this plan leaves short.
    Counts planned courses only (grid status 'planned' + these placements),
    like the sidebar's projection; a course fills at most one requirement."""
    requirements = _requirements_from_audit(audit_sections)
    if not requirements:
        return []

    planned = {}  # canonical id -> credits
    for year in _coerce_grid(schedule):
        for t in TERMS:
            for c in year.get(t) or []:
                if isinstance(c, dict) and c.get("course_id") \
                        and c.get("status", "planned") == "planned":
                    cid = _canonical(c["course_id"]) or c["course_id"].upper()
                    planned[cid] = parse_credits(c.get("credits"))
    for p in placements:
        if p.term not in TERMS or not 0 <= p.year_index <= 3:
            continue
        for code in p.course_ids:
            course = get_course(code)
            if course:
                planned[course["course_id"].upper()] = parse_credits(course.get("credits"))

    issues = []
    assigned = set()
    for req in requirements:
        needed = req["need_amount"]
        if not req["candidates"]:
            # List-less unit requirement: any planned course at the title's
            # level counts, with no cross-requirement exclusion — a course
            # legitimately credits both its named requirement and e.g. the
            # 48-upper-division-unit total.
            level = req["level"]
            progress = sum(credits for cid, credits in planned.items()
                           if not level or level_of(cid) == level)
            if progress < needed:
                scope = f"{level}-division " if level else ""
                issues.append({
                    "severity": "warning",
                    "message": f"Requirement '{req['title']}': needs {needed:g} "
                               f"units, this plan covers {progress:g} — still "
                               f"short {needed - progress:g}. Add more "
                               f"{scope}courses (SearchCourses can filter by "
                               f"level).",
                })
            continue

        candidate_ids = {}
        for code in req["candidates"]:
            cid = _canonical(code)
            if cid:
                candidate_ids[cid] = code
        progress = 0.0
        for cid in candidate_ids:
            if progress >= needed or cid in assigned or cid not in planned:
                continue
            assigned.add(cid)
            progress += planned[cid] if req["need_type"] == "units" else 1
        if progress < needed:
            unplaced = [orig for cid, orig in candidate_ids.items()
                        if cid not in assigned][:6]
            options = f" Options: {', '.join(unplaced)}." if unplaced else ""
            issues.append({
                "severity": "warning",
                "message": f"Requirement '{req['title']}': needs {needed:g} "
                           f"{req['need_type']}, this plan covers {progress:g} — "
                           f"still short {needed - progress:g}.{options}",
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
                    satisfied_ids=None):
    """One-shot check + merge (the pre-agent API, kept for the fallback path).
    Returns (grid, placement_summaries, warning_strings)."""
    result = check_placements(current_schedule, placements, completed_ids, today,
                              satisfied_ids)
    grid, summaries = merge_into_grid(current_schedule, result["valid"])
    return grid, summaries, [i["message"] for i in result["issues"]]


# ---------------------------------------------------------------------------
# Context formatting
# ---------------------------------------------------------------------------

def _format_audit(audit_sections) -> str:
    parts = []
    for s in audit_sections or []:
        title = s.get("title", "Untitled")
        status = s.get("status", "unknown")
        parts.append(f"## {title} [{status}]")
        for item in s.get("items") or []:
            parts.append(f"- {item}")
    text = "\n".join(parts)
    if len(text) > MAX_AUDIT_CHARS:
        text = text[:MAX_AUDIT_CHARS] + "\n[... audit truncated ...]"
    return text or "(no degree audit uploaded)"


def _format_schedule(schedule) -> str:
    if not schedule:
        return "(planner grid is empty)"
    lines = []
    for yi, year in enumerate(schedule[:4]):
        for t in TERMS:
            ids = [
                c["course_id"]
                for c in ((year or {}).get(t) or [])
                if isinstance(c, dict) and c.get("course_id")
            ]
            if ids:
                lines.append(f"Year {yi + 1} {TERM_LABELS[t]}: {', '.join(ids)}")
    return "\n".join(lines) or "(planner grid is empty)"


def _format_course_entry(course) -> str:
    offerings = ", ".join(course.get("offerings") or []) or "unknown"
    entry = get_prereq_entry(course["course_id"])
    if entry and entry.get("requires"):
        groups = " AND ".join(
            "(" + " or ".join(g) + ")" for g in entry["requires"]
        )
        prereqs = f"{groups} [{entry.get('confidence', 'parsed')}]"
    else:
        prereqs = (course.get("prerequisites") or "None listed")[:300]
    line = (
        f"{course['course_id']} | {course.get('course_name', '')} | "
        f"{course.get('credits', '?')} units | offered: {offerings} | prereqs: {prereqs}"
    )
    unlocks = (entry or {}).get("unlocks") or []
    if unlocks:
        shown = ", ".join(unlocks[:8]) + (" …" if len(unlocks) > 8 else "")
        line += f" | unlocks: {shown}"
    return line


def _collect_candidates(message, audit_sections, schedule) -> str:
    """Catalog entries for every real course mentioned in the audit, the message,
    or the current grid — PLUS the transitive prereq closure of those courses
    (BFS, nearest first), so the model sees complete prereq chains on its first
    pass instead of discovering them through LookupCourses round-trips."""
    codes = []
    for s in audit_sections or []:
        for item in s.get("items") or []:
            codes.extend(extract_course_codes(item))
    codes.extend(extract_course_codes(message))
    for cid in _grid_course_ids(schedule):
        codes.append(cid)

    seen, entries, queue = set(), [], []
    for code in codes:
        course = get_course(code)
        if not course or course["course_id"] in seen:
            continue
        seen.add(course["course_id"])
        queue.append(course)

    while queue and len(entries) < MAX_CANDIDATES:
        course = queue.pop(0)
        entries.append(_format_course_entry(course))
        for group in (get_prereq_entry(course["course_id"]) or {}).get("requires") or []:
            for member in group:
                prereq = get_course(member)
                if prereq and prereq["course_id"] not in seen:
                    seen.add(prereq["course_id"])
                    queue.append(prereq)
    return "\n".join(entries) or "(none)"


# Grades that mean "this course is done (or underway) — don't re-place it, and
# it satisfies prereqs". F/NP/W/I don't complete anything; WIP (in progress,
# stamped by the audit parser) does count — it'll be done before planned terms.
_COMPLETED_GRADES = {
    "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-",
    "P", "S", "WIP",
}
# The frontend audit parsers emit completed courses as
# "CSE 21 - Math for Algorithms (FA23, A-)" — grade last inside the trailing
# parenthetical (SidebarAuditTracker.jsx / auditParser.js).
_TRAILING_GRADE_RE = re.compile(r"\(([^,()]*),\s*([A-Z]{1,3}[+-]?)\s*\)\s*$")
# Fallback for plainer formats: a grade token immediately after the code
# ("DSC 10 A-,"). "DSC 80," in a NEEDS list and "CSE 100 or ..." don't match.
_IMMEDIATE_GRADE_RE = re.compile(
    r"^\s*[:\-]?\s*(A\+|A-|B\+|B-|C\+|C-|D\+|D-|WIP|[ABCDPS])(?=[\s,;.)]|$)")


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

def _run_lookup(codes: List[str]) -> str:
    lines = []
    for code in codes[:40]:
        course = get_course(code)
        lines.append(_format_course_entry(course) if course
                     else f"{code}: NOT FOUND in the catalog — do not place it.")
    return "\n".join(lines) or "(no codes given)"


def _run_search(args: SearchCourses) -> str:
    courses, total = search_courses(
        args.query, levels=args.levels, depts=args.departments,
        quarters=args.quarters, limit=args.limit)
    if not courses:
        return ("No catalog courses matched. Try broader keywords or fewer "
                "filters; never invent a course code.")
    lines = [_format_course_entry(c) for c in courses]
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

You can see the student's degree audit, their current 4-year planner grid, and \
catalog data (credits, quarter offerings, prerequisites) for relevant courses.

You have four tools:
- SearchCourses: keyword/filter search over the full UCSD catalog. Use it whenever \
you need to DISCOVER courses — electives matching the student's interests, or \
anything you'd otherwise recall from memory. Never invent a course code.
- LookupCourses: catalog data for specific course codes. Before placing a course \
whose data is NOT already in the context below, look it up (batch all codes into \
one call). Never place a course you haven't seen catalog data for.
- CheckPlan: validates draft placements. ERROR lines must be fixed; WARNING lines \
(offerings, prerequisites, requirement coverage) should be fixed when possible, or \
explained to the student. Coverage warnings like "Requirement 'X': still short 2" \
mean the degree-audit section won't be satisfied by this plan — add courses from \
the listed options unless the student asked for a partial plan.
- ProposeSchedule: submits the final plan. It is rejected while ERRORs remain.

When the student asks you to plan, fill out, or generate their schedule: draft \
placements, run CheckPlan, fix what it reports, then ProposeSchedule. A planning \
request MUST end with an accepted ProposeSchedule call — never stop at a text \
explanation. If a course can't be placed (not found, already completed), drop it, \
place the rest, and mention the omission in the explanation. Rules:
- The grid has year_index 0-3 (0 = 2024-2025 academic year) and terms fall/winter/spring.
- The earliest term you may place courses into is year_index {earliest_year}, {earliest_term} \
({earliest_code}). Never place courses in earlier terms.
- Do NOT re-place courses the student already completed (they appear in the audit with \
grades) or courses already on the planner grid.
- Prioritize unmet requirements (sections marked not_fulfilled, especially NEEDS lines), \
and satisfy prerequisites in an earlier quarter than the course that needs them.
- Only schedule a course in quarters it is offered, per the catalog data.
- Aim for 3-4 courses (roughly 12-16 units) per quarter unless asked otherwise.
- In the explanation, briefly note the ordering logic, any remaining warnings, and \
anything the student should verify.

For any other question, just answer helpfully using the audit and catalog context — \
no tools needed unless the student asks about a course not shown below. Be honest \
when the context doesn't contain the answer.

=== DEGREE AUDIT ===
{audit}

=== CURRENT PLANNER GRID ===
{schedule}

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
    ).bind_tools([SearchCourses, LookupCourses, CheckPlan, ProposeSchedule])


def _accept(proposal: ProposeSchedule, schedule, completed_ids, today,
            satisfied_ids=None, extra_warnings=None, audit_sections=None):
    """Server-side commit: validate once more, merge, and build the response.
    Error-level courses are dropped; all issue messages surface to the student."""
    result = check_placements(schedule, proposal.placements, completed_ids, today,
                              satisfied_ids)
    coverage = check_coverage(audit_sections, schedule, proposal.placements)
    grid, summaries = merge_into_grid(schedule, result["valid"])
    warnings = ([i["message"] for i in result["issues"] + coverage]
                + list(extra_warnings or []))
    if not summaries:
        return {
            "content": ((proposal.explanation or "")
                        + "\n\nI couldn't place any valid courses — "
                        + " ".join(warnings)).strip()
        }
    return {
        "content": proposal.explanation or "Here's a proposed schedule.",
        "proposed_schedule": grid,
        "placements": summaries,
        "warnings": warnings,
    }


async def plan_chat(message: str, audit_sections: list, schedule: list,
                    llm=None, today: Optional[date] = None) -> dict:
    from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage

    earliest_year, earliest_term = next_enrollable_term(today)
    earliest_year = max(0, min(3, earliest_year))
    completed_ids = _graded_from_audit(audit_sections)
    # Grade parsing found nothing? Unfamiliar audit format — fall back to
    # letting every audit mention satisfy prereqs so we don't nag falsely.
    satisfied_ids = _mentioned_in_audit(audit_sections) if not completed_ids else set()
    system = SYSTEM_TEMPLATE.format(
        earliest_year=earliest_year,
        earliest_term=earliest_term,
        earliest_code=f"{TERM_CODES[earliest_term]}{BASE_YEAR + earliest_year + (0 if earliest_term == 'fall' else 1)}",
        audit=_format_audit(audit_sections),
        schedule=_format_schedule(schedule),
        candidates=_collect_candidates(message, audit_sections, schedule),
    )

    llm = llm or _default_llm()
    messages = [SystemMessage(content=system), HumanMessage(content=message)]
    last_proposal = None

    for _ in range(MAX_LLM_CALLS):
        response = await llm.ainvoke(messages)

        if not getattr(response, "tool_calls", None):
            if last_proposal is not None:
                # The model gave up in text after a rejected proposal. Ship the
                # proposal's valid subset anyway — its text explains the gaps.
                if isinstance(response.content, str) and response.content:
                    last_proposal.explanation = response.content
                return _accept(last_proposal, schedule, completed_ids, today,
                               satisfied_ids, audit_sections=audit_sections)
            return {"content": response.content or
                    "Sorry, I couldn't come up with a response."}

        messages.append(response)
        for call in response.tool_calls:
            name, args, call_id = call["name"], call["args"], call["id"]
            try:
                if name == "LookupCourses":
                    output = _run_lookup(LookupCourses(**args).codes)
                elif name == "SearchCourses":
                    output = _run_search(SearchCourses(**args))
                elif name == "CheckPlan":
                    draft = CheckPlan(**args)
                    result = check_placements(
                        schedule, draft.placements, completed_ids, today,
                        satisfied_ids)
                    coverage = check_coverage(audit_sections, schedule,
                                              draft.placements)
                    output = _format_issues(result["issues"] + coverage)
                elif name == "ProposeSchedule":
                    proposal = ProposeSchedule(**args)
                    result = check_placements(
                        schedule, proposal.placements, completed_ids, today,
                        satisfied_ids)
                    errors = [i for i in result["issues"] if i["severity"] == "error"]
                    if not errors:
                        return _accept(proposal, schedule, completed_ids, today,
                                       satisfied_ids, audit_sections=audit_sections)
                    last_proposal = proposal
                    output = ("REJECTED — fix these errors and call ProposeSchedule "
                              "again. Drop any course that is not found or already "
                              "completed and keep the rest; do not answer with text "
                              "until a proposal is accepted:\n"
                              + _format_issues(errors))
                else:
                    output = f"Unknown tool: {name}"
            except ValidationError as e:
                output = f"Invalid arguments for {name}: {e}"
            messages.append(ToolMessage(content=output, tool_call_id=call_id))

    # Cap hit. Ship the best rejected proposal (error courses drop out in
    # _accept) rather than nothing — matching the old post-hoc behavior.
    if last_proposal is not None:
        return _accept(
            last_proposal, schedule, completed_ids, today, satisfied_ids,
            extra_warnings=["The assistant hit its revision limit — some courses "
                            "could not be placed; the rest are shown."],
            audit_sections=audit_sections,
        )
    return {"content": "Sorry — I couldn't finish drafting a schedule. "
                       "Please try rephrasing your request."}
