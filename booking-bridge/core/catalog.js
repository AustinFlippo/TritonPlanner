/**
 * Catalog helpers.
 *
 * TritonPlanner's catalog (mern/server/controllers/v5.json) is course-level:
 * it knows CSE 101 exists, what it requires, and which quarters it is usually
 * offered. It knows nothing about sections. Section data only exists inside
 * TSS, so everything here operates on the course layer and is deliberately
 * free of any TSS dependency.
 */

/** Canonical form for a course id: "cse 101", "CSE101" -> "CSE 101". */
export function normalizeCourseId(raw) {
  if (!raw) return null;
  const cleaned = String(raw).toUpperCase().replace(/\s+/g, " ").trim();
  // Split a leading alpha subject from the trailing course number. The `0*`
  // drops TSS's zero padding ("AAS-010R" -> "AAS 10R"); the catalog and the
  // planner grid are unpadded, so without it nothing from OData ever matches.
  const match = cleaned.match(/^([A-Z]{2,5})\s*[- ]?\s*0*(\d{1,3}[A-Z]{0,3})$/);
  if (!match) return cleaned || null;
  return `${match[1]} ${match[2]}`;
}

/**
 * Catalog credits are strings and not always a number: "4", "N/A", "2 or 4".
 * Returns { units, variable } — variable courses need the student to choose
 * a credit value at booking time, which TSS prompts for.
 */
export function parseCredits(raw) {
  if (raw === null || raw === undefined) return { units: 0, variable: false };
  const text = String(raw).trim();
  const numbers = text.match(/\d+(?:\.\d+)?/g);
  if (!numbers) return { units: 0, variable: false };
  const values = numbers.map(Number);
  return {
    // For variable-unit courses assume the maximum, so unit-cap math stays
    // conservative rather than optimistically overfilling a pass.
    units: Math.max(...values),
    variable: values.length > 1,
  };
}

// Prerequisite text is prose, e.g.
//   "MATH 10A or MATH 20A; department approval, and corequisite of CSE 4GS."
// We only need the course ids to build a dependency graph, so pull those out
// and ignore the boolean structure. Over-extraction is safer than under- here:
// a spurious edge slightly inflates a course's priority, a missing edge can
// silently let a student defer something that blocks their whole next year.
const COURSE_REF = /\b([A-Z]{2,5})\s?(\d{1,3}[A-Z]{0,3})\b/g;

const NOT_A_SUBJECT = new Set([
  "AND", "OR", "GPA", "UC", "II", "III", "IV", "AP", "IB", "SAT", "ACT",
]);

/** Extract referenced course ids from free-text prerequisites. */
export function extractPrereqIds(text) {
  if (!text) return [];
  const trimmed = String(text).trim();
  if (/^none\.?$/i.test(trimmed)) return [];

  const found = new Set();
  for (const [, subject, number] of trimmed.matchAll(COURSE_REF)) {
    if (NOT_A_SUBJECT.has(subject)) continue;
    found.add(`${subject} ${number}`);
  }
  return [...found];
}

/** Index a raw catalog array by normalized course id. */
export function indexCatalog(entries) {
  const byId = new Map();
  for (const entry of entries || []) {
    const id = normalizeCourseId(entry.course_id);
    if (!id) continue;
    const { units, variable } = parseCredits(entry.credits);
    byId.set(id, {
      id,
      title: entry.course_name || id,
      units,
      variableUnits: variable,
      // Quarters this course is typically offered: ["FA","WI","SP"].
      // An empty array means the catalog does not say — treat as unknown, not
      // as "never offered".
      offerings: Array.isArray(entry.offerings) ? entry.offerings : [],
      prereqIds: extractPrereqIds(entry.prerequisites),
      prereqText: entry.prerequisites || "",
    });
  }
  return byId;
}

/**
 * How many courses elsewhere in the student's own plan depend on this one,
 * transitively. A course that unlocks three later courses is worth booking
 * before an elective that unlocks nothing — this is the number that makes
 * first-pass ordering non-obvious and therefore worth computing.
 */
export function countUnlocks(courseId, plannedIds, catalog) {
  const planned = [...plannedIds].map(normalizeCourseId).filter(Boolean);

  // Reverse edges restricted to courses the student actually plans to take.
  const dependents = new Map();
  for (const id of planned) {
    const entry = catalog.get(id);
    if (!entry) continue;
    for (const prereq of entry.prereqIds) {
      if (!dependents.has(prereq)) dependents.set(prereq, new Set());
      dependents.get(prereq).add(id);
    }
  }

  const seen = new Set();
  const queue = [normalizeCourseId(courseId)];
  while (queue.length) {
    const current = queue.shift();
    for (const dependent of dependents.get(current) || []) {
      if (seen.has(dependent)) continue;
      seen.add(dependent);
      queue.push(dependent);
    }
  }
  return seen.size;
}

/**
 * Offering scarcity, 0..1. A course offered only in fall is far riskier to
 * defer than one offered every quarter: miss it and you wait a full year.
 */
export function scarcityScore(offerings) {
  const count = (offerings || []).length;
  if (count === 0) return 0.5; // unknown — neither penalize nor reward
  if (count >= 3) return 0;
  if (count === 2) return 0.4;
  return 1;
}
