// Cross-listing alias expansion for course ids. Port of
// mern/server/scripts/lib/course-ids.mjs (also mirrored in app/catalog.py) —
// keep the three in sync.
//
// Segments of a slashed cross-listing: "COM GEN 194" (subject(s) + number),
// "ANSC" (bare subject — borrows the NEXT segment's number, as in
// "AAS/ANSC 185"), "267" (bare number — borrows the PREVIOUS segment's
// subject, as in "HIUS 167/267/ETHN 180").
export function aliasesFor(courseId) {
  const aliases = [courseId];
  const segments = courseId.split("/").map((s) => s.trim());
  if (segments.length < 2) return aliases;
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
      return aliases; // unparseable segment: no expansion
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
  return aliases;
}
