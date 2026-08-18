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
            skipped entirely in next_quarter scope, which the model declares
            per-call on CheckPlan/ProposeSchedule — see ProposeSchedule), a
            quarter loaded past MAX_TERM_UNITS, and
            a full / waitlist-only course placed in the enrollment quarter
            (seats move; planning a waitlist is a normal student move).

Corequisites are NOT prerequisites: the prereq graph's meta.concurrent_allowed
lists courses UCSD lets a student take in the SAME quarter (ECE 65 with ECE
100), so those are satisfied by position <= the dependent course's term rather
than strictly before it.

Only OPENAI_API_KEY is required for this path — no Pinecone.
"""
import os
import re
from collections import Counter
from datetime import date
from typing import List, Optional

from pydantic import ValidationError

from catalog import (
    get_course,
    get_prereq_entry,
    extract_course_codes,
    is_offered_in_upcoming_term,
    upcoming_seat_status,
    load_upcoming_term,  # noqa: F401 — tests monkeypatch this binding
    search_courses,
)
from planner_metrics import record_loop_turn

# ---------------------------------------------------------------------------
# Split modules. planner_agent re-exports every moved name so main.py, the
# test suite, and monkeypatching keep one stable import surface.
# ---------------------------------------------------------------------------
from planner_schemas import (  # noqa: F401
    CheckPlan,
    CheckSectionSelection,
    CoursePackagePick,
    LoadSectionOptions,
    LookupCourses,
    LookupLiveSections,
    ProposeSchedule,
    ProposeSectionSelection,
    SearchCourses,
    TermPlacement,
)
from planner_terms import (  # noqa: F401
    BASE_YEAR,
    _course_key_aliases,
    _norm_course_key,
    MAX_CANDIDATES,
    MAX_HISTORY_CHARS,
    MAX_HISTORY_MESSAGES,
    MAX_LLM_CALLS,
    MAX_PLAN_YEARS,
    MAX_SEAT_CHARS,
    MAX_SEED_CANDIDATES,
    MAX_TERM_UNITS,
    MIN_PLAN_YEARS,
    TERMS,
    TERM_CODES,
    TERM_LABELS,
    _canonical,
    _coerce_grid,
    _completed_key,
    _grid_course_ids,
    _grid_has_courses,
    _grid_positions,
    _normalize_term_slots,
    empty_grid,
    enrollment_term_code,
    grid_base_year,
    live_upcoming_for_enrollment,
    next_enrollable_term,
    parse_credits,
    plan_window,
    term_sort_key,
)
from planner_scope import (  # noqa: F401
    _FULL_DEGREE_PLAN_RE,
    _NEXT_QUARTER_ONLY_RE,
    _PLANNING_VERB_RE,
    _format_planning_scope,
    _is_full_plan_proposal,
    _is_next_quarter_only_request,
)
from planner_validation import (  # noqa: F401
    _add_completed_course_row,
    _add_completed_id,
    _attribute_course_list,
    _code_variants,
    _codes_match,
    _codes_named_by_audit,
    _completed_from_grid,
    _concurrent_members,
    _counts_toward_major,
    _course_fits_range,
    _enrollment_seat_status,
    _graded_from_audit,
    _infer_course_status,
    _is_wip_grade,
    _level_from_title,
    _major_course_codes,
    _mentioned_in_audit,
    _normalize_code,
    _parse_available_codes,
    _parse_course_range,
    _planned_credits_by_id,
    _plausible_code,
    _prereq_groups,
    _prereq_satisfied,
    _prereq_timing_phrase,
    _requirements_from_audit,
    build_plan_grid,
    check_coverage,
    check_placements,
    check_removal_fallout,
    check_removals,
    merge_into_grid,
    remove_from_grid,
)


# ---------------------------------------------------------------------------
# Context formatting
# ---------------------------------------------------------------------------

def _structured_completed_lines(section) -> list:
    """Display lines for completedCourses nested on the section or its subs.

    Newer audits keep taken courses as structured rows (course_id + grade)
    under subrequirements. Older saved audits, and the items-only prompt
    format, can omit those rows from `items` — the model then has no way to
    see that the student already took the class.
    """
    courses = list(section.get("completedCourses") or [])
    for sub in section.get("subrequirements") or []:
        courses.extend(sub.get("completedCourses") or [])
    lines = []
    seen = set()
    for c in courses:
        if not isinstance(c, dict):
            continue
        display = str(c.get("display") or "").strip()
        if not display:
            cid = str(c.get("course_id") or "").strip()
            if not cid:
                continue
            desc = str(c.get("description") or c.get("course_name") or "").strip()
            extra = ", ".join(
                x for x in (str(c.get("term") or "").strip(),
                            str(c.get("grade") or "").strip()) if x)
            display = f"{cid} - {desc} ({extra})" if extra else f"{cid} - {desc}"
        key = display.upper()
        if key in seen:
            continue
        seen.add(key)
        lines.append(display)
    return lines


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
        items = [str(i) for i in (s.get("items") or [])]
        blob = "\n".join(items).upper()
        for item in items:
            parts.append(f"- {item}")
        for line in _structured_completed_lines(s):
            if line.upper() not in blob:
                parts.append(f"- {line}")
                blob += "\n" + line.upper()
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
        if on_live:
            seats = upcoming_seat_status(course["course_id"])
            if seats == "open":
                flag = "yes, seats open"
            elif seats == "waitlist":
                flag = "yes, WAITLIST only (no open seats)"
            elif seats == "full":
                flag = "yes, FULL (no open seats)"
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
        f"CATALOG DATA marks it \"{snap['term_code']} live: yes\" (seats open), "
        f"or LookupCourses / CheckPlan confirms it. Courses marked "
        f"\"{snap['term_code']} live: NO\", FULL, or WAITLIST only will be "
        f"rejected for that quarter — schedule them in a later term instead. "
        f"Later quarters still use historical catalog offerings only."
    )


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
    live_only = bool(args.live_only)
    courses, total = search_courses(
        args.query, levels=args.levels, depts=args.departments,
        quarters=args.quarters, limit=args.limit, live_only=live_only)
    snap = live_upcoming_for_enrollment(today, base_year) if live_only else None
    if not courses:
        if live_only and snap:
            return (f"No live {snap['term_code']} Class Planner courses matched. "
                    "Try broader keywords or fewer filters; never invent a "
                    "course code, and do not pick a catalog-only offering for "
                    f"{snap['term_code']}.")
        return ("No catalog courses matched. Try broader keywords or fewer "
                "filters; never invent a course code.")
    live_upcoming = live_upcoming_for_enrollment(today, base_year)
    lines = [_format_course_entry(c, live_upcoming=live_upcoming) for c in courses]
    if total > len(courses):
        lines.append(f"({total - len(courses)} more matches not shown — "
                     "narrow the query or raise limit.)")
    if live_only and snap:
        lines.append(
            f"(live {snap['term_code']} offerings only — catalog courses not "
            f"on the Class Planner schedule are omitted.)"
        )
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
- SearchCourses: keyword/filter search over the UCSD catalog. Use it whenever \
you need to DISCOVER courses — electives matching the student's interests, or \
anything you'd otherwise recall from memory. Never invent a course code. Set \
live_only=true when discovering courses to PLACE in the enrollment quarter so \
results are Class Planner offerings, not historical catalog seasons; leave it \
false when answering questions about the catalog at large.
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
remove_course_ids when the draft drops or moves courses already on the grid, and \
declare scope (next_quarter / multi_quarter) — see PLANNING SCOPE below.
- ProposeSchedule: submits the final 4-year course plan. Rejected while ERRORs remain. \
placements only ADD courses — to remove or move a course already on the planner, \
you MUST pass remove_course_ids (and for a move, also place it in the new term). \
A remove-only call with empty placements is valid.

When the student asks you to plan, fill out, generate, edit, move, or remove courses \
on their multi-quarter schedule: draft placements (and remove_course_ids when needed), \
run CheckPlan, fix what it reports, then ProposeSchedule. A planning request MUST end \
with an accepted ProposeSchedule call — never stop at a text explanation. If a course \
can't be placed (not found, already completed, or not offered live next \
quarter), drop it, place the rest, and mention \
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
"live: NO" into that quarter, in either scope; drop anything that is not live \
and SearchCourses (live_only) for a replacement. Full / \
WAITLIST-only courses MAY still go in that quarter (CheckPlan warns; \
ProposeSchedule accepts). Later terms still use historical offerings. If \
seats are missing for a candidate, call LookupLiveSections before committing \
that quarter.
- Do NOT ProposeSchedule while CheckPlan still reports ERRORS (including unsatisfied \
prerequisites) or — on a first/full plan — coverage "still short" lines. Place the \
missing prereq earlier, or SearchCourses / add the listed elective options, then \
CheckPlan again. next_quarter scope is not a full plan: CheckPlan will not \
report degree-coverage shortfalls, and you must not fill later quarters to chase \
them. Only leave coverage shortfalls on a targeted single-course add/move \
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

=== PLANNING SCOPE ===
{planning_scope}

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
    # quarters), so it uses the GPT-5.6 flagship (Sol). Chat path
    # uses Terra/Luna. GPT-5.6 rejects custom temperature — omit it.
    # GPT-5.x on /v1/chat/completions only allows function tools with
    # reasoning_effort "none" (reasoning + tools needs /v1/responses,
    # which this langchain-openai version doesn't drive).
    return ChatOpenAI(
        model="gpt-5.6-sol",
        openai_api_key=os.getenv("OPENAI_API_KEY"),
        reasoning_effort=os.getenv("PLANNER_REASONING_EFFORT", "none"),
        # The loop makes several calls per request, so a TPM blip mid-loop
        # would otherwise kill an almost-finished plan.
        max_retries=6,
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
            base_year=None, describe_actual=False, seat_availability=None,
            include_coverage=True):
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
                              _codes_named_by_audit(audit_sections),
                              seat_availability)
    grid, summaries = merge_into_grid(working, result["valid"])
    # Both read the FINAL grid: the raw placements still include courses
    # check_placements just dropped as errors (which would project coverage the
    # student never gets), and a move only looks prereq-broken before the merge.
    coverage = (check_coverage(audit_sections, grid, [])
                if include_coverage else [])
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
    audit_completed = _graded_from_audit(audit_sections)
    # Grid cards already marked completed/current also block re-placement, even
    # if the audit string didn't parse — a retake of a failed attempt is still
    # allowed because _completed_from_grid skips status=failed.
    completed_ids = audit_completed | _completed_from_grid(schedule)
    # Grade parsing found nothing? Unfamiliar audit format — fall back to
    # letting every audit mention satisfy prereqs so we don't nag falsely.
    satisfied_ids = _mentioned_in_audit(audit_sections) if not audit_completed else set()
    # That fallback switches prereq checking off in all but name: every course
    # the audit names counts as already held, including ones still needed. It
    # is the right default (better quiet than wrong), but silent it is a trap —
    # nobody can tell a clean plan from an unchecked one. Say so once, on the
    # proposal, where the student is about to act on it.
    # Codes the audit vouches for, so a course the catalog has never published
    # (DSC 152) can still be planned — as unverified. See check_placements.
    audit_codes = _codes_named_by_audit(audit_sections)
    fallback_warnings = []
    next_quarter_only = _is_next_quarter_only_request(
        message, history, ui_context, today, base_year)
    if not audit_completed and satisfied_ids:
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
        planning_scope=_format_planning_scope(
            next_quarter_only, today, base_year),
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
                            base_year=base_year,
                            seat_availability=seat_availability,
                            include_coverage=not next_quarter_only),
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
                    # No intent-based clamp: the model picks live_only itself,
                    # and check_placements rejects non-live enrollment-quarter
                    # placements as a fact regardless of scope. Clamping here
                    # made informational questions unanswerable mid-planning
                    # ("is PHIL 155 offered in spring?" found nothing).
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
                    if draft.scope:
                        # The model's declared read of the student's intent
                        # wins over the phrase-match default, and persists for
                        # the rest of the turn (later calls may omit scope).
                        next_quarter_only = draft.scope == "next_quarter"
                    removals = check_removals(
                        schedule, draft.remove_course_ids, completed_ids)
                    working, _removed = remove_from_grid(
                        schedule, removals["allowed"])
                    result = check_placements(
                        working, draft.placements, completed_ids, today,
                        satisfied_ids, base_year, audit_codes,
                        seat_availability)
                    merged, _s = merge_into_grid(working, result["valid"])
                    coverage = ([] if next_quarter_only
                                else check_coverage(audit_sections, merged, []))
                    fallout = check_removal_fallout(
                        merged, removals["allowed"], completed_ids,
                        satisfied_ids)
                    output = _format_issues(
                        removals["issues"] + result["issues"] + coverage
                        + fallout)
                elif name == "ProposeSchedule":
                    proposal = ProposeSchedule(**args)
                    if proposal.scope:
                        next_quarter_only = proposal.scope == "next_quarter"
                    removals = check_removals(
                        schedule, proposal.remove_course_ids, completed_ids)
                    working, _removed = remove_from_grid(
                        schedule, removals["allowed"])
                    result = check_placements(
                        working, proposal.placements, completed_ids, today,
                        satisfied_ids, base_year, audit_codes,
                        seat_availability)
                    merged, _s = merge_into_grid(working, result["valid"])
                    coverage = ([] if next_quarter_only
                                else check_coverage(audit_sections, merged, []))
                    fallout = check_removal_fallout(
                        merged, removals["allowed"], completed_ids,
                        satisfied_ids)
                    errors = [i for i in removals["issues"] + result["issues"]
                              if i["severity"] == "error"]
                    # First/full plans: coverage shortfalls must be fixed before
                    # commit (same loop pattern as errors). Targeted single-course
                    # edits and next-quarter-only fills may leave other electives
                    # unmet.
                    coverage_block = (
                        coverage
                        if _is_full_plan_proposal(
                            schedule, proposal, next_quarter_only)
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
                                    base_year=base_year,
                                    seat_availability=seat_availability,
                                    include_coverage=not next_quarter_only),
                            "propose_schedule",
                        )
                    last_proposal = proposal
                    if errors and not coverage_block:
                        output = (
                            "REJECTED — fix these errors and call ProposeSchedule "
                            "again. Drop any course that is not found, already "
                            "completed, or not on the live next-quarter schedule; "
                            "place missing prerequisites in an "
                            "earlier term (or the same term for corequisites); to "
                            "move a course already on the planner, include it in "
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
                seat_availability=seat_availability,
                include_coverage=not next_quarter_only,
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
