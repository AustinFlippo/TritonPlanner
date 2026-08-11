// Unit counts as the catalog writes them, which is not always a number.
//
// Port of parse_credits in app/planner_agent.py — keep the two in sync.
//
// The General Catalog stores credits as free text, and three shapes reach us:
//   "4"           an ordinary course
//   "4-4-4"       one quarter of a dash-joined sequence ("HILD 2A-B-C"), per
//                 quarter and in order — so the leading number is this
//                 course's units, not a total
//   "0-4/0-4/0-4" a variable-unit graduate seminar
//
// `Number("4-4-4")` is NaN, and every call site spelled that as
// `Number(c.credits) || 0`, so a sequence course entered the planner worth
// ZERO units and quietly shrank the unit totals the whole audit panel is
// built on. Reading the leading number matches what the Python planner has
// always done and is right for every shape above except the variable-unit
// seminars, where no single answer exists.

/** Leading number in a catalog credits value; `fallback` when there is none. */
export const parseCredits = (raw, fallback = 0) => {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : fallback;
  const match = String(raw ?? "").match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : fallback;
};

/**
 * True when a course carries no usable unit count at all — an unverified
 * course the degree audit vouches for but the catalog has never published.
 * These must be counted separately rather than silently treated as 0 units,
 * so the panel can say "plus 2 courses of unknown units" instead of quietly
 * understating how much is left to graduate.
 */
export const hasUnknownCredits = (course) =>
  course?.credits === null ||
  course?.credits === undefined ||
  String(course.credits).trim() === "" ||
  !/\d/.test(String(course.credits));

/**
 * True only when the server flagged the course: an audit-vouched code the
 * catalog has never published, so its name, prereqs and offerings are all
 * genuinely unknown.
 *
 * Deliberately NOT "or its units are unusable". Those are different failures.
 * 67 catalog entries (CSE 105, CSE 120, CSE 130…) carry credits "N/A" because
 * the scraper could not split the units out of a title like
 * "Theory of Computability (4) Tag: Theory/Abstraction" — but their name,
 * description, prerequisites and offered quarters are all present and correct.
 * Folding them in here told students a real, catalog-listed course was
 * "not in the course catalog" and hid the prerequisites we actually had.
 * Unknown units are reported on their own, via hasUnknownCredits.
 */
export const isUnverifiedCourse = (course) => course?.unverified === true;

/**
 * Coerce a course's credits to a number for the planner's arithmetic, WITHOUT
 * inventing one it doesn't have.
 *
 * Every ingest point used to spell this `Number(c.credits) || 0`, which is
 * right for "4" and wrong twice over: it makes a sequence's "4-4-4" worth
 * zero, and it turns an audit-vouched course's honest `null` into a confident
 * `0` that silently shrinks every unit total downstream. Unknown stays null so
 * the UI can render "? u" and the audit panel can count it separately.
 */
export const normalizeCourseCredits = (course) => {
  if (!course) return course;
  return hasUnknownCredits(course)
    ? { ...course, credits: null }
    : { ...course, credits: parseCredits(course.credits) };
};

export default parseCredits;
