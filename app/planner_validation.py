"""Deterministic validation — the LLM is never trusted to have checked.

Split out of planner_agent.py (which re-exports every name here): placement
validation against catalog/prereqs/live offerings, audit requirement
projection + coverage, removal safety, and completed-course extraction.
check_coverage mirrors the client's auditProgress.js via the shared
audit_requirements spec (see shared/audit-requirement-cases.json).
"""
import re
from datetime import date
from typing import List, Optional

from audit_requirements import (
    assign_section_courses,
    evaluate_subrequirement,
    requirement_mode,
)
from catalog import (
    aliases_for,
    extract_course_codes,
    get_course,
    get_prereq_entry,
    is_offered_in_upcoming_term,
    iter_course_codes,
    level_of,
    seat_status_from_sections,
    upcoming_seat_status,
)
from planner_schemas import TermPlacement
from planner_terms import (
    MAX_TERM_UNITS,
    _course_key_aliases,
    MIN_PLAN_YEARS,
    TERMS,
    TERM_CODES,
    TERM_LABELS,
    _canonical,
    _coerce_grid,
    _completed_key,
    _grid_course_ids,
    _grid_positions,
    _normalize_term_slots,
    live_upcoming_for_enrollment,
    next_enrollable_term,
    parse_credits,
    plan_window,
    term_sort_key,
)


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
    Falls back to normalized string equality for codes not in the catalog.

    Range tokens ("ECON 100TO199", "CSE 100 TO 199") match any alias whose
    department and number sit in the band. Port of codeMatches in
    auditProgress.js / parseCourseRange in courseRanges.js."""
    rng = _parse_course_range(code)
    if rng:
        return any(_course_fits_range(v, rng) for v in _code_variants(course_id))
    a = _canonical(course_id) or " ".join(str(course_id or "").upper().split())
    b = _canonical(code) or " ".join(str(code or "").upper().split())
    return a == b


# "ECON 100TO199" / "MATH 100 TO 199" / "ECON 100 TO ECON 199" / "ECON 100-199"
_RANGE_RE = re.compile(
    r"^([A-Z][A-Z&]*)\s+(\d+)[A-Z]*\s*(?:TO|[-–—])\s*(?:([A-Z][A-Z&]*)\s+)?(\d+)[A-Z]*$",
    re.I,
)


def _parse_course_range(token):
    """{dept, lo, hi} when token names a numeric band, else None.

    Mirrors parseCourseRange in mern/client/src/utils/courseRanges.js."""
    text = " ".join(str(token or "").upper().split())
    m = _RANGE_RE.match(text)
    if not m:
        return None
    dept = m.group(1).upper()
    other = (m.group(3) or "").upper()
    if other and other != dept:
        return None
    lo, hi = int(m.group(2)), int(m.group(4))
    if lo > hi:
        lo, hi = hi, lo
    return {"dept": dept, "lo": lo, "hi": hi}


def _course_fits_range(course_id: str, rng: dict) -> bool:
    """Leading subject + first number sit in the band. Mirrors courseFitsRange."""
    text = " ".join(str(course_id or "").upper().split())
    dm = re.match(r"^([A-Z]+)", text)
    nm = re.search(r"(\d+)", text)
    if not dm or not nm:
        return False
    n = int(nm.group(1))
    return dm.group(1) == rng["dept"] and rng["lo"] <= n <= rng["hi"]


def _enrollment_seat_status(course_id, seat_availability=None) -> Optional[str]:
    """'open' | 'waitlist' | 'full' | None for the enrollment quarter.

    Prefers the per-turn live overlay the browser sent (TSS or the seats
    proxy). Falls back to the Class Planner snapshot. None means we do not
    know — do not invent a full/open call.
    """
    wanted = _course_key_aliases(course_id)
    if isinstance(seat_availability, dict):
        for course in seat_availability.get("courses") or []:
            if not isinstance(course, dict):
                continue
            keys = _course_key_aliases(course.get("courseId"))
            if not (keys & wanted):
                continue
            sections = course.get("sections") or []
            if not sections:
                break
            overlay = seat_status_from_sections(sections)
            if overlay:
                return overlay
            break
    return upcoming_seat_status(course_id)


# ---------------------------------------------------------------------------
# Deterministic validation (pure) + merge
# ---------------------------------------------------------------------------

def check_placements(schedule, placements: List[TermPlacement],
                     completed_ids=None, today: Optional[date] = None,
                     satisfied_ids=None, base_year: Optional[int] = None,
                     audit_codes=None, seat_availability=None) -> dict:
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
            completed_key = _completed_key(code)
            if completed_key and completed_key in completed_ids:
                issues.append({
                    "severity": "error",
                    "message": f"{code}: already completed per the "
                               "degree audit — skipped.",
                })
                continue
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
            cid = _completed_key(course["course_id"]) or course["course_id"].upper()
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
                    and p.term == enroll_term):
                if is_offered_in_upcoming_term(course["course_id"]) is False:
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
                seats = _enrollment_seat_status(
                    course["course_id"], seat_availability)
                if seats in ("full", "waitlist"):
                    why = ("no open seats — waitlist only" if seats == "waitlist"
                           else "no open seats (full)")
                    issues.append({
                        "severity": "warning",
                        "message": (
                            f"{course['course_id']}: {why} on the live "
                            f"{live_upcoming['term_code']} schedule — placed "
                            f"anyway. Seats can open, and waitlisting is an "
                            f"option."
                        ),
                    })

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
                    if _parse_course_range(code):
                        codes.add(_normalize_code(code))
                    else:
                        codes |= _code_variants(code)
    return codes or None


def _counts_toward_major(course_id, major_codes) -> bool:
    """Port of countsTowardMajor in auditProgress.js: any alias in common,
    or a course whose dept+number sits in a stored range token."""
    if not major_codes:
        return False
    variants = _code_variants(course_id)
    if variants & major_codes:
        return True
    for stored in major_codes:
        rng = _parse_course_range(stored)
        if rng and any(_course_fits_range(v, rng) for v in variants):
            return True
    return False


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
                    base_year=None, audit_codes=None, seat_availability=None):
    """One-shot check + merge (the pre-agent API, kept for the fallback path).
    Returns (grid, placement_summaries, warning_strings)."""
    removals = check_removals(current_schedule, remove_course_ids, completed_ids)
    working, removed = remove_from_grid(current_schedule, removals["allowed"])
    result = check_placements(working, placements, completed_ids, today,
                              satisfied_ids, base_year, audit_codes,
                              seat_availability)
    grid, summaries = merge_into_grid(working, result["valid"])
    fallout = check_removal_fallout(grid, removals["allowed"], completed_ids,
                                    satisfied_ids)
    return (grid, removed + summaries,
            [i["message"]
             for i in removals["issues"] + result["issues"] + fallout])


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


def _add_completed_id(ids, code) -> None:
    cid = _completed_key(code)
    if cid:
        ids.add(cid)


def _add_completed_course_row(ids, course) -> None:
    """A structured completedCourses row counts iff its grade completes."""
    if not isinstance(course, dict):
        return
    grade = str(course.get("grade") or "").strip().upper()
    if grade not in _COMPLETED_GRADES:
        return
    _add_completed_id(ids, course.get("course_id"))


def _graded_from_audit(audit_sections) -> set:
    """Canonical ids of courses the audit shows with a completing grade.
    These must not be re-placed and satisfy prereqs.

    Reads both the items-string format ("CSE 21 - Title (FA23, A-)") and the
    structured `completedCourses` rows the frontend parser now stores on
    subrequirements. A completing grade on a course the catalog has never
    published still counts — `_completed_key` keeps the tidy code so
    check_placements can refuse to re-place it as unverified.
    """
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
                    _add_completed_id(ids, codes[0][0])
                continue
            for code, end in codes:
                gm = _IMMEDIATE_GRADE_RE.match(upper[end:])
                if gm and gm.group(1) in _COMPLETED_GRADES:
                    _add_completed_id(ids, code)
        for c in s.get("completedCourses") or []:
            _add_completed_course_row(ids, c)
        for sub in s.get("subrequirements") or []:
            for c in sub.get("completedCourses") or []:
                _add_completed_course_row(ids, c)
    return ids


def _completed_from_grid(schedule) -> set:
    """Courses already on the grid as completed or in-progress.

    The audit is the usual source, but a card the student (or a previous
    upload) already marked completed/current must not be re-planned into a
    future term if grade parsing missed it. Failed attempts are excluded so
    a retake can still be placed.
    """
    ids = set()
    for year in schedule or []:
        for t in TERMS:
            for c in (year or {}).get(t) or []:
                if not isinstance(c, dict) or not c.get("course_id"):
                    continue
                if _infer_course_status(c) in ("completed", "current"):
                    _add_completed_id(ids, c["course_id"])
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
        for c in s.get("completedCourses") or []:
            if isinstance(c, dict) and c.get("course_id"):
                codes.add(c["course_id"])
        for item in s.get("items") or []:
            if isinstance(item, str):
                codes.update(_parse_available_codes(item))
    tidy = {" ".join(str(c).split()).upper() for c in codes if c}
    return {c for c in tidy if _plausible_code(c) and not _parse_course_range(c)}


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
