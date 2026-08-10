// Scrapes the UCSD General Catalog into the v5.json course schema.
//
// catalog.ucsd.edu serves one static page per department at
// /courses/<DEPT>.html (index at /front/courses.html); one page can hold
// several subject codes (ANTH.html carries ANTH/ANBI/ANAR/ANSC). Each course
// is a pair of adjacent <p> tags:
//
//   <p class="course-name">CSE 100. Advanced Data Structures (4)</p>
//   <p class="course-descriptions">... <em>Prerequisites:</em> CSE 21 ...</p>
//
// Output objects match v5.json exactly (course_id, course_name, description,
// credits, prerequisites, normalized_course_id, professors, offerings) so the
// merge step can swap them in without touching any consumer. `professors` and
// `offerings` are left empty here — they come from the RMP carry-over and the
// Schedule of Classes harvest respectively, both applied by build-catalog.mjs.
//
// Usage:  node scripts/scrape-catalog.mjs
// Output: scripts/data/catalog-scrape.json
//
// Be polite: sequential fetches with a delay; ~84 pages total.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "data");
const outPath = path.join(outDir, "catalog-scrape.json");

const BASE = "https://catalog.ucsd.edu";
const UA = "TritonPlanner catalog refresh (student project; contact smahadkar@ucsd.edu)";
const DELAY_MS = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

const decodeEntities = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const stripTags = (s) => decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

// "CSE 100", "AAS/ANSC 185", "CHIN 160/260", "EDS 31/CHEM 96", "SIO 209A-B"
const COURSE_ID_RE = /^[A-Z]{2,5}[A-Z/ ]*\s\d+[A-Z-]*(?:\/(?:[A-Z]+(?:\s[A-Z]{2,4})?\s)?\d+[A-Z-]*)*$/;

// One course = a course-name <p> and, when present, the course-descriptions <p>
// that follows it. Non-greedy scan keeps pairs adjacent.
const ENTRY_RE =
  /<p class="course-name">([\s\S]*?)<\/p>(?:\s*<p class="anchor-parent">[\s\S]*?<\/p>)*\s*(?:<p class="course-descriptions">([\s\S]*?)<\/p>)?/g;

// The catalog's dominant format is "CSE 100. Title (4)", but individual
// departments deviate; each rule below normalizes one observed deviation
// (see catalog-scrape-rejects.txt from a run without it).
function normalizeCourseNameText(text) {
  return (
    text
      // "Linguistics/American Sign Language (LISL) 1A. ..." -> "LISL 1A. ..."
      .replace(/^[A-Z][A-Za-z/,'’ ]*\(([A-Z]{2,5})\)\s*/, "$1 ")
      // "GPCO 468: Title" -> "GPCO 468. Title"
      .replace(/^([A-Z]{2,5} ?\d+[A-Z-]*):\s/, "$1. ")
      // "EDS 128 A-B. Title" -> "EDS 128A-B. Title"
      .replace(/^([A-Z]{2,5} \d+)\s+([A-Z](?:-[A-Z])*)(?=[.:])/, "$1$2")
      // "GSS 21-22-23. Title" -> "GSS 21/22/23. Title" (digit-dash-digit only,
      // so letter sequences like "209A-B" survive)
      .replace(/^([A-Z]{2,5} [\d A-Z-]*?)(?=\.)/, (head) => {
        let h = head;
        while (/(\d)-(\d)/.test(h)) h = h.replace(/(\d)-(\d)/, "$1/$2");
        return h;
      })
      // "POLI 5R, POLI 5DR, ECON 5R. Title" / "LISL 5A, 5B, 5C. Title" -> slashes
      .replace(/^((?:[A-Z]{2,5} )?\d+[A-Z-]*(?:,\s*(?:[A-Z]{2,5} )?\d+[A-Z-]*)+)(?=\.)/, (head) =>
        head.split(/,\s*/).join("/"),
      )
  );
}

function parseCourseName(raw) {
  const text = normalizeCourseNameText(stripTags(raw));
  // "CSE 100. Advanced Data Structures (4)" — units group optional because a
  // handful of entries (mostly graduate seminars) omit it.
  // \s* not \s+ after the period: a few entries omit the space ("PSYC 221.Sensation")
  let m = text.match(/^(.+?)\.\s*(.+?)(?:\s*\(([^()]+)\))?\s*\.?$/);
  // Fallback for entries missing the period after the id
  // ("HIUS 178/278 The Atlantic World ...", "COMM 114M CSI: ...").
  if (!m || !COURSE_ID_RE.test(m[1].trim().replace(/–|—/g, "-").replace(/(\d+[A-Z-]*)\/([A-Z]+)(?=\/|$)/g, "$1/$1$2"))) {
    const alt = text.match(/^([A-Z]{2,5} ?\d+[A-Z-]*(?:\/\d+[A-Z-]*)*)\s+(.+?)(?:\s*\(([^()]+)\))?\s*\.?$/);
    if (alt) m = alt;
  }
  if (!m) return null;
  if (!m) return null;
  let courseId = m[1].trim().replace(/–|—/g, "-");
  // "AAS 10/R" pairs a course with its remote variant; rewrite to "AAS 10/10R"
  // so it fits the "one subject, many numbers" alias shape (like CHIN 160/260)
  // that searchController and build-prereq-graph already expand.
  courseId = courseId.replace(/(\d+[A-Z-]*)\/([A-Z]+)(?=\/|$)/g, "$1/$1$2");
  if (!COURSE_ID_RE.test(courseId)) return null;
  const credits = m[3] ? m[3].replace(/–|—/g, "-").trim() : "N/A";
  return { courseId, title: m[2].trim(), credits };
}

function splitPrereqs(description) {
  // The catalog marks prereqs inside the description; v5 keeps the full text
  // in `description` and the tail after the marker in `prerequisites`.
  const m = description.match(/Prerequisites:\s*([\s\S]*)$/i);
  return m ? m[1].trim() : "None.";
}

async function main() {
  const index = await get(`${BASE}/front/courses.html`);
  const pages = [...new Set(index.match(/\.\.\/courses\/[A-Z0-9_]+\.html/g) || [])].map((p) =>
    p.replace("..", ""),
  );
  if (pages.length < 50) throw new Error(`only ${pages.length} dept pages found — page layout changed?`);
  console.log(`${pages.length} department pages`);

  const byId = new Map(); // normalized id -> course object
  const rejects = []; // course-name paragraphs the parser couldn't read
  let pageNum = 0;
  for (const page of pages) {
    pageNum++;
    let html;
    try {
      html = await get(BASE + page);
    } catch (e) {
      console.warn(`  skip ${page}: ${e.message}`);
      continue;
    }
    let count = 0;
    for (const m of html.matchAll(ENTRY_RE)) {
      const head = parseCourseName(m[1]);
      if (!head) {
        const text = stripTags(m[1]);
        if (text) rejects.push(`${page}: ${text.slice(0, 120)}`);
        continue;
      }
      const description = m[2] ? stripTags(m[2]) : "";
      const normalized = head.courseId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const course = {
        normalized_course_id: normalized,
        course_id: head.courseId,
        course_name: head.title,
        description,
        credits: head.credits,
        prerequisites: splitPrereqs(description),
        professors: [],
        offerings: [],
      };
      const prev = byId.get(normalized);
      // Cross-listed courses appear on every participating department's page;
      // keep whichever copy carries the longer description.
      if (!prev || course.description.length > prev.description.length) byId.set(normalized, course);
      count++;
    }
    console.log(`  [${pageNum}/${pages.length}] ${page}: ${count} courses`);
    await sleep(DELAY_MS);
  }

  const courses = [...byId.values()].sort((a, b) => a.course_id.localeCompare(b.course_id));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(courses, null, 1));
  console.log(`\nWrote ${courses.length} unique courses to ${outPath}`);
  if (rejects.length) {
    const rejectPath = path.join(outDir, "catalog-scrape-rejects.txt");
    fs.writeFileSync(rejectPath, rejects.join("\n"));
    console.log(`${rejects.length} unparsed course-name entries logged to ${rejectPath} — review them`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
