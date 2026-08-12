// Conformance suite for the JS half of the audit-requirement spec.
// Cases live in shared/audit-requirement-cases.json and are ALSO run by
// app/tests/test_audit_requirements.py against the Python port. If the two
// implementations drift, one of the two suites goes red.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateSubrequirement,
  requirementMode,
  matchGroups,
} from "./auditRequirements.js";
import { evaluateRequirement } from "./auditProgress.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesPath = path.join(here, "../../../../shared/audit-requirement-cases.json");
const { cases, scope_cases: scopeCases } = JSON.parse(
  fs.readFileSync(casesPath, "utf-8")
);

const normalize = (s) => String(s || "").toUpperCase().replace(/\s+/g, " ").trim();
const matches = (courseId, code) => normalize(courseId) === normalize(code);

test("shared fixture is present and non-trivial", () => {
  assert.ok(cases.length >= 10, `expected 10+ shared cases, got ${cases.length}`);
});

for (const c of cases) {
  test(`[shared] ${c.name}`, () => {
    const result = evaluateSubrequirement(c.requirement, c.courses, matches);
    assert.equal(result.mode, c.expect.mode, "mode");
    assert.equal(result.satisfied, c.expect.satisfied, "satisfied");
    assert.equal(result.progress, c.expect.progress, "progress");
    assert.equal(result.needed, c.expect.needed, "needed");
    assert.equal(result.openGroups.length, c.expect.openGroupCount, "openGroups");
  });
}

// --- Shared scope cases: how far "a course counts once" reaches ---------
//
// The JS entry point is evaluateRequirement, called once per section; a
// subrequirement is satisfied when its result projects. Python runs the same
// fixtures through check_coverage. See _scope_comment in the fixture file.

const scheduleOf = (courses) => [
  { fall: [], winter: [], spring: [] },
  { fall: [], winter: [], spring: [] },
  {
    fall: courses.map((c) => ({ ...c, status: "planned" })),
    winter: [],
    spring: [],
  },
  { fall: [], winter: [], spring: [] },
];

for (const c of scopeCases) {
  test(`[shared scope] ${c.name}`, () => {
    const schedule = scheduleOf(c.courses);
    const satisfied = [];
    for (const section of c.sections) {
      const { requirementResults } = evaluateRequirement(section, schedule);
      for (const r of requirementResults) {
        // `informational` marks a row that states no NEEDS at all. Both sides
        // skip those: Python's check_coverage never yields them, and JS keeps
        // them out of the section's projection.
        if (r.projected && !r.informational) satisfied.push(r.title);
      }
    }
    assert.deepEqual(satisfied.sort(), [...c.expect.satisfied].sort());
  });
}

// --- JS-only detail tests (semantics not expressible as shared fixtures) ---

test("requirementMode: slots === count is 'all', otherwise 'any'", () => {
  assert.equal(requirementMode([["A"], ["B"]], "courses", 2), "all");
  assert.equal(requirementMode([["A"], ["B"], ["C"]], "courses", 1), "any");
  assert.equal(requirementMode([["A"], ["B"]], "units", 8), "any");
  assert.equal(requirementMode([], "courses", 0), "any");
});

test("openGroups name the specific slots still to fill", () => {
  const result = evaluateSubrequirement(
    {
      needType: "courses",
      needAmount: 3,
      groups: [["MATH 189", "DSC 152"], ["DSC 100"], ["DSC 148", "CSE 158"]],
    },
    [{ course_id: "DSC 100", credits: 4 }],
    matches
  );
  assert.equal(result.satisfied, false);
  assert.deepEqual(result.openGroups, [
    ["MATH 189", "DSC 152"],
    ["DSC 148", "CSE 158"],
  ]);
});

test("matchGroups reports which courses were consumed", () => {
  const { count, usedCourses } = matchGroups(
    [["DSC 100"], ["DSC 102"]],
    ["DSC 100", "DSC 102", "CSE 100"],
    matches
  );
  assert.equal(count, 2);
  assert.deepEqual(usedCourses.sort(), ["DSC 100", "DSC 102"]);
});
