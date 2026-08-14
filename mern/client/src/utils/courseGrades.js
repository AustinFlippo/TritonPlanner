// What a grade on a degree-audit line actually means.
//
// Port of _COMPLETED_GRADES / _is_wip_grade in app/planner_agent.py — keep the
// two in sync.

/** Temporary UI flag. Flip to `false` to hide letter grades. Parsing
 *  and storage are unchanged — this only gates display. */
export const SHOW_GRADES = false;

/**
 * Audit display lines look like "CSE 21 - Title (FA23, A-)". When grades
 * are hidden, keep the term and drop the letter.
 */
export const hideGradeInDisplay = (text) => {
  if (SHOW_GRADES || typeof text !== "string") return text;
  return text.replace(/\(([^,)]+),\s*[^)]+\)\s*$/, "($1)");
};

// This exists because three separate call sites had independently spelled
// "completed" as "has a grade that isn't work-in-progress", which quietly made
// F, W, NP and I mean PASSED:
//
//   auditCoursePlanner  -> a failed course landed on the grid marked Completed
//   auditProgress       -> it then counted toward the requirement it failed
//   recommendations     -> and vanished from the options list, so the student
//                          could not even find the course they had to retake
//
// The agent never had this bug (_graded_from_audit filters on the allowlist
// below), so the grid and the assistant disagreed about the same transcript.
// A student who fails a course is exactly the student who most needs the app
// to notice.

/** Grades that mean the course is done and counts. WIP/NR are handled by
 *  isWipGrade; TP is transfer pass; P/S are pass/satisfactory. */
export const COMPLETED_GRADES = new Set([
  "A+", "A", "A-",
  "B+", "B", "B-",
  "C+", "C", "C-",
  "D+", "D", "D-",
  "P", "S", "TP", "WIP",
]);

/** In progress: no grade yet, "NR" (not reported), or an explicit WIP marker. */
export const isWipGrade = (grade) => {
  const g = String(grade ?? "").trim().toLowerCase();
  return !g || g === "nr" || g === "wip" || g.includes("progress");
};

/**
 * True when this grade completes the course.
 *
 * Deliberately an allowlist, not "anything that isn't WIP". UC San Diego
 * transcripts carry F, NP (no pass), U (unsatisfactory), W (withdrawn) and
 * I (incomplete), none of which satisfy anything. An unrecognised token is
 * treated as NOT passing: under-crediting shows the student a course they
 * have already cleared, which they can see is wrong, while over-crediting
 * hides a requirement they still owe.
 */
export const isPassingGrade = (grade) => {
  const g = String(grade ?? "").trim().toUpperCase();
  if (!g) return false;
  return COMPLETED_GRADES.has(g);
};

/**
 * True when the audit recorded an outcome for this course and it did not pass
 * — a failure, withdrawal or incomplete. Distinct from "no grade yet".
 */
export const isNonPassingGrade = (grade) => {
  const g = String(grade ?? "").trim();
  if (!g) return false;
  return !isWipGrade(g) && !isPassingGrade(g);
};
