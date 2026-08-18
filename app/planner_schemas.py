"""Pydantic tool schemas bound to the LLM (class name == tool name).

Split out of planner_agent.py (which re-exports every name here). These are
the agent's entire structured-output surface — including the model-declared
planning scope on CheckPlan / ProposeSchedule.
"""
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


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
    """Search the UCSD catalog by keywords, with optional filters. Use
    this to DISCOVER courses — electives matching an interest ("machine
    learning"), or browsing a department — instead of guessing codes from
    memory. Empty query + filters browses everything matching the filters.
    Set live_only when the student is planning the enrollment quarter so
    results are Class Planner offerings, not historical catalog seasons."""

    query: str = Field(description="Topic keywords, title words, or an id prefix "
                                   'like "DSC 1"; may be empty when filters are set')
    departments: Optional[List[str]] = Field(
        default=None, description='Department codes, e.g. ["CSE", "DSC"]')
    quarters: Optional[List[str]] = Field(
        default=None, description='Only courses offered in one of: "FA", "WI", "SP"')
    levels: Optional[List[str]] = Field(
        default=None, description='Any of "lower" (1-99), "upper" (100-199), "grad" (200+)')
    live_only: bool = Field(
        default=False,
        description="If true, only return courses on the live Class Planner "
                    "schedule for the enrollment quarter. Required when planning "
                    "next quarter. Ignored when no live schedule is loaded.",
    )
    limit: int = Field(default=10, ge=1, le=25)


class CheckPlan(BaseModel):
    """Validate draft placements before proposing. Returns ERROR lines (must
    fix: nonexistent course, duplicate, past term, unsatisfied prerequisite)
    and WARNING lines (offerings mismatch, audit coverage still short, overload).

    Declare the student's planning scope on each call: "next_quarter" when
    they are planning only the enrollment quarter (coverage shortfalls are
    not reported — do not try to close the rest of the degree), or
    "multi_quarter" when they want planning across terms (fix ERRORS and
    coverage shortfalls before ProposeSchedule on a first/full plan). To move
    or drop courses already on the planner, list them in remove_course_ids —
    they are cleared from the grid before validation, so they can be
    re-placed in a new term without a duplicate error."""

    placements: List[TermPlacement]
    remove_course_ids: List[str] = Field(
        default_factory=list,
        description='Course codes to remove from the planner before validating '
                    'placements, e.g. ["DSC 100"]. Required when moving a course '
                    'that is already on the grid.',
    )
    scope: Optional[Literal["next_quarter", "multi_quarter"]] = Field(
        default=None,
        description='Your read of what the student is asking for this turn: '
                    '"next_quarter" (fill or adjust only the enrollment '
                    'quarter) or "multi_quarter" (plan across later terms '
                    'too). Omit to keep the scope already in effect.',
    )


class ProposeSchedule(BaseModel):
    """Submit the final schedule. Rejected while ERRORs remain, and rejected on
    first/full plans while audit coverage is still short — fix those and
    resubmit. In next_quarter scope, coverage shortfalls are not reported and
    do not block. Historical-offerings / overload warnings may remain; mention
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
    scope: Optional[Literal["next_quarter", "multi_quarter"]] = Field(
        default=None,
        description='Your read of what the student is asking for this turn: '
                    '"next_quarter" (fill or adjust only the enrollment '
                    'quarter) or "multi_quarter" (plan across later terms '
                    'too). Omit to keep the scope already in effect.',
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
