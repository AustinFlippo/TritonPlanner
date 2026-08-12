// Harvests who actually taught each course, per term, from the legacy
// Schedule of Classes at act.ucsd.edu.
//
// Why this exists: v5.json's `professors` field is a course -> RateMyProfessors
// mapping, but only the RMP half can be refreshed on its own (see
// scrape-professors-rmp.mjs). The other half — which professor teaches which
// course — has no other public source. This rebuilds it.
//
// Why it is urgent: same clock as scrape-offerings.mjs. TSS replaced this
// system in July 2026, the legacy term list ends at Summer 2026, and section
// data everywhere else is behind SAML. When act.ucsd.edu goes, the only
// public course -> instructor mapping at UCSD goes with it. Commit the output.
//
// Page shape (same endpoints scrape-offerings.mjs walks):
//   <td class="crsheader">100</td>        -> course number, sets the current
//                                            course for the rows beneath it
//   <tr class="sectxt"> ... 13 <td>s ...  -> one section; cell 9 is the
//                                            instructor, "Last, First M"
//   <tr class="nonenrtxt"> ... 10 <td>s   -> final exam rows, no instructor
//
// Usage:  node scripts/scrape-instructors.mjs [TERM ...]   (default FA24..SP26)
// Output: scripts/data/instructors-history.json
//         { terms_done: [...], courses: { "CSE 100": { "Bonjour, Trevor": ["SP26"] } } }
//
// Progress is saved after every term, so an interrupted run resumes by
// skipping terms already in terms_done.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "data");
const outPath = path.join(outDir, "instructors-history.json");

const BASE = "https://act.ucsd.edu/scheduleOfClasses";
const UA = "TritonPlanner instructor harvest (student project; contact smahadkar@ucsd.edu)";
const DELAY_MS = 120;

// act.ucsd.edu answers a result page in ~7s regardless of how little is asked
// of it, so a serial walk of 6 terms x ~185 subjects runs for hours. The wait
// is server-side latency rather than load, so a handful of subjects in flight
// at once collapses the wall clock without leaning on the box — this is well
// under what a browser opens against the same host. Keep it small: the point
// is to finish before the system is retired, not to go as fast as possible.
const CONCURRENCY = 5;

const DEFAULT_TERMS = ["FA24", "WI25", "SP25", "FA25", "WI26", "SP26"];

// Runs `worker` over `items` with at most CONCURRENCY in flight, preserving
// nothing about order — callers merge results as they land.
async function pool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

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

const ROW_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
const CELL_RE = /<td[^>]*>([\s\S]*?)<\/td>/g;
const CRSHEADER_RE = /<td\s+class="crsheader">(\d+[A-Z]*)<\/td>/;
const SECTXT_RE = /class="sectxt"/;

const text = (html) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

// "Bonjour, Trevor", "Jones, Miles E", "Newhouse, Herbert S". Staff-taught and
// unassigned sections show "Staff" or an empty cell; neither names a person, so
// both are dropped rather than stored as a pseudo-professor.
const NAME_RE = /^[A-Z][A-Za-z'’\-]+(?:\s[A-Za-z'’\-]+)*,\s*[A-Z][A-Za-z'’.\- ]*$/;

function instructorsFrom(html) {
  const found = new Map(); // "SUBJ NUM" -> Set of names
  let current = null;
  for (const row of html.matchAll(ROW_RE)) {
    const inner = row[1];
    const header = inner.match(CRSHEADER_RE);
    if (header) current = header[1];
    if (!current || !SECTXT_RE.test(row[0])) continue;
    const cells = [...inner.matchAll(CELL_RE)].map((c) => text(c[1]));
    // Section rows carry 13 cells; anything shorter is a final-exam or notice
    // row that has no instructor column at all.
    if (cells.length < 13) continue;
    const name = cells[9];
    if (!name || name === "Staff" || !NAME_RE.test(name)) continue;
    const set = found.get(current) ?? new Set();
    set.add(name);
    found.set(current, set);
  }
  return found;
}

async function subjectsFor(term) {
  const json = await get(`${BASE}/subject-list.json?selectedTerm=${term}`);
  return JSON.parse(json).map((s) => s.code.trim()).filter(Boolean);
}

async function coursesFor(term, subject) {
  const merged = new Map();
  const pageUrl = (page) =>
    `${BASE}/scheduleOfClassesStudentResult.htm?selectedTerm=${term}` +
    `&selectedSubjects=${encodeURIComponent(subject)}&page=${page}`;

  // Requesting a page past the end returns HTTP 500, so read the page count
  // from the first page's pagination links instead of probing until failure.
  const first = await get(pageUrl(1));
  const absorb = (html) => {
    for (const [num, names] of instructorsFrom(html)) {
      const key = `${subject} ${num}`;
      const set = merged.get(key) ?? new Set();
      for (const n of names) set.add(n);
      merged.set(key, set);
    }
  };
  absorb(first);
  const maxPage = Math.max(1, ...[...first.matchAll(/page=(\d+)/g)].map((m) => Number(m[1])));

  for (let page = 2; page <= maxPage; page++) {
    await sleep(DELAY_MS);
    absorb(await get(pageUrl(page)));
  }
  return merged;
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
    let pairs = 0;
    let done = 0;
    await pool(subjects, CONCURRENCY, async (subject) => {
      let found;
      try {
        found = await coursesFor(term, subject);
      } catch (e) {
        // One unreachable subject must not lose the whole term's work; the
        // gap is logged so a re-run can be aimed at it.
        console.warn(`  ${term} ${subject}: ${e.message} — skipped`);
        return;
      }
      for (const [key, names] of found) {
        const course = (state.courses[key] ??= {});
        for (const name of names) {
          const seen = (course[name] ??= []);
          if (!seen.includes(term)) seen.push(term);
          pairs++;
        }
      }
      done++;
      if (done % 20 === 0)
        console.log(`  ${term} ${done}/${subjects.length} subjects, ${pairs} course-instructor pairs so far`);
    });
    state.terms_done.push(term);
    fs.writeFileSync(outPath, JSON.stringify(state, null, 1));
    console.log(`${term}: ${pairs} course-instructor pairs, saved`);
  }

  const courses = Object.keys(state.courses).length;
  const names = new Set(Object.values(state.courses).flatMap((c) => Object.keys(c)));
  console.log(`\nDone. ${courses} courses, ${names.size} distinct instructors across ${state.terms_done.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
