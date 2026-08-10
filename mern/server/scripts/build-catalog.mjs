// Assembles controllers/v5.json from the two scraped sources plus the parts
// of the previous v5 worth carrying forward. Run after:
//   node scripts/scrape-catalog.mjs      (fresh course facts, any time)
//   node scripts/scrape-offerings.mjs    (one-time FA24..SP26 harvest)
// and follow with:
//   node scripts/build-prereq-graph.mjs  (regenerates the prereq graph)
//
// Merge rules, per course (matched by normalized id):
//   - course facts (name, description, credits, prerequisites): fresh catalog
//   - professors: carried over from the previous v5 (RateMyProfessors data
//     with no scraper of its own; refreshing it is a separate project)
//   - offerings: quarters (FA/WI/SP) the course actually ran in the harvested
//     terms; courses never seen in the harvest keep their previous offerings
//     (the old catalog's "typically offered" guess) rather than dropping to
//     empty. Summer-only evidence lives in offerings-history.json but is not
//     written to `offerings`, whose consumers only know FA/WI/SP.
//
// Courses that left the catalog are dropped; new ones arrive with empty
// professors. The output schema is byte-compatible with the old v5.json.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalize, aliasesFor } from "./lib/course-ids.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const freshPath = path.join(here, "data", "catalog-scrape.json");
const historyPath = path.join(here, "data", "offerings-history.json");
const v5Path = path.join(here, "..", "controllers", "v5.json");

const fresh = JSON.parse(fs.readFileSync(freshPath, "utf-8"));
const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
const old = JSON.parse(fs.readFileSync(v5Path, "utf-8"));

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

// ---------------------------------------------------------------------------
let carriedProfessors = 0;
let observedOfferings = 0;
let keptOldOfferings = 0;

const merged = fresh.map((c) => {
  const prev = oldById.get(c.normalized_course_id);
  const professors = prev?.professors?.length ? prev.professors : [];
  if (professors.length) carriedProfessors++;

  let offerings;
  const seen = observed.get(c.normalized_course_id);
  if (seen) {
    offerings = ["FA", "WI", "SP"].filter((q) => seen.has(q));
    observedOfferings++;
  } else {
    offerings = prev?.offerings ?? [];
    if (offerings.length) keptOldOfferings++;
  }

  return { ...c, professors, offerings };
});

fs.writeFileSync(v5Path, JSON.stringify(merged));

// ---------------------------------------------------------------------------
const dropped = old.filter((c) => !aliasIndex.has(normalize(c.course_id))).length;
const added = merged.filter((c) => !oldById.has(c.normalized_course_id)).length;
console.log(`Wrote ${merged.length} courses to ${v5Path}`);
console.log(`  vs previous v5: +${added} new, -${dropped} dropped (catalog churn)`);
console.log(`  offerings: ${observedOfferings} from ${history.terms_done.join("/")} evidence, ` +
  `${keptOldOfferings} kept from old catalog, ` +
  `${merged.filter((c) => !c.offerings.length).length} unknown`);
console.log(`  professors carried over: ${carriedProfessors}`);
console.log(`  SoC listings with no catalog entry: ${unresolved} (mostly retired or non-catalog codes)`);
console.log(`\nNow run: node scripts/build-prereq-graph.mjs`);
