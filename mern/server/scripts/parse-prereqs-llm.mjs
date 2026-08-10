// LLM pass over the catalog's prerequisite prose. Build-time only: the
// output is validated, committed, and consumed by build-prereq-graph.mjs —
// nothing at runtime ever calls a model.
//
// What it adds over the regex parser in build-prereq-graph.mjs:
//   - splits mixed clauses ("AP Calculus BC score of 4, or MATH 20B") into
//     course options + non-course alternatives instead of giving up
//   - extracts grade minimums, concurrent-enrollment allowances
//   - classifies course-free prereqs (graduate standing, consent) so the
//     planner can reason about them instead of returning "can't tell"
//
// Guardrails:
//   - strict JSON schema (OpenAI structured outputs)
//   - every course code the model returns must resolve in the catalog's
//     alias index; unresolvable codes are demoted to non-course text
//   - where the regex parser was confident ("parsed"), disagreements are
//     written to prereqs-llm-review.txt for spot-checking
//
// Usage:
//   node scripts/parse-prereqs-llm.mjs [--limit N] [--model gpt-5.6-luna]
//     [--redo-disagreements]   re-process only courses whose stored result
//                              disagrees with the regex parse — pair this
//                              with a stronger --model to arbitrate
// Reads OPENAI_API_KEY from the environment or the repo-root .env.
// Output: scripts/data/prereqs-llm.json (checkpointed every 200 courses;
// re-running skips courses already done, so it resumes after interruption).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalize, aliasesFor } from "./lib/course-ids.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const v5Path = path.join(here, "..", "controllers", "v5.json");
const outPath = path.join(here, "data", "prereqs-llm.json");
const reviewPath = path.join(here, "data", "prereqs-llm-review.txt");

// ---------------------------------------------------------------------------
// Config / CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : dflt;
};
const LIMIT = Number(argOf("--limit", "0")) || 0;
const MODEL = argOf("--model", "gpt-5.6-luna");
const CONCURRENCY = 8;
const CHECKPOINT_EVERY = 200;

function loadApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envPath = path.join(here, "..", "..", "..", ".env");
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, "utf-8").match(/^OPENAI_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  console.error("OPENAI_API_KEY not found in env or repo-root .env");
  process.exit(1);
}
const API_KEY = loadApiKey();

// ---------------------------------------------------------------------------
// Catalog + alias index (for validating model output)
// ---------------------------------------------------------------------------
const courses = JSON.parse(fs.readFileSync(v5Path, "utf-8"));
const aliasIndex = new Map();
for (const c of courses) {
  for (const alias of aliasesFor(c.course_id)) {
    const key = normalize(alias);
    if (key && !aliasIndex.has(key)) aliasIndex.set(key, c.course_id);
  }
}
const resolveCode = (code) => aliasIndex.get(normalize(String(code))) || null;

// ---------------------------------------------------------------------------
// The model call
// ---------------------------------------------------------------------------
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    groups: {
      type: "array",
      description:
        "AND of OR-groups. Each group is satisfied by taking ANY listed course or meeting ANY non-course alternative.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          courses: { type: "array", items: { type: "string" } },
          non_course_alternatives: {
            type: "array",
            items: { type: "string" },
            description: "e.g. 'AP Calculus BC score of 4 or 5', 'placement exam'",
          },
        },
        required: ["courses", "non_course_alternatives"],
      },
    },
    min_grade: {
      type: ["string", "null"],
      description: "Minimum letter grade if stated, e.g. 'C-'; null otherwise",
    },
    concurrent_allowed: {
      type: "array",
      items: { type: "string" },
      description: "Courses explicitly allowed to be taken concurrently",
    },
    standing: {
      type: "string",
      enum: ["none", "lower-division", "upper-division", "graduate", "other"],
      description: "Class-standing requirement, if any",
    },
    consent_required: {
      type: "boolean",
      description: "Instructor/department consent or approval required",
    },
    restrictions: {
      type: "string",
      description: "Major/enrollment restrictions and anything else not captured above; empty string if none",
    },
  },
  required: ["groups", "min_grade", "concurrent_allowed", "standing", "consent_required", "restrictions"],
};

const SYSTEM_PROMPT = `You convert UC San Diego course prerequisite sentences into structured requirements.

Conventions of these registrar strings:
- "or" binds tighter than "and": "A or B and C" means (A or B) AND C.
- There are no parentheses; a semicolon usually separates course logic from restrictions.
- Course codes look like "CSE 100", "MATH 20C", "BILD 1". Normalize spacing (e.g. "CSE100" -> "CSE 100"). Expand elisions: "MATH 20A-B" or "MATH 20A and 20B" means MATH 20A and MATH 20B (two AND groups); "CSE 12 or 15L" means CSE 12 or CSE 15L (one OR group).
- "Two of the following: A, B, C" cannot be expressed here — put the whole phrase in non_course_alternatives of one group and list the courses in that group's courses array.
- Grade requirements ("grades of C- or better") go in min_grade, not in groups.
- "may be taken concurrently" -> concurrent_allowed.
- Standing/consent requirements are NOT groups; use the standing/consent_required fields.
- Course requirements usually come FIRST; later sentences ("Restricted to...", "S/U grades only", "No credit if...") are restrictions. Capture them in restrictions but NEVER drop the leading courses: "CLIN 227A. S/U grades only." -> groups [["CLIN 227A"]].
- Major codes (two letters + two digits: CS75, BI81, EC26) are majors, not courses — restrictions, never groups.
- A series choice like "PHYS 2A-B-C-D or 4A-B-C-D-E" means one whole series or the other. Encode it as one group per position, pairing alternatives: [["PHYS 2A","PHYS 4A"], ["PHYS 2B","PHYS 4B"], ...]. If one series is longer, fold its extra courses into the last group.
- If the text has no course requirements at all, groups must be [].
Only include course codes that actually appear in the text. Never invent codes.`;

async function parseOne(text) {
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Prerequisite text: "${text}"` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "prereqs", strict: true, schema: SCHEMA },
    },
    // no temperature: gpt-5.x models only accept the default
  };
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 5) throw new Error(`OpenAI ${res.status} after ${attempt} tries`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    return JSON.parse(json.choices[0].message.content);
  }
}

// ---------------------------------------------------------------------------
// Validation: resolve codes against the catalog, demote what doesn't resolve
// ---------------------------------------------------------------------------
function validate(raw) {
  let demoted = 0;
  const groups = [];
  for (const g of raw.groups || []) {
    const resolved = [];
    const extras = [...(g.non_course_alternatives || [])];
    for (const code of g.courses || []) {
      const id = resolveCode(code);
      if (id) {
        if (!resolved.includes(id)) resolved.push(id);
      } else {
        demoted++;
        extras.push(String(code));
      }
    }
    if (resolved.length || extras.length) {
      groups.push({ courses: resolved, non_course_alternatives: extras });
    }
  }
  const concurrent = (raw.concurrent_allowed || []).map(resolveCode).filter(Boolean);
  return {
    groups,
    min_grade: raw.min_grade || null,
    concurrent_allowed: concurrent,
    standing: raw.standing || "none",
    consent_required: Boolean(raw.consent_required),
    restrictions: raw.restrictions || "",
    demoted_codes: demoted,
  };
}

// Mirror of the regex parser, for the disagreement report only
function regexParse(text) {
  const semi = text.indexOf(";");
  const clause = semi === -1 ? text : text.slice(0, semi);
  const CODE_RE = /\b([A-Z]{2,5})\s?(\d{1,3}[A-Z]{0,3})\b/g;
  const requires = [];
  for (const frag of clause.split(/\band\b/i)) {
    const codes = [];
    for (const m of frag.toUpperCase().matchAll(CODE_RE)) {
      const id = resolveCode(`${m[1]}${m[2]}`);
      if (id && !codes.includes(id)) codes.push(id);
    }
    if (codes.length) requires.push(codes.sort());
  }
  return requires;
}
const groupsKey = (groups) => JSON.stringify(groups.map((g) => [...g].sort()).sort());

// ---------------------------------------------------------------------------
async function main() {
  const todo = courses.filter((c) => {
    const t = (c.prerequisites || "").trim();
    return t && !/^none\.?$/i.test(t);
  });
  const state = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, "utf-8")) : { model: MODEL, results: {} };
  const disagreesWithRegex = (c) => {
    const v = state.results[c.normalized_course_id];
    if (!v) return true;
    const regexGroups = regexParse(c.prerequisites);
    const llmGroups = v.groups.filter((g) => g.courses.length).map((g) => g.courses);
    return regexGroups.length > 0 && groupsKey(regexGroups) !== groupsKey(llmGroups);
  };
  const idsFile = argOf("--ids", null); // file of normalized ids: force re-parse exactly these
  let queue;
  if (idsFile) {
    const wanted = new Set(fs.readFileSync(idsFile, "utf-8").split(/\s+/).filter(Boolean));
    queue = todo.filter((c) => wanted.has(c.normalized_course_id));
  } else if (args.includes("--redo-disagreements")) {
    queue = todo.filter(disagreesWithRegex);
  } else {
    queue = todo.filter((c) => !state.results[c.normalized_course_id]);
  }
  if (LIMIT) queue = queue.slice(0, LIMIT);
  console.log(`${todo.length} courses with prereq text; ${Object.keys(state.results).length} already done; processing ${queue.length} with ${MODEL}`);

  let done = 0;
  let failed = 0;

  const save = () => fs.writeFileSync(outPath, JSON.stringify(state, null, 1));

  const worker = async () => {
    while (queue.length) {
      const c = queue.shift();
      try {
        const raw = await parseOne(c.prerequisites);
        state.results[c.normalized_course_id] = validate(raw);
      } catch (e) {
        failed++;
        console.warn(`  fail ${c.course_id}: ${e.message}`);
      }
      done++;
      if (done % CHECKPOINT_EVERY === 0) {
        save();
        console.log(`  ${done}/${queue.length + done} (${failed} failed), checkpointed`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  save();

  // Disagreement report over ALL stored results (not just this run), so a
  // resume never truncates it. Only courses where the regex parser was
  // confident are worth human review.
  const review = [];
  for (const c of todo) {
    const v = state.results[c.normalized_course_id];
    if (!v) continue;
    const regexGroups = regexParse(c.prerequisites);
    const llmCourseGroups = v.groups.filter((g) => g.courses.length).map((g) => g.courses);
    if (regexGroups.length && groupsKey(regexGroups) !== groupsKey(llmCourseGroups)) {
      review.push(
        `${c.course_id}\n  text:  ${c.prerequisites.slice(0, 200)}\n  regex: ${JSON.stringify(regexGroups)}\n  llm:   ${JSON.stringify(llmCourseGroups)}\n`
      );
    }
  }
  fs.writeFileSync(reviewPath, review.join("\n"));

  const all = Object.values(state.results);
  console.log(`\nDone: ${all.length} parsed, ${failed} failed`);
  console.log(`  with course groups: ${all.filter((r) => r.groups.some((g) => g.courses.length)).length}`);
  console.log(`  standing-only/consent-only: ${all.filter((r) => !r.groups.length && (r.standing !== "none" || r.consent_required)).length}`);
  console.log(`  min_grade captured: ${all.filter((r) => r.min_grade).length}`);
  console.log(`  concurrent_allowed captured: ${all.filter((r) => r.concurrent_allowed.length).length}`);
  console.log(`  demoted (hallucinated/unknown) codes: ${all.reduce((s, r) => s + r.demoted_codes, 0)}`);
  console.log(`  regex disagreements for review: ${review.length} -> ${reviewPath}`);
  console.log(`\nNow run: node scripts/build-prereq-graph.mjs`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
