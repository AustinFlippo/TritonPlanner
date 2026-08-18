"""Planning-scope inference: next-quarter vs multi-quarter.

Split out of planner_agent.py (which re-exports every name here). The phrase
heuristics below only pick the DEFAULT scope hint for the system prompt; the
model declares the binding scope per-call on CheckPlan / ProposeSchedule
(see planner_schemas), and facts stay enforced in planner_validation.
"""
import re
from datetime import date
from typing import Optional

from planner_schemas import ProposeSchedule
from planner_terms import (
    TERM_LABELS,
    _grid_has_courses,
    enrollment_term_code,
    live_upcoming_for_enrollment,
    next_enrollable_term,
)


# Student is asking to fill THIS enrollment quarter, not the 4-year grid.
# "this next quarter", "what should I take this term", "upcoming quarter".
_NEXT_QUARTER_ONLY_RE = re.compile(
    r"\b("
    r"(next|this|upcoming|current)(\s+\w+){0,3}\s+(quarter|term)|"
    r"enrollment quarter|"
    r"what (should|can|do) i (take|enroll|register)"
    r")\b",
    re.I,
)


# Explicit full-degree language wins over next-quarter phrasing.
# "rest of my academic plan" tolerates up to two words between "my" and the
# noun — a real student phrasing that a strict "rest of my plan" missed,
# leaving the turn wrongly locked to next-quarter scope.
_FULL_DEGREE_PLAN_RE = re.compile(
    r"\b("
    r"4[- ]?year|four[- ]year|"
    r"full (degree |course )?plan|"
    r"all (of )?(my )?(quarters|years)|"
    r"rest of (my |the )?(\w+ ){0,2}(degree|college|plan|schedule)|"
    r"until (i )?graduat|"
    r"every quarter|"
    r"whole (degree )?plan|"
    r"multi[- ]?(year|quarter)"
    r")\b",
    re.I,
)


_PLANNING_VERB_RE = re.compile(
    r"\b(plan|fill|schedule|pick|choose|recommend|generate|build|"
    r"what should i take|classes to take|courses to take)\b",
    re.I,
)


def _is_next_quarter_only_request(message, history=None, ui_context=None,
                                  today: Optional[date] = None,
                                  base_year: Optional[int] = None) -> bool:
    """True when the student is planning the enrollment quarter, not the
    rest of the degree.

    The most recent user turn with scope language decides — current message
    first, then history newest-first — so "create the rest of my academic
    plan" escapes an earlier "what should I take this quarter", and a bare
    follow-up ("sure, do that") keeps the scope of the request it answers
    instead of snapping back to an older signal. Whole-history blob matching
    used to lock a conversation to next-quarter scope permanently.

    Within a single turn, explicit full-degree language wins over
    next-quarter phrasing ("plan my 4-year schedule for next quarter").
    Signals: this/next/upcoming quarter phrasing, the enrollment term code
    (FA26), or the enrollment label from the UI. With no textual signal
    anywhere, Quarter View plus a planning verb in the current message
    means next-quarter.
    """
    code = enrollment_term_code(today, base_year)
    view = ""
    enrollment_label = ""
    if isinstance(ui_context, dict):
        view = str(ui_context.get("view") or "").strip().lower()
        enrollment = ui_context.get("enrollment")
        if isinstance(enrollment, dict):
            enrollment_label = str(enrollment.get("label") or "").strip().lower()

    def _signal(text: str) -> Optional[bool]:
        if _FULL_DEGREE_PLAN_RE.search(text):
            return False
        if _NEXT_QUARTER_ONLY_RE.search(text):
            return True
        if re.search(rf"\b{re.escape(code)}\b", text, re.I):
            return True
        if enrollment_label and enrollment_label in text.lower():
            return True
        return None

    texts = [str(message or "")]
    for turn in reversed(history or []):
        if isinstance(turn, dict) and turn.get("role") == "user":
            texts.append(str(turn.get("content") or ""))
    for text in texts:
        found = _signal(text)
        if found is not None:
            return found
    if view == "quarter" and _PLANNING_VERB_RE.search(str(message or "")):
        return True
    return False


def _is_full_plan_proposal(schedule, proposal: ProposeSchedule,
                           next_quarter_only: bool = False) -> bool:
    """First plans and multi-term fills must close audit coverage gaps.

    A targeted "add CSE 158" / single-term tweak may leave other electives
    unmet — those stay advisory. An empty grid, 2+ terms touched, or 4+
    courses in one proposal is treated as a full planning pass — unless the
    student asked to plan only the next quarter, in which case leftover
    degree requirements are expected.
    """
    if next_quarter_only:
        return False
    if not _grid_has_courses(schedule):
        return True
    n_courses = sum(len(p.course_ids or []) for p in (proposal.placements or []))
    n_terms = sum(1 for p in (proposal.placements or []) if p.course_ids)
    return n_terms >= 2 or n_courses >= 4


def _format_planning_scope(default_next_quarter: bool,
                           today: Optional[date] = None,
                           base_year: Optional[int] = None) -> str:
    """Prompt block: enrollment-quarter facts plus both scope rule-sets.

    Scope is the MODEL's decision, declared per-call via the `scope` field on
    CheckPlan / ProposeSchedule. The phrase-match heuristic only picks the
    default shown here — it is a hint, never a lock, so the model can follow
    "create the rest of my academic plan" no matter how earlier turns were
    phrased. Facts stay server-enforced either way: check_placements rejects
    non-live courses placed into the enrollment quarter whenever a live
    snapshot is loaded, in both scopes.
    """
    yi, term = next_enrollable_term(today, base_year)
    code = enrollment_term_code(today, base_year)
    snap = live_upcoming_for_enrollment(today, base_year)
    if snap:
        live_rule = (
            f"Courses placed into {code} must be on the live Class Planner "
            f"schedule (\"{code} live: yes\") — a course marked \"{code} "
            f"live: NO\" is rejected for that quarter in either scope. Use "
            f"SearchCourses live_only=true when hunting for {code} courses."
        )
    else:
        live_rule = (
            f"No live Class Planner snapshot is loaded for {code}. Do not "
            f"invent next-quarter offerings."
        )
    default_label = ("NEXT-QUARTER ONLY" if default_next_quarter
                     else "MULTI-QUARTER / FULL DEGREE")
    return (
        f"The enrollment quarter is {code} (year_index {yi}, {term} — "
        f"Year {yi + 1} {TERM_LABELS[term]}). {live_rule}\n"
        f"Planning scope is YOUR call each turn, declared via the scope "
        f"field on CheckPlan / ProposeSchedule. Read it from what the "
        f"student is asking right now, and switch freely when their request "
        f"changes:\n"
        f"- next_quarter: they are planning {code} itself. Place courses "
        f"only in that term; aim for 3-4 live courses. Leftover degree "
        f"requirements in later quarters are expected — coverage is not "
        f"reported, and you must not fill later quarters to chase it.\n"
        f"- multi_quarter: they want planning beyond {code}. On a "
        f"first/full plan, close audit coverage before ProposeSchedule.\n"
        f"Default this turn, guessed from the student's phrasing: "
        f"{default_label}. This default is not binding, and there is no "
        f"planner mode, setting, or UI switch behind it — never tell the "
        f"student to change a setting, never claim you are locked to a "
        f"scope, and never refuse multi-quarter planning; declare the scope "
        f"their request implies and plan."
    )
