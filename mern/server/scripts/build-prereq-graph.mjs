// Builds prereq_graph.json from the v5 course catalog.
//
// For each course, parses the free-text `prerequisites` field into CNF:
// a list of OR-groups, every group must have at least one member satisfied.
// UCSD registrar strings have no parentheses; "or" binds tighter than "and"
// ("A or B and C" means "(A or B) and C"), so we split on "and" first and
// treat each fragment's course codes as one OR-group.
//
// The graph is advisory: grade minimums, AP scores, major restrictions and
// "consent of instructor" are NOT modeled — they stay in `notes`, and the
// per-course `confidence` field says how much of the string we understood:
//   "parsed"   – every fragment produced course codes (or there were none)
//   "partial"  – some fragments had no recognizable courses (AP scores, etc.)
//   "unparsed" – prereq text exists but no known course codes found in it
//
// Usage: node scripts/build-prereq-graph.mjs
// Output: controllers/prereq_graph.json

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalize, aliasesFor } from "./lib/course-ids.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.join(here, "../controllers/v5.json");
const llmPath = path.join(here, "data", "prereqs-llm.json");
const outPath = path.join(here, "../controllers/prereq_graph.json");

const courses = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));

// Optional richer parse from the offline LLM pass (parse-prereqs-llm.mjs).
// When an entry exists for a course it replaces the regex parse below; codes
// in it were already validated against the catalog at generation time.
const llm = fs.existsSync(llmPath)
  ? JSON.parse(fs.readFileSync(llmPath, "utf-8")).results
  : {};

// ---------------------------------------------------------------------------
// Index every course under its canonical id plus cross-listing aliases, so a
// prereq mention of "ANSC 185" resolves to the "AAS/ANSC 185" catalog entry.
// ---------------------------------------------------------------------------
const idIndex = new Map(); // normalized alias -> canonical course_id

for (const c of courses) {
  for (const alias of aliasesFor(c.course_id)) {
    const key = normalize(alias);
    if (key && !idIndex.has(key)) idIndex.set(key, c.course_id);
  }
}

// ---------------------------------------------------------------------------
// Parse one prerequisite string into { requires, notes, confidence }
// ---------------------------------------------------------------------------
const CODE_RE = /\b([A-Z]{2,5})\s?(\d{1,3}[A-Z]{0,3})\b/g;

function extractCodes(text) {
  const found = [];
  for (const m of text.toUpperCase().matchAll(CODE_RE)) {
    const canonical = idIndex.get(normalize(`${m[1]}${m[2]}`));
    if (canonical && !found.includes(canonical)) found.push(canonical);
  }
  return found;
}

function parsePrereqs(raw) {
  const text = (raw || "").trim();
  if (!text || /^none\.?$/i.test(text)) {
    return { requires: [], notes: "", confidence: "parsed" };
  }

  // The registrar separates the course logic from restrictions with ";".
  const semi = text.indexOf(";");
  const clause = semi === -1 ? text : text.slice(0, semi);
  const notes = semi === -1 ? "" : text.slice(semi + 1).trim();

  // Standing/consent-only prereqs ("upper-division standing") have no codes.
  const fragments = clause
    .split(/\band\b/i)
    .map((f) => f.trim())
    .filter(Boolean);

  const requires = [];
  let unparsedFragments = 0;
  for (const frag of fragments) {
    const codes = extractCodes(frag);
    if (codes.length > 0) requires.push(codes);
    else unparsedFragments++;
  }

  let confidence;
  if (requires.length === 0) confidence = "unparsed";
  else if (unparsedFragments > 0) confidence = "partial";
  else confidence = "parsed";

  // A clause fragment that mixes a course with a non-course alternative
  // ("AP Calculus BC score of 4 or 5, or MATH 20B") parses stricter than
  // reality; flag it so the UI never presents it as a hard requirement.
  if (confidence === "parsed" && /\b(AP|IB|SAT|score|placement|exam)\b/i.test(clause)) {
    confidence = "partial";
  }

  return { requires, notes: notes || (confidence === "unparsed" ? clause : ""), confidence };
}

// ---------------------------------------------------------------------------
// Build graph + reverse edges
// ---------------------------------------------------------------------------
// Build one course's entry from its LLM parse. Same shape as parsePrereqs
// plus a `meta` block (grade minimums, concurrency, standing, consent) that
// existing consumers simply ignore.
function fromLlm(entry, raw) {
  const requires = entry.groups.filter((g) => g.courses.length).map((g) => g.courses);
  const mixedGroups = entry.groups.some((g) => g.non_course_alternatives.length);
  let confidence;
  if (entry.groups.length === 0) {
    confidence = (raw || "").trim() && !/^none\.?$/i.test(raw.trim()) ? "unparsed" : "parsed";
  } else if (!mixedGroups && requires.length === entry.groups.length) {
    confidence = "parsed";
  } else {
    confidence = "partial";
  }
  return {
    requires,
    notes: entry.restrictions || "",
    confidence,
    source: "llm",
    meta: {
      min_grade: entry.min_grade,
      concurrent_allowed: entry.concurrent_allowed,
      standing: entry.standing,
      consent_required: entry.consent_required,
      alternatives: entry.groups
        .filter((g) => g.non_course_alternatives.length)
        .map((g) => ({ courses: g.courses, or: g.non_course_alternatives })),
    },
  };
}

const graph = {};
let llmUsed = 0;
for (const c of courses) {
  const llmEntry = llm[c.normalized_course_id];
  const parsed = llmEntry
    ? fromLlm(llmEntry, c.prerequisites)
    : { ...parsePrereqs(c.prerequisites), source: "regex" };
  if (llmEntry) llmUsed++;
  graph[c.course_id] = { ...parsed, unlocks: [] };
}

for (const [courseId, entry] of Object.entries(graph)) {
  for (const group of entry.requires) {
    for (const prereqId of group) {
      if (prereqId !== courseId && graph[prereqId] && !graph[prereqId].unlocks.includes(courseId)) {
        graph[prereqId].unlocks.push(courseId);
      }
    }
  }
}
for (const entry of Object.values(graph)) entry.unlocks.sort();

fs.writeFileSync(outPath, JSON.stringify(graph));

// Report
const stats = { parsed: 0, partial: 0, unparsed: 0 };
let withReqs = 0;
for (const e of Object.values(graph)) {
  stats[e.confidence]++;
  if (e.requires.length) withReqs++;
}
const total = courses.length;
console.log(`Wrote ${outPath}`);
console.log(`Courses: ${total} (${llmUsed} from LLM pass, ${total - llmUsed} regex)`);
console.log(`  parsed:   ${stats.parsed} (${((stats.parsed / total) * 100).toFixed(1)}%)`);
console.log(`  partial:  ${stats.partial}`);
console.log(`  unparsed: ${stats.unparsed} (no recognizable course codes in prereq text)`);
console.log(`  with course-code requirements: ${withReqs}`);
