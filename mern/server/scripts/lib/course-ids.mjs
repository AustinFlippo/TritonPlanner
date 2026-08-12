// Course-id helpers shared by the catalog scripts.
// Extracted verbatim from build-prereq-graph.mjs so every script resolves
// cross-listed ids ("AAS/ANSC 185", "CHIN 160/260", "EDS 31/CHEM 96") the
// same way.

export const normalize = (s) => s.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

// A section-variant suffix: "R" (remote) or "GS" (global seminar) sections of
// an otherwise ordinary course. The General Catalog usually lists only the
// base course, but a degree audit prints whichever variant the student took
// or may take ("MUS 20R", "MUS 8GS"), so a variant must also answer to its
// base number. Deliberately limited to these two suffixes: a trailing letter
// is normally part of the number itself ("DSC 140A", "MATH 20B") and
// stripping it would name a different course. Because a base alias only ever
// fills a slot no canonical id claimed, this never shadows a real course.
const SECTION_VARIANT_RE = /^([A-Z]+(?: [A-Z]+)* \d+[A-Z]?)(?:R|GS)$/i;

// A multi-quarter sequence, which the catalog publishes as ONE dash-joined
// entry ("HILD 2A-B-C", "JAPN 150A-B-C", "MUS 201A-B-C-D-E-F") while degree
// audits, the Schedule of Classes and students all name the individual
// quarters ("HILD 2A"). 59 catalog entries use this notation and between them
// they hide 155 real courses that were otherwise unreachable — including by
// course search, which builds its alias index from aliasesFor.
export const SEQUENCE_RE = /^([A-Z]+(?: [A-Z]+)*) (\d+)([A-Z])((?:-[A-Z])+)$/i;

// ["HILD 2A", "HILD 2B", "HILD 2C"] for "HILD 2A-B-C"; [] if not one.
export const sequenceMembers = (courseId) => {
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

// Segments of a slashed cross-listing: "COM GEN 194" (subject(s) + number),
// "ANSC" (bare subject — borrows the NEXT segment's number, as in
// "AAS/ANSC 185"), "267" (bare number — borrows the PREVIOUS segment's
// subject, as in "HIUS 167/267/ETHN 180").
// Ported to app/catalog.py (aliases_for) and mern/client/src/utils/courseIds.js
// — keep the three in sync.
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
