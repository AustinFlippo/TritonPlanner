// Degree-audit course ranges: "ECON 100 to ECON 199", "CSE 100TO199",
// "MATH 100-199". The audit prints the endpoints as two course spans with
// "to" between them; without collapsing those into one token the sidebar
// lists only the two endpoints, search cannot expand the band, and a planned
// ECON 120 never credits the requirement.
//
// Canonical stored form is "ECON 100TO199" — the same token
// searchController.recommendCourses already expands. Display formats it as
// "ECON 100–199". Mirrored by _parse_course_range in app/planner_agent.py.

const RANGE_RE =
  /^([A-Z][A-Z&]*)\s+(\d+)([A-Z]*)\s*(?:TO|[-–—])\s*(?:([A-Z][A-Z&]*)\s+)?(\d+)([A-Z]*)$/i;

const CODE_RE = /^([A-Z][A-Z&]*)\s+(\d+)([A-Z]*)$/i;

const tidy = (value = "") =>
  String(value)
    .toUpperCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * { dept, lo, hi } when `token` names a numeric band, otherwise null.
 *
 * Accepts "ECON 100TO199", "ECON 100 TO 199", "ECON 100 TO ECON 199",
 * "ECON 100-199". Cross-department "ECON 100 TO POLI 199" is rejected.
 */
export function parseCourseRange(token) {
  const m = tidy(token).match(RANGE_RE);
  if (!m) return null;
  const dept = m[1].toUpperCase();
  const otherDept = (m[4] || "").toUpperCase();
  if (otherDept && otherDept !== dept) return null;
  let lo = parseInt(m[2], 10);
  let hi = parseInt(m[5], 10);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (lo > hi) [lo, hi] = [hi, lo];
  return { dept, lo, hi };
}

/** Canonical "ECON 100TO199" form, or the original token when it isn't a range. */
export function canonicalRangeToken(token) {
  const range = parseCourseRange(token);
  return range ? `${range.dept} ${range.lo}TO${range.hi}` : token;
}

/**
 * Collapse two endpoint codes into a range token when they share a department.
 * Returns null when they are not a range (different depts, identical codes).
 */
export function courseRangeToken(startCode, endCode) {
  const parse = (code) => {
    const m = tidy(code).match(CODE_RE);
    return m
      ? { dept: m[1].toUpperCase(), n: parseInt(m[2], 10), suffix: (m[3] || "").toUpperCase() }
      : null;
  };
  const a = parse(startCode);
  const b = parse(endCode);
  if (!a || !b || a.dept !== b.dept) return null;
  if (a.n === b.n && a.suffix === b.suffix) return null;
  const lo = a.n <= b.n ? a : b;
  const hi = a.n <= b.n ? b : a;
  return `${a.dept} ${lo.n}${lo.suffix}TO${hi.n}${hi.suffix}`;
}

/** True when the text sitting between two course spans is a range joiner. */
export function isRangeSeparator(text) {
  const sep = String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(to|[-–—])$/i.test(sep);
}

/**
 * Whether a single course id (one alias, not a slash-listing) sits in the
 * band. Department is the leading subject token, matching searchController's
 * deptOf, so "ANSC 185" matches "ANSC 100TO199" and "AAS/ANSC 185" does not
 * until the caller expands aliases.
 */
export function courseFitsRange(courseId, range) {
  if (!range) return false;
  const text = tidy(courseId);
  const dept = (text.match(/^([A-Z]+)/) || [])[1];
  const n = parseInt((text.match(/(\d+)/) || [])[1], 10);
  if (!dept || !Number.isFinite(n)) return false;
  return dept === range.dept && n >= range.lo && n <= range.hi;
}

/** "ECON 100TO199" → "ECON 100–199"; non-ranges pass through. */
export function formatCourseToken(token) {
  const range = parseCourseRange(token);
  if (!range) return token;
  return range.lo === range.hi
    ? `${range.dept} ${range.lo}`
    : `${range.dept} ${range.lo}–${range.hi}`;
}
