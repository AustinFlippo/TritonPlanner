// One-time harvest of which courses actually ran each quarter, from the
// legacy Schedule of Classes at act.ucsd.edu.
//
// Why one-time: TSS replaced this system in July 2026 and the legacy term
// list ends at Summer 2026 — it will never gain new terms, but it still
// serves FA24..SU26 publicly (no auth). We mine that window for real
// offering patterns and commit the result; there is nothing to re-run later.
//
// Endpoints (all public):
//   subject-list.json?selectedTerm=T              -> [{code: "CSE ", ...}]
//   scheduleOfClassesStudentResult.htm?selectedTerm=T&selectedSubjects=S&page=N
//     -> HTML; each listed course has a <td class="crsheader">NUMBER</td>
//        cell. One subject per query, so SUBJECT + NUMBER identifies the
//        course. Pages are walked until one comes back empty.
//
// Usage:  node scripts/scrape-offerings.mjs [TERM ...]   (default FA24..SP26)
// Output: scripts/data/offerings-history.json
//         { terms_done: [...], courses: { "CSE 100": ["FA24", "SP25", ...] } }
//
// Progress is saved after every term, so an interrupted run resumes by
// skipping terms already in terms_done.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "data");
const outPath = path.join(outDir, "offerings-history.json");

const BASE = "https://act.ucsd.edu/scheduleOfClasses";
const UA = "TritonPlanner offerings harvest (student project; contact smahadkar@ucsd.edu)";
const DELAY_MS = 120;

const DEFAULT_TERMS = ["FA24", "WI25", "SP25", "FA25", "WI26", "SP26"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt >= 3) throw new Error(`${e.message} for ${url}`);
      await sleep(1000 * attempt);
    }
  }
}

const NUM_RE = /<td\s+class="crsheader">(\d+[A-Z]*)<\/td>/g;

async function subjectsFor(term) {
  const json = await get(`${BASE}/subject-list.json?selectedTerm=${term}`);
  return JSON.parse(json).map((s) => s.code.trim()).filter(Boolean);
}

async function coursesFor(term, subject) {
  const found = new Set();
  const pageUrl = (page) =>
    `${BASE}/scheduleOfClassesStudentResult.htm?selectedTerm=${term}` +
    `&selectedSubjects=${encodeURIComponent(subject)}&page=${page}`;

  // Requesting a page past the end returns HTTP 500, so read the page count
  // from the first page's pagination links instead of probing until failure.
  const first = await get(pageUrl(1));
  for (const m of first.matchAll(NUM_RE)) found.add(`${subject} ${m[1]}`);
  const maxPage = Math.max(1, ...[...first.matchAll(/page=(\d+)/g)].map((m) => Number(m[1])));

  for (let page = 2; page <= maxPage; page++) {
    await sleep(DELAY_MS);
    const html = await get(pageUrl(page));
    for (const m of html.matchAll(NUM_RE)) found.add(`${subject} ${m[1]}`);
  }
  return found;
}

async function main() {
  const terms = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TERMS;
  fs.mkdirSync(outDir, { recursive: true });
  const state = fs.existsSync(outPath)
    ? JSON.parse(fs.readFileSync(outPath, "utf-8"))
    : { terms_done: [], courses: {} };

  for (const term of terms) {
    if (state.terms_done.includes(term)) {
      console.log(`${term}: already done, skipping`);
      continue;
    }
    const subjects = await subjectsFor(term);
    console.log(`${term}: ${subjects.length} subjects`);
    let termCourses = 0;
    for (let i = 0; i < subjects.length; i++) {
      const found = await coursesFor(term, subjects[i]);
      for (const key of found) {
        (state.courses[key] ??= []).includes(term) || state.courses[key].push(term);
      }
      termCourses += found.size;
      if ((i + 1) % 20 === 0) console.log(`  ${term} ${i + 1}/${subjects.length} subjects, ${termCourses} courses so far`);
    }
    state.terms_done.push(term);
    fs.writeFileSync(outPath, JSON.stringify(state, null, 1));
    console.log(`${term}: ${termCourses} course listings, saved`);
  }
  console.log(`\nDone. ${Object.keys(state.courses).length} distinct courses across ${state.terms_done.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
