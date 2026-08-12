"""Degree-audit requirement semantics — the planner agent's half of one spec.

PORT OF mern/client/src/utils/auditRequirements.js. The two implementations
are kept honest by shared/audit-requirement-cases.json, which both test suites
load (node --test on the JS side, pytest here). Any behavioural disagreement
fails a test rather than quietly handing a student a wrong answer. Change one
side, change the other, and add a case.

The model
---------
A subrequirement is a NEEDS amount plus a list of OR-groups (slots). A real
audit writes them like::

    NEEDS: 7 Courses
    [MATH 189] OR [DSC 152], [DSC 100], [DSC 102], [DSC 106],
    [DSC 140A] OR [CSE 150A]  [DSC 140B] OR [CSE 151A]  [DSC 148] OR [CSE 158]

Seven slots, four offering a choice — and NEEDS is also 7. That equality is
the tell: slot count == required course count means every slot must be filled
("all"). Otherwise it is a pick-any-N pool ("any") — Arts lists 81 slots and
needs 1. Getting this wrong in the "all" direction marks a student complete
while they are still missing required courses.
"""
import math
import re
from typing import Callable, List, Optional


def _credits_of(course) -> float:
    """Leading number in a catalog credits value.

    Port of parseCredits (courseCredits.js) / parse_credits (planner_agent.py):
    a dash-joined sequence writes its units per quarter ("4-4-4"), so float()
    on the whole string blew up (and Number() quietly returned NaN) for a
    course actually worth 4 units.
    """
    raw = (course or {}).get("credits")
    if isinstance(raw, (int, float)):
        return float(raw)
    m = re.search(r"\d+(\.\d+)?", str(raw if raw is not None else ""))
    return float(m.group(0)) if m else 0.0


def requirement_mode(groups, need_type: str, need_amount) -> str:
    """"all" = every group must be satisfied; "any" = take need_amount."""
    if need_type != "courses":
        return "any"  # unit requirements are always pools
    try:
        n = float(need_amount)
    except (TypeError, ValueError):
        return "any"
    if n <= 0:
        return "any"
    return "all" if isinstance(groups, list) and len(groups) == int(n) else "any"


def match_groups(groups, course_ids, matches: Callable[[str, str], bool]):
    """Maximum bipartite matching between courses and groups (Kuhn's).

    Greedy under-counts when a course is eligible for several groups: with
    groups [[A],[A,B]] and courses [A,B], greedy binds A to the first group and
    reports 1 of 2. Sizes here are tiny, so exactness is free.

    Returns (count, satisfied_group_indexes, used_course_ids).
    """
    group_to_course: List[int] = [-1] * len(groups)

    def try_assign(course_index: int, seen: set) -> bool:
        for g, group in enumerate(groups):
            if g in seen:
                continue
            if not any(matches(course_ids[course_index], code) for code in group):
                continue
            seen.add(g)
            if group_to_course[g] == -1 or try_assign(group_to_course[g], seen):
                group_to_course[g] = course_index
                return True
        return False

    count = 0
    for c in range(len(course_ids)):
        if try_assign(c, set()):
            count += 1

    satisfied = [g for g, ci in enumerate(group_to_course) if ci != -1]
    used = [course_ids[ci] for ci in group_to_course if ci != -1]
    return count, satisfied, used


def evaluate_subrequirement(requirement: dict, courses: List[dict],
                            matches: Callable[[str, str], bool]) -> dict:
    """Evaluate one subrequirement against a set of courses.

    requirement: {needType|need_type, needAmount|need_amount, groups, mode?}
    courses:     [{"course_id": str, "credits": number}]
    matches:     code equality including cross-listing aliases, supplied by the
                 caller so this module carries no catalog knowledge

    Returns {satisfied, progress, needed, mode, open_groups, matched_courses}.
    open_groups are the unfilled slots in "all" mode — the actionable part a
    bare count can never express.
    """
    groups = requirement.get("groups") or []
    need_type = requirement.get("needType", requirement.get("need_type"))
    need_type = "units" if need_type == "units" else "courses"
    raw_need = requirement.get("needAmount", requirement.get("need_amount"))
    try:
        needed = float(raw_need)
    except (TypeError, ValueError):
        needed = 0.0 if need_type == "units" else 1.0
    if needed <= 0 and need_type == "courses":
        needed = 1.0

    mode = requirement.get("mode") or requirement_mode(groups, need_type, needed)

    if need_type == "units":
        matched = [
            c for c in courses
            if any(matches(c.get("course_id"), code) for group in groups for code in group)
        ]
        progress = sum(_credits_of(c) for c in matched)
        return {
            "satisfied": progress >= needed,
            "progress": progress,
            "needed": needed,
            "mode": "any",
            "open_groups": [],
            "matched_courses": matched,
        }

    course_ids = [c.get("course_id") for c in courses]
    count, satisfied_groups, used = match_groups(groups, course_ids, matches)
    matched_courses = [c for c in courses if c.get("course_id") in used]

    if mode == "all":
        open_groups = [g for i, g in enumerate(groups) if i not in satisfied_groups]
        return {
            "satisfied": len(open_groups) == 0 and len(groups) > 0,
            "progress": count,
            "needed": float(len(groups)),
            "mode": mode,
            "open_groups": open_groups,
            "matched_courses": matched_courses,
        }

    progress = min(count, int(needed))
    return {
        "satisfied": progress >= needed,
        "progress": progress,
        "needed": needed,
        "mode": mode,
        "open_groups": [],
        "matched_courses": matched_courses[:int(needed)],
    }


def assign_section_courses(requirements, courses: List[dict],
                           matches: Callable[[str, str], bool]) -> List[dict]:
    """Assign courses to EVERY course-type row of ONE audit section at once.

    PORT OF assignSectionCourses in mern/client/src/utils/auditRequirements.js.

    Exclusivity is per section: a course fills at most one slot anywhere in the
    section. Deciding that row by row — first row takes what it can, later rows
    get the leftovers — reports a satisfiable plan as short. With

        Electives  NEEDS 1 of [DSC 100, DSC 102, DSC 106]
        Core       NEEDS 1 of [DSC 100]

    a student who planned DSC 100 and DSC 102 was told "Core: still needed:
    DSC 100" — a course already on their grid — purely because Electives came
    first and swallowed DSC 100.

    So the matching runs over course -> (row, slot) across the whole section.
    Slots are one per OR-group in "all" mode and needAmount interchangeable
    pool slots in "any" mode; maximum bipartite matching (Kuhn's) then fills as
    many slots as any assignment could. This maximises FILLED SLOTS, not
    fully-satisfied rows, and those can differ when rows tie for one course;
    ties break toward the earlier row (the old document-order bias), so nothing
    previously reported satisfied stops being reported satisfied.

    Unit rows are NOT handled here — they are pools scored by credits, not
    slots. Returns one result per row, in order, shaped like
    evaluate_subrequirement's.
    """
    def shape_of(requirement):
        groups = requirement.get("groups")
        groups = groups if isinstance(groups, list) else []
        raw = requirement.get("needAmount", requirement.get("need_amount"))
        try:
            needed = float(raw)
        except (TypeError, ValueError):
            needed = 0.0
        if not needed or needed != needed:  # NaN or 0 -> 1, as Number(x) || 1
            needed = 1.0
        mode = requirement.get("mode") or requirement_mode(groups, "courses", needed)
        return groups, needed, mode

    slots = []  # [{row, group, codes}]
    for row_index, requirement in enumerate(requirements):
        groups, needed, mode = shape_of(requirement)
        if mode == "all":
            for group_index, codes in enumerate(groups):
                slots.append({"row": row_index, "group": group_index,
                              "codes": codes})
            continue
        # Pool row: N interchangeable slots over the flattened option list.
        # Duplicate codes collapse so "[DSC 100] [DSC 100], NEEDS 2" cannot be
        # filled twice by one DSC 100.
        pool, seen_codes = [], set()
        for group in groups:
            for code in group:
                if code not in seen_codes:
                    seen_codes.add(code)
                    pool.append(code)
        for _ in range(int(math.ceil(needed))):
            slots.append({"row": row_index, "group": -1, "codes": pool})

    slot_to_course = [-1] * len(slots)
    course_ids = [c.get("course_id") for c in courses]

    def eligible(course_index: int, slot_index: int) -> bool:
        return any(matches(course_ids[course_index], code)
                   for code in slots[slot_index]["codes"])

    def try_assign(course_index: int, seen: set) -> bool:
        for s in range(len(slots)):
            if s in seen or not eligible(course_index, s):
                continue
            seen.add(s)
            if slot_to_course[s] == -1 or try_assign(slot_to_course[s], seen):
                slot_to_course[s] = course_index
                return True
        return False

    for c in range(len(courses)):
        try_assign(c, set())

    per_row = [{"matched_courses": [], "filled_groups": set()}
               for _ in requirements]
    for slot_index, slot in enumerate(slots):
        course_index = slot_to_course[slot_index]
        if course_index == -1:
            continue
        per_row[slot["row"]]["matched_courses"].append(courses[course_index])
        if slot["group"] >= 0:
            per_row[slot["row"]]["filled_groups"].add(slot["group"])

    results = []
    for row_index, requirement in enumerate(requirements):
        groups, needed, mode = shape_of(requirement)
        matched_courses = per_row[row_index]["matched_courses"]
        filled = per_row[row_index]["filled_groups"]
        if mode == "all":
            open_groups = [g for i, g in enumerate(groups) if i not in filled]
            results.append({
                "satisfied": not open_groups and len(groups) > 0,
                "progress": len(matched_courses),
                "needed": float(len(groups)),
                "mode": mode,
                "open_groups": open_groups,
                "matched_courses": matched_courses,
            })
            continue
        results.append({
            "satisfied": len(matched_courses) >= needed,
            "progress": min(len(matched_courses), int(needed)),
            "needed": needed,
            "mode": mode,
            "open_groups": [],
            "matched_courses": matched_courses,
        })
    return results
