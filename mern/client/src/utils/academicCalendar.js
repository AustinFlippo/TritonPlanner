// Extension is required: node --test resolves ESM strictly, unlike Vite.
import { yearLabelsFor } from "./auditCoursePlanner.js";

// Year labels are DERIVED from the student's plan window, never hardcoded.
// There used to be three copies of a fixed ["2024-2025", ...] array that did
// not re-anchor with gridBaseYear, so in Oct 2028 enrollmentPlanSlot would have
// returned null and Quarter View would have lost its slot entirely.

const termCalendarYear = (yearLabel, term) => {
  const [start, end] = String(yearLabel).split("-");
  return term === "fall" ? start : end;
};

/**
 * Which quarter students are (or are about to be) enrolling in.
 *
 * This tracks the ENROLLMENT window, not the quarter in progress, and the
 * difference is the whole point. UCSD opens enrollment for the next quarter
 * around week 6 of the current one, so from mid-November a student is shopping
 * *Winter*, not finishing Fall. The old rule ("month >= 8 → fall") returned Fall
 * on 15 Nov, exactly while Class Planner had rolled to WI27 — and both
 * `fetchServerTerm` and `loadNextQuarterOfferings` reject a payload whose term
 * does not match, so the schedule feature went dark for the several weeks it is
 * most needed.
 *
 * Boundaries, deliberately keyed on day-of-month rather than whole months:
 *   Nov 15 – Dec 31  → Winter (next calendar year)
 *   Jan  1 – Feb 19  → Winter (this calendar year, in progress)
 *   Feb 20 – May 14  → Spring
 *   May 15 – Nov 14  → Fall     (covers summer, which has no enrollment of its
 *                                own here, and the whole Fall quarter)
 *
 * TSS AcademicYear is the *start* of the academic year, so Fall 2026 / Winter
 * 2027 / Spring 2027 all query as AcademicYear 2026.
 */
export function nextEnrollmentQuarter(now = new Date()) {
  const month = now.getMonth(); // 0-indexed
  const day = now.getDate();
  // Comparable ordinal on a 0-indexed month: Feb 20 → 120, May 15 → 415,
  // Nov 15 → 1015.
  const md = month * 100 + day;

  let term;
  let calendarYear = now.getFullYear();

  if (md >= 1015) {
    // Nov 15 onwards: winter enrollment is open, and winter is next year.
    term = "winter";
    calendarYear += 1;
  } else if (md < 120) {
    term = "winter"; // Jan 1 – Feb 19
  } else if (md < 415) {
    term = "spring"; // Feb 20 – May 14
  } else {
    term = "fall"; // May 15 – Nov 14
  }

  const academicYear =
    term === "fall" ? String(calendarYear) : String(calendarYear - 1);
  const termCode = { fall: "FA", winter: "WI", spring: "SP" }[term];
  const shortName = { fall: "Fall", winter: "Winter", spring: "Spring" }[term];
  const yy = String(calendarYear).slice(-2);

  return {
    term,
    calendarYear: String(calendarYear),
    academicYear,
    termCode,
    label: `${shortName} ${calendarYear}`,
    chipLabel: `${termCode}${yy}`,
  };
}

/**
 * Enrollment quarter as a slot on the planner grid (yearIndex + term).
 * null when today's enrollment quarter falls outside the student's window —
 * e.g. an alum whose grid ended before the current term.
 */
export function enrollmentPlanSlot(window, now = new Date()) {
  const eq = nextEnrollmentQuarter(now);
  const yearIndex = yearLabelsFor(window).findIndex(
    (label) => termCalendarYear(label, eq.term) === eq.calendarYear
  );
  if (yearIndex === -1) return null;
  return { ...eq, yearIndex };
}

/** Catalog level bucket used by Course Search filters. */
export function levelOfCourseId(courseId) {
  const m = String(courseId || "").match(/(\d+)/);
  if (!m) return "upper";
  const n = parseInt(m[1], 10);
  if (n < 100) return "lower";
  if (n < 200) return "upper";
  return "grad";
}
