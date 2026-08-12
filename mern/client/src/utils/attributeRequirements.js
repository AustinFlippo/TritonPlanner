// Requirements the degree audit prints WITHOUT an "Available:" course list —
// either attribute-based (satisfied by any course carrying an approved tag)
// or delegated to an external web page ("For a list of courses, please go
// to..."). The tracker matches planned courses against the audit's printed
// list, so without help these sections could never be projected as
// fulfilled. This registry supplies the known lists.
//
// Title regexes are tested against raw audit titles, which are often mashed
// together without spaces ("...RequirementsFor a list of courses...").
//
// Mirrored in app/planner_agent.py (_ATTRIBUTE_REQUIREMENTS) — keep in sync.
//
// Sources (fetched Aug 2026; refresh when the pages change):
// - JTCCER: https://undergrad.ucsd.edu/academics/jtccer.html
//   Jane Teranes Climate Change Education Requirement. Applies to first-time
//   first-years entering Fall 2024+; Senate adds courses over time.
// - Eighth College GE: https://eighth.ucsd.edu/academics/degree-requirements/first-year.html
//   First-year requirement is the Critical Community Engagement sequence
//   (CCE 1, 2, 3, then the CCE 120 capstone); transfers take CCE 110 + 120.
//   CCE 110/120 are absent from catalog.ucsd.edu and reach v5.json through
//   scripts/data/catalog-supplement.json.

export const JTCCER_COURSES = [
  "ASTR 65",
  "CGS 134",
  "ECON 131",
  "ENVR 30",
  "MCWP 40C",
  "MMW 15",
  "PHIL 51",
  "PHYS 12",
  "POLI 117R",
  "SIO 3",
  "SIO 15",
  "SIO 20R",
  "SIO 30",
  "SIO 35",
  "SIO 40",
  "SIO 102",
  "SIO 109R",
  "SYN 2",
  "SYN 150",
  "USP 171",
  "ANTH 10",
  "ANTH 109",
  "ANTH 111",
  "HILD 43",
  "PHIL 148",
];

// CCE 110 is the transfer-track substitute for CCE 1-3; both tracks end in
// CCE 120. The audit prints one Eighth GE section either way, so the list
// carries every course that can satisfy it.
export const EIGHTH_GE_COURSES = ["CCE 1", "CCE 2", "CCE 3", "CCE 110", "CCE 120"];

const ATTRIBUTE_REQUIREMENTS = [
  { titleRe: /climate\s*change|teranes|jtccer/i, courses: JTCCER_COURSES },
  { titleRe: /eighth\s*college\s*general\s*education/i, courses: EIGHTH_GE_COURSES },
];

// The approved-course list for a list-less requirement, or null when the
// section isn't one we know.
export const attributeCourseList = (sectionTitle) =>
  ATTRIBUTE_REQUIREMENTS.find((r) => r.titleRe.test(sectionTitle || ""))
    ?.courses ?? null;

// Whether a parsed audit token plausibly names a course ("CCE 3",
// "DSC 80/80R") rather than junk lifted from a "see this website" note
// ("GO TOHTTP"). Decides when the approved list above may substitute for the
// audit's own list: only when the audit printed nothing usable. When the
// audit names real courses, its list is authoritative — widening it makes a
// row like "CCE 3" demand the whole CCE sequence.
export const looksLikeCourseCode = (value = "") =>
  /^[A-Z]{2,6}\s*\d/.test(
    String(value).replace(/\u00a0/g, " ").trim().toUpperCase()
  );
