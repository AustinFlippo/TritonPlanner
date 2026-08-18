// Cross-listing alias expansion for course ids. Port of
// mern/server/scripts/lib/course-ids.mjs (also mirrored in app/catalog.py).
// Conformance across the three ports is enforced by
// shared/course-alias-cases.json (see courseIds.test.mjs) — change one port,
// change all three, and add a case there. crossListingAliases.js is the reverse index
// (alias → canonical id) for rows that contain "/"; rebuild it from v5.json
// when catalog cross-listings change.
//
// Segments of a slashed cross-listing: "COM GEN 194" (subject(s) + number),
// "ANSC" (bare subject — borrows the NEXT segment's number, as in
// "AAS/ANSC 185"), "267" (bare number — borrows the PREVIOUS segment's
// subject, as in "HIUS 167/267/ETHN 180").

import crossListingAliases from "./crossListingAliases.js";

// A section-variant suffix: "R" (remote) or "GS" (global seminar) sections of
// an otherwise ordinary course. The General Catalog usually lists only the
// base course, but a degree audit prints whichever variant the student took
// or may take ("MUS 20R", "MUS 8GS"), so a variant must also answer to its
// base number. Deliberately limited to these two suffixes: a trailing letter
// is normally part of the number itself ("DSC 140A", "MATH 20B") and
// stripping it would name a different course.
// Mirrored in app/catalog.py and scripts/lib/course-ids.mjs — keep in sync.
const SECTION_VARIANT_RE = /^([A-Z]+(?: [A-Z]+)* \d+[A-Z]?)(?:R|GS)$/i;

// A multi-quarter sequence, which the catalog publishes as ONE dash-joined
// entry ("HILD 2A-B-C", "JAPN 150A-B-C", "MUS 201A-B-C-D-E-F") while degree
// audits, the Schedule of Classes and students all name the individual
// quarters ("HILD 2A"). 59 catalog entries use this notation and between them
// they hide 155 real courses. Mirrored in app/catalog.py and course-ids.mjs.
const SEQUENCE_RE = /^([A-Z]+(?: [A-Z]+)*) (\d+)([A-Z])((?:-[A-Z])+)$/i;

// ["HILD 2A", "HILD 2B", "HILD 2C"] for "HILD 2A-B-C"; [] if not one.
const sequenceMembers = (courseId) => {
  const m = SEQUENCE_RE.exec(courseId || "");
  if (!m) return [];
  const [, subject, number, first, rest] = m;
  return [first, ...rest.split("-").filter(Boolean)].map(
    (letter) => `${subject} ${number}${letter}`
  );
};

// Each alias plus the other ids it answers to — the quarters of a sequence
// entry, and the base of a section variant — order-preserving so the code as
// written always resolves first.
const withVariants = (aliases) => {
  const out = [];
  for (const alias of aliases) {
    for (const code of [alias, ...sequenceMembers(alias)]) {
      const m = SECTION_VARIANT_RE.exec(code || "");
      for (const candidate of m ? [code, m[1]] : [code]) {
        if (candidate && !out.includes(candidate)) out.push(candidate);
      }
    }
  }
  return out;
};

export function aliasesFor(courseId) {
  const aliases = [courseId];
  const segments = courseId.split("/").map((s) => s.trim());
  if (segments.length < 2) return withVariants(aliases);
  const subjects = [];
  const numbers = [];
  for (const seg of segments) {
    const m = seg.match(/^([A-Z]+(?: [A-Z]+)*) (\d\S*)$/);
    if (m) {
      subjects.push(m[1]);
      numbers.push(m[2]);
    } else if (/^[A-Z]+(?: [A-Z]+)*$/.test(seg)) {
      subjects.push(seg);
      numbers.push(null);
    } else if (/^\d\S*$/.test(seg)) {
      subjects.push(null);
      numbers.push(seg);
    } else {
      return withVariants(aliases); // unparseable segment: no expansion
    }
  }
  // Bare numbers inherit their subject from the left; bare subjects inherit
  // their number from the right.
  for (let i = 1; i < subjects.length; i++) {
    if (subjects[i] === null) subjects[i] = subjects[i - 1];
  }
  for (let i = numbers.length - 2; i >= 0; i--) {
    if (numbers[i] === null) numbers[i] = numbers[i + 1];
  }
  for (let i = 0; i < segments.length; i++) {
    if (subjects[i] && numbers[i]) aliases.push(`${subjects[i]} ${numbers[i]}`);
  }
  return withVariants(aliases);
}

const normalizeKey = (value = "") =>
  String(value)
    .toUpperCase()
    .replace(/\u00a0/g, " ")
    .replace(/[^A-Z0-9]/g, "")
    .toLowerCase();

/**
 * Resolve a course token to its catalog canonical id when it is a known
 * cross-listing alias ("DSC 80" / "DSC 80R" → "DSC 80/80R"). Mirrors
 * app/catalog.py get_course(...).course_id for cross-listed rows only.
 */
export function canonicalCourseId(courseId) {
  if (!courseId) return null;
  const hit = crossListingAliases[normalizeKey(courseId)];
  return hit || null;
}

/**
 * Every normalized form that should match for requirement / section equality:
 * slash expansion of the token itself, plus slash expansion of its catalog
 * canonical id when the token is a known alias. This is how JS matches
 * Python's _codes_match (catalog round-trip) without loading v5.json.
 */
export function courseIdVariants(courseId) {
  const variants = new Set();
  const seed = String(courseId || "")
    .toUpperCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^([A-Z]{2,6})\s*(\d)/, "$1 $2")
    .trim();
  if (!seed) return variants;
  const canonical = canonicalCourseId(seed);
  for (const form of [seed, canonical].filter(Boolean)) {
    for (const alias of aliasesFor(form)) {
      variants.add(
        String(alias)
          .toUpperCase()
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .replace(/^([A-Z]{2,6})\s*(\d)/, "$1 $2")
          .trim()
      );
    }
  }
  return variants;
}

/** True when two written codes name the same course, including cross-listings. */
export function namesSameCourse(a, b) {
  if (!a || !b) return false;
  const other = courseIdVariants(b);
  for (const variant of courseIdVariants(a)) {
    if (other.has(variant)) return true;
  }
  return false;
}

/**
 * True when `courseId` is one the student has already finished or is currently
 * taking. `takenIds` is typically extractCompletedCourses() — failed attempts
 * are omitted there so a retake can still be planned.
 */
export function isTakenCourse(courseId, takenIds = []) {
  if (!courseId) return false;
  return takenIds.some((id) => namesSameCourse(courseId, id));
}
