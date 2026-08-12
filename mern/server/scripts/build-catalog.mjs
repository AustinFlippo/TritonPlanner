// Assembles controllers/v5.json from the scraped sources plus the parts
// of the previous v5 worth carrying forward. Run after:
//   node scripts/scrape-catalog.mjs        (fresh course facts, any time)
//   node scripts/scrape-offerings.mjs      (one-time FA24..SP26 harvest)
//   node scripts/scrape-instructors.mjs    (one-time FA24..SP26 harvest)
//   node scripts/scrape-professors-rmp.mjs (fresh RMP ratings, any time)
// and follow with:
//   node scripts/build-prereq-graph.mjs  (regenerates the prereq graph)
//
// Merge rules, per course (matched by normalized id):
//   - course facts (name, description, credits, prerequisites): fresh catalog
//   - professors: joined from who taught the course (instructors-history.json)
//     to their RateMyProfessors page (professors-rmp.json), on name. Courses
//     with no harvested instructor keep their previous professors rather than
//     dropping to empty, the same policy offerings uses below. Before Aug 2026
//     this field was copied from the previous v5 forever, with no scraper of
//     its own; both halves are now refreshable.
//   - offerings: quarters (FA/WI/SP) the course actually ran in the harvested
//     terms; courses never seen in the harvest keep their previous offerings
//     (the old catalog's "typically offered" guess) rather than dropping to
//     empty. Summer-only evidence lives in offerings-history.json but is not
//     written to `offerings`, whose consumers only know FA/WI/SP.
//
// Courses that left the catalog are dropped; new ones arrive with empty
// professors. The output schema is byte-compatible with the old v5.json.
//
// data/catalog-supplement.json patches the one hole in that flow: a course
// UCSD teaches but has not published in the General Catalog (CCE 120 has run
// since FA25 and is still absent from catalog.ucsd.edu/courses/CCE.html). The
// scrape cannot see those, so they are hand-written there and folded in below.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalize, aliasesFor } from "./lib/course-ids.mjs";
import {
  departmentsForCourse,
  indexProfessors,
  matchInstructor,
  toV5Professor,
  toV5Unrated,
} from "./lib/professor-names.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const freshPath = path.join(here, "data", "catalog-scrape.json");
const supplementPath = path.join(here, "data", "catalog-supplement.json");
const historyPath = path.join(here, "data", "offerings-history.json");
const instructorsPath = path.join(here, "data", "instructors-history.json");
const rmpPath = path.join(here, "data", "professors-rmp.json");
const upcomingPath = path.join(here, "data", "upcoming-term.json");
const v5Path = path.join(here, "..", "controllers", "v5.json");

// catalog.ucsd.edu prints alternate-format sections inside the title line:
//   "POLI 13 or 13R or 13D or 13DR. Power and Justice"
// The scrape splits id from title on the first ". ", so the id keeps only
// "POLI 13" and the alternates strand at the head of the course NAME. That
// left "POLI 13R" unresolvable and put "or 13R or 13D or 13DR." in front of
// the title everywhere it is displayed. Fold the alternates back into the id
// as a slashed cross-listing — the same shape as "DSC 80/80R", which
// aliasesFor already expands — and hand the course its real title back.
const ALTERNATES_PREFIX_RE = /^((?:or\s+\d+[A-Z]*\s*)+)\.\s*/i;

function recoverAlternateIds(course) {
  const match = (course.course_name || "").match(ALTERNATES_PREFIX_RE);
  if (!match) return course;
  const alternates = match[1].match(/\d+[A-Z]*/g) || [];
  if (!alternates.length) return course;
  const courseId = [course.course_id, ...alternates].join("/");
  // Spread first so the key order stays byte-compatible with the old schema.
  return {
    ...course,
    course_id: courseId,
    normalized_course_id: normalize(courseId),
    course_name: course.course_name.slice(match[0].length).trim(),
  };
}

const scraped = JSON.parse(fs.readFileSync(freshPath, "utf-8")).map(
  recoverAlternateIds,
);
const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
const old = JSON.parse(fs.readFileSync(v5Path, "utf-8"));

// Both halves of the professor join are optional: a checkout that has not run
// the two scrapers yet still builds a correct v5, it just carries the previous
// professors through untouched (the pre-Aug-2026 behaviour).
const readIfPresent = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : null);
const instructorHistory = readIfPresent(instructorsPath);
const rmp = readIfPresent(rmpPath);
const upcoming = readIfPresent(upcomingPath);
const canJoinProfessors = Boolean(instructorHistory && rmp);

// Hand-written entries for courses the General Catalog has not published yet.
// An entry is ignored the moment the scrape carries the same course, so this
// file self-empties as UCSD catches up rather than shadowing real data.
const supplement = fs.existsSync(supplementPath)
  ? JSON.parse(fs.readFileSync(supplementPath, "utf-8")).courses
  : [];
const scrapedIds = new Set(scraped.map((c) => c.normalized_course_id));
const supplemented = supplement.filter((c) => !scrapedIds.has(c.normalized_course_id));
// `_provenance` documents the entry for a human; it never reaches v5.json.
const fallbackOfferings = new Map(
  supplemented.map((c) => [c.normalized_course_id, c.offerings ?? []]),
);
const fresh = [...scraped, ...supplemented.map(({ _provenance, ...c }) => c)].sort((a, b) =>
  a.course_id.localeCompare(b.course_id),
);

const QUARTER_OF = { FA: "FA", WI: "WI", SP: "SP", S1: "SU", S2: "SU", S3: "SU", SA: "SU", SU: "SU" };
const termQuarter = (term) => QUARTER_OF[term.slice(0, 2)];

// ---------------------------------------------------------------------------
const oldById = new Map(old.map((c) => [c.normalized_course_id, c]));

// Alias index over the fresh catalog, so a Schedule of Classes listing of
// "ANSC 185" credits the "AAS/ANSC 185" catalog entry.
const aliasIndex = new Map();
for (const c of fresh) {
  for (const alias of aliasesFor(c.course_id)) {
    const key = normalize(alias);
    if (key && !aliasIndex.has(key)) aliasIndex.set(key, c.normalized_course_id);
  }
}

// Observed quarters per course from the harvest.
const observed = new Map(); // normalized id -> Set of "FA"|"WI"|"SP"|"SU"
let unresolved = 0;
for (const [courseKey, terms] of Object.entries(history.courses)) {
  const id = aliasIndex.get(normalize(courseKey));
  if (!id) {
    unresolved++;
    continue;
  }
  const set = observed.get(id) ?? new Set();
  for (const t of terms) set.add(termQuarter(t));
  observed.set(id, set);
}

// Course -> RMP pages, newest instructor first. A course lists whoever taught
// it in the harvested window, so a student sees the people they might actually
// get; ordering by most recent term keeps the current instructor at the top.
const QUARTER_RANK = { WI: 1, SP: 2, S1: 3, S2: 3, S3: 3, SA: 3, SU: 3, FA: 4 };
const termOrder = (t) => Number(t.slice(2)) * 10 + (QUARTER_RANK[t.slice(0, 2)] ?? 0);

const professorsByCourse = new Map(); // normalized id -> v5 professor objects
const unmatchedNames = new Set(); // SoC instructors with no RMP page
// Courses the harvest actually saw an instructor for. The join is authoritative
// for these even when it comes back empty — see the carry-forward rule below.
const harvestedCourses = new Set();

if (canJoinProfessors) {
  const bySurname = indexProfessors(rmp.professors);
  const matchCache = new Map();
  // Keyed by course subject as well as name: two same-surname colleagues who
  // both match are separated by which department the course belongs to, so the
  // answer is per subject, not per name.
  const lookup = (name, courseKey) => {
    const departments = departmentsForCourse(courseKey);
    const cacheKey = `${departments[0] || ""}|${name}`;
    if (!matchCache.has(cacheKey)) {
      matchCache.set(cacheKey, matchInstructor(name, bySurname, departments));
    }
    return matchCache.get(cacheKey);
  };

  for (const [courseKey, taughtBy] of Object.entries(instructorHistory.courses)) {
    const id = aliasIndex.get(normalize(courseKey));
    if (!id) continue; // same retired/non-catalog codes the offerings join drops
    harvestedCourses.add(id);
    // Two SoC spellings of one person ("Jones, Miles E" and "Jones, Miles")
    // resolve to the same page, so key by RMP id and keep the latest term.
    const byRmpId = professorsByCourse.has(id)
      ? professorsByCourse.get(id)
      : new Map();
    for (const [name, terms] of Object.entries(taughtBy)) {
      const hit = lookup(name, courseKey);
      if (!hit) {
        unmatchedNames.add(name);
        continue;
      }
      const recency = Math.max(...terms.map(termOrder));
      const prev = byRmpId.get(hit.legacy_id);
      if (!prev || recency > prev.recency) byRmpId.set(hit.legacy_id, { hit, recency });
    }
    professorsByCourse.set(id, byRmpId);
  }

  // Freeze each course's map into the ordered array v5 stores.
  for (const [id, byRmpId] of professorsByCourse) {
    const ordered = [...byRmpId.values()]
      .sort((a, b) => b.recency - a.recency || b.hit.num_ratings - a.hit.num_ratings)
      .map(({ hit }) => toV5Professor(hit));
    professorsByCourse.set(id, ordered);
  }
}

// The upcoming term outranks all of the above: for a course a student can
// actually enrol in next quarter, "who is teaching it" is a known fact rather
// than an inference from history, and it is exactly the case where the ratings
// matter most. Courses not on next term's schedule fall through to the
// historical join and are labelled so the UI can say so.
const upcomingByCourse = new Map(); // normalized id -> v5 professor objects
if (upcoming && rmp) {
  const bySurname = indexProfessors(rmp.professors);
  const matchCache = new Map();
  for (const [courseKey, sections] of Object.entries(upcoming.courses)) {
    const id = aliasIndex.get(normalize(courseKey));
    if (!id) continue;
    // One name per person across the course's sections — a lecturer with three
    // discussions is one professor, not three.
    const names = [...new Set(sections.map((s) => s.instructor).filter(Boolean))];
    if (!names.length) continue;
    const departments = departmentsForCourse(courseKey);
    const seen = new Map();
    for (const name of names) {
      const cacheKey = `${departments[0] || ""}|${name}`;
      if (!matchCache.has(cacheKey)) {
        matchCache.set(cacheKey, matchInstructor(name, bySurname, departments));
      }
      const hit = matchCache.get(cacheKey);
      // An instructor with no RMP page still belongs on the list — the student
      // is being taught by them either way — so carry a name-only entry rather
      // than silently dropping them and implying nobody teaches the course.
      if (hit) seen.set(hit.legacy_id, toV5Professor(hit));
      else if (!seen.has(name)) seen.set(name, toV5Unrated(name));
    }
    if (seen.size) upcomingByCourse.set(id, [...seen.values()]);
  }
}

// ---------------------------------------------------------------------------
let carriedProfessors = 0;
let droppedStaleProfessors = 0;
let observedOfferings = 0;
let keptOldOfferings = 0;

// Alias-aware so a course whose id gained cross-listing segments this build
// ("POLI 13" -> "POLI 13/13R/13D/13DR") still matches its previous row and
// keeps its professors instead of reading as one drop plus one new course.
const previousRow = (c) => {
  const direct = oldById.get(c.normalized_course_id);
  if (direct) return direct;
  for (const alias of aliasesFor(c.course_id)) {
    const hit = oldById.get(normalize(alias));
    if (hit) return hit;
  }
  return undefined;
};

let joinedProfessors = 0;
let upcomingProfessors = 0;

const merged = fresh.map((c) => {
  const prev = previousRow(c);

  // Precedence: next term's actual staff, then the historical join, then
  // whatever the previous v5 had. `professors_source` records which, so the UI
  // can distinguish "this is who teaches it" from "this is who used to".
  const next = upcomingByCourse.get(c.normalized_course_id);
  const joined = professorsByCourse.get(c.normalized_course_id);
  let professors;
  let professorsSource;
  if (next?.length) {
    professors = next;
    professorsSource = upcoming.term_code;
    upcomingProfessors++;
  } else if (joined?.length) {
    professors = joined;
    professorsSource = "historic";
    joinedProfessors++;
  } else if (harvestedCourses.has(c.normalized_course_id)) {
    // The harvest knows who taught this course and none of them have an RMP
    // page. Carrying the previous v5's list forward here would resurrect
    // exactly the matches a tightened matcher just rejected: MATH 213's only
    // instructor is "Cho, Hyun Keun", and the wrong Cho survived the fix by
    // coming back through this branch. Fresh evidence wins even when empty.
    professors = [];
    professorsSource = null;
    droppedStaleProfessors += prev?.professors?.length ? 1 : 0;
  } else {
    professors = prev?.professors?.length ? prev.professors : [];
    professorsSource = professors.length ? "historic" : null;
    if (professors.length) carriedProfessors++;
  }

  let offerings;
  const seen = observed.get(c.normalized_course_id);
  if (seen) {
    offerings = ["FA", "WI", "SP"].filter((q) => seen.has(q));
    observedOfferings++;
  } else {
    // Supplement entries predate the harvest window, so they carry their own
    // offerings from the department's published schedule.
    offerings = prev?.offerings ?? fallbackOfferings.get(c.normalized_course_id) ?? [];
    if (offerings.length) keptOldOfferings++;
  }

  return { ...c, professors, professors_source: professorsSource, offerings };
});

fs.writeFileSync(v5Path, JSON.stringify(merged));

// ---------------------------------------------------------------------------
const dropped = old.filter((c) => !aliasIndex.has(normalize(c.course_id))).length;
const added = merged.filter((c) => !oldById.has(c.normalized_course_id)).length;
console.log(`Wrote ${merged.length} courses to ${v5Path}`);
console.log(`  catalog-supplement: ${supplemented.length} of ${supplement.length} entries used ` +
  `(${supplement.length - supplemented.length} now published in the catalog — prune them)`);
console.log(`  vs previous v5: +${added} new, -${dropped} dropped (catalog churn)`);
console.log(`  offerings: ${observedOfferings} from ${history.terms_done.join("/")} evidence, ` +
  `${keptOldOfferings} kept from old catalog, ` +
  `${merged.filter((c) => !c.offerings.length).length} unknown`);
if (upcoming) {
  console.log(
    `  professors (${upcoming.term_code}): ${upcomingProfessors} courses staffed from ` +
      `UCSD Class Planner, refreshed ${upcoming.source_refreshed_at}`,
  );
}
if (canJoinProfessors) {
  console.log(
    `  professors (historic): ${joinedProfessors} joined from ` +
      `${instructorHistory.terms_done.join("/")} instructors x ${rmp.professors.length} RMP pages, ` +
      `${carriedProfessors} kept from previous v5 (course not taught in the window)`,
  );
  console.log(
    `    ${droppedStaleProfessors} courses dropped a previous professor list ` +
      `(the harvest names their instructor and no RMP page matches them)`,
  );
  console.log(
    `    ${unmatchedNames.size} instructor names had no RMP page ` +
      `(expected — many instructors are simply unrated)`,
  );
} else {
  console.log(`  professors carried over: ${carriedProfessors} ` +
    `(run scrape-instructors.mjs + scrape-professors-rmp.mjs to refresh them)`);
}
console.log(`  SoC listings with no catalog entry: ${unresolved} (mostly retired or non-catalog codes)`);
console.log(`\nNow run: node scripts/build-prereq-graph.mjs`);
