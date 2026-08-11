// Builds prereq_graph.json from the v5 course catalog.
//
// For each course, parses the free-text `prerequisites` field into CNF:
// a list of OR-groups, every group must have at least one member satisfied.
// UCSD registrar strings have no parentheses; "or" binds tighter than "and"
// ("A or B and C" means "(A or B) and C"), so we split on "and" first — then
// on commas, because a comma list without an "or" is a CONJUNCTION:
// "CSE 12, CSE 15L, CSE 21." names three required courses, and folding them
// into one OR-group (as this parser used to) turned all three into pick-any-one.
//
// The graph is advisory: grade minimums, AP scores, major restrictions and
// "consent of instructor" are NOT modeled — they stay in `notes`, and the
// per-course `confidence` field says how much of the string we understood:
//   "parsed"   – LLM pass only: every group resolved and nothing was mixed
//   "partial"  – some fragments had no recognizable courses (AP scores, etc.),
//                AND every regex-parsed course that has requirements at all:
//                this parser reads registrar prose with no grammar, so its
//                output must always carry the "verify this" hedge downstream
//   "unparsed" – prereq text exists but no known course codes found in it
//
// Corequisites ("Corequisite: MATH 20D", "may be taken concurrently") are NOT
// prerequisites: they are required, but the same quarter is early enough. They
// become their own AND-group plus an entry in meta.concurrent_allowed, which
// app/planner_agent.py reads. Merging one into the SAME OR-group as the real
// prerequisite — the old behavior — made a genuine hard prereq optional.
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

function extractCodes(text, courseId) {
  const found = [];
  for (const m of text.toUpperCase().matchAll(CODE_RE)) {
    const canonical = idIndex.get(normalize(`${m[1]}${m[2]}`));
    // A course is never its own prerequisite — see canonicalGroup below.
    if (!canonical || canonical === courseId || found.includes(canonical)) continue;
    found.push(canonical);
  }
  return found;
}

// "Corequisite: MATH 20D", "MATH 20D must be taken concurrently".
const COREQ_CLAUSE_RE = /\bco-?requisites?\s*:?/i;
const CONCURRENT_RE = /\b(concurrent(ly)?|concurrent enrollment|same quarter)\b/i;

// A comma list is a conjunction UNLESS the fragment offers a choice with "or"
// ("CSE 11 or CSE 8B"). Splitting an or-less list on commas is what turns
// "CSE 12, CSE 15L, CSE 21." back into three separate requirements.
function fragmentGroups(frag, courseId) {
  if (/\bor\b/i.test(frag)) {
    const codes = extractCodes(frag, courseId);
    return codes.length ? [codes] : [];
  }
  const groups = [];
  for (const piece of frag.split(",")) {
    const codes = extractCodes(piece, courseId);
    if (codes.length) groups.push(codes);
  }
  return groups;
}

function parsePrereqs(raw, courseId) {
  const text = (raw || "").trim();
  if (!text || /^none\.?$/i.test(text)) {
    return { requires: [], notes: "", confidence: "parsed", meta: { concurrent_allowed: [] } };
  }

  // The registrar separates the course logic from restrictions with ";".
  const semi = text.indexOf(";");
  let clause = semi === -1 ? text : text.slice(0, semi);
  const notes = semi === -1 ? "" : text.slice(semi + 1).trim();

  // Split the corequisite clause off before anything else, so its courses
  // never land in an OR-group with a real prerequisite.
  let coreqClause = "";
  const coreqAt = clause.search(COREQ_CLAUSE_RE);
  if (coreqAt !== -1) {
    coreqClause = clause.slice(coreqAt).replace(COREQ_CLAUSE_RE, " ");
    clause = clause.slice(0, coreqAt);
  }

  // Standing/consent-only prereqs ("upper-division standing") have no codes.
  const fragments = clause
    .split(/\band\b/i)
    .map((f) => f.trim())
    .filter(Boolean);

  const requires = [];
  const concurrent = [];
  for (const frag of fragments) {
    const groups = fragmentGroups(frag, courseId);
    // A fragment with no codes is standing/consent/exam text; it is why the
    // regex path is never more confident than "partial".
    if (groups.length === 0) continue;
    requires.push(...groups);
    // "MATH 20C (may be taken concurrently)" inside the prereq clause itself.
    if (CONCURRENT_RE.test(frag)) {
      for (const code of groups.flat()) {
        if (!concurrent.includes(code)) concurrent.push(code);
      }
    }
  }

  // Corequisites are required too — each gets its own AND-group — but the same
  // quarter satisfies them (see meta.concurrent_allowed).
  for (const frag of coreqClause.split(/\band\b/i)) {
    for (const group of fragmentGroups(frag, courseId)) {
      requires.push(group);
      for (const code of group) {
        if (!concurrent.includes(code)) concurrent.push(code);
      }
    }
  }

  let confidence;
  if (requires.length === 0) confidence = "unparsed";
  // Everything this parser produces is a guess at registrar prose it has no
  // grammar for, so it is never better than "partial" — that is what makes
  // check_placements append its "verify" hedge. Only the LLM pass earns
  // "parsed".
  else confidence = "partial";

  return {
    requires,
    notes: notes || (confidence === "unparsed" ? clause : ""),
    confidence,
    meta: { concurrent_allowed: concurrent },
  };
}

// ---------------------------------------------------------------------------
// Build graph + reverse edges
// ---------------------------------------------------------------------------
// The LLM pass returns codes as the registrar wrote them ("POLI 30"), but every
// consumer matches on canonical catalog ids ("POLI 30/30D"), so resolve them
// through the same index the regex path uses — an unresolved alias silently
// matches nothing and warns a student about a prereq they already have.
//
// A course listed as its own prerequisite ("concurrent enrollment in DSC 95")
// is dropped: nothing can sit in an earlier quarter than itself, so the group
// would be permanently unsatisfiable.
function canonicalGroup(codes, courseId) {
  const out = [];
  for (const code of codes || []) {
    const canonical = idIndex.get(normalize(code));
    if (!canonical || canonical === courseId || out.includes(canonical)) continue;
    out.push(canonical);
  }
  return out;
}

// Build one course's entry from its LLM parse. Same shape as parsePrereqs
// plus a `meta` block (grade minimums, concurrency, standing, consent) that
// existing consumers simply ignore.
function fromLlm(entry, raw, courseId) {
  const resolved = entry.groups.map((g) => canonicalGroup(g.courses, courseId));
  const requires = resolved.filter((g) => g.length);
  const mixedGroups = entry.groups.some((g) => g.non_course_alternatives.length);
  // A group emptied only because every member was this course itself was
  // understood; one emptied by an unresolvable code was not.
  const lostGroups = entry.groups.filter(
    (g, i) =>
      !resolved[i].length &&
      g.courses.some((code) => idIndex.get(normalize(code)) !== courseId),
  ).length;
  let confidence;
  if (entry.groups.length === 0) {
    confidence = (raw || "").trim() && !/^none\.?$/i.test(raw.trim()) ? "unparsed" : "parsed";
  } else if (!mixedGroups && lostGroups === 0) {
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
      concurrent_allowed: canonicalGroup(entry.concurrent_allowed, courseId),
      standing: entry.standing,
      consent_required: entry.consent_required,
      alternatives: entry.groups
        .filter((g) => g.non_course_alternatives.length)
        .map((g) => ({
          courses: canonicalGroup(g.courses, courseId),
          or: g.non_course_alternatives,
        })),
    },
  };
}

const graph = {};
let llmUsed = 0;
for (const c of courses) {
  const llmEntry = llm[c.normalized_course_id];
  const parsed = llmEntry
    ? fromLlm(llmEntry, c.prerequisites, c.course_id)
    : { ...parsePrereqs(c.prerequisites, c.course_id), source: "regex" };
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
