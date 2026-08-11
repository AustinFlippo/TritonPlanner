import assert from "node:assert/strict";
import {
  AUDIT_REQUIREMENT_DRAG_TYPE,
  extractCompletedCourses,
  extractTakenCourses,
  extractUnmetRequirements,
  rankRecommendedCourses,
} from "./recommendations.js";

assert.equal(
  AUDIT_REQUIREMENT_DRAG_TYPE,
  "application/x-triton-audit-requirement"
);

const unknown = { course: { course_id: "CSE 101" }, prereqs_met: null };
const blocked = { course: { course_id: "CSE 102" }, prereqs_met: false };
const readyFirst = { course: { course_id: "CSE 100" }, prereqs_met: true };
const readySecond = { course: { course_id: "CSE 103" }, prereqs_met: true };

assert.deepEqual(
  rankRecommendedCourses([unknown, blocked, readyFirst, readySecond]),
  [readyFirst, readySecond, unknown, blocked],
  "ready courses should rank first without reordering ties"
);

// A requirement can list one course under two codes ("DSC 80" and "DSC 80R"),
// and the server answers per token, so the same course arrives twice.
assert.deepEqual(
  rankRecommendedCourses([readyFirst, unknown, { ...readyFirst }, blocked]),
  [readyFirst, unknown, blocked],
  "the same course must not produce two cards (or two React keys)"
);

// When the audit names real remaining courses, suggest those — not the whole
// Eighth GE attribute sequence.
const eighthWithRealCodes = extractUnmetRequirements([
  {
    title:
      "Eighth College General Education RequirementsFor a list of courses, please go tohttp://eighth.ucsd.edu/academics/degree-requirements/first-year.html",
    status: "not_fulfilled",
    items: [
      "NEEDS: 1 more courses | Available: CCE 3",
      "NEEDS: 1 more courses | Available: CCE 120",
    ],
  },
]);
assert.deepEqual(eighthWithRealCodes[0].codes, ["CCE 3", "CCE 120"]);

// Junk / empty Available → fall back to the approved attribute list.
const jtccer = extractUnmetRequirements([
  {
    title: "Jane Teranes Climate Change Education (JTCCER)One course required",
    status: "not_fulfilled",
    items: ["NEEDS: 1 more courses"],
  },
]);
assert.ok(jtccer[0].codes.includes("ENVR 30"));
assert.ok(jtccer[0].codes.includes("SIO 30"));

// A real TritonLink audit renders the course column at a fixed width, so codes
// arrive padded ("COGS  9", "CCE   1") or with no space at all ("MATH183").
// A regex allowing at most one space silently returned a transcript missing
// most of the student's courses, and the recommender then suggested classes
// they had already passed. Mirrors _COURSE_CODE_RE in app/catalog.py.
const padded = extractTakenCourses([
  {
    title: "Major",
    status: "fulfilled",
    items: [
      "COGS  9 - Introduction to Data Science (FA24, A)",
      "DSC  80 - Practice of Data Science (SP26, A-)",
      "CCE   1 - CriticalApproach/CommPractice (SP25, A)",
      "MUS  20R - Exploring the Musical Mind (WI26, A)",
      "MATH183 - Statistical Methods (WI26, A+)",
      "MATH 20A - Calculus/Science & Engineerin (SP24, TP)",
      "NEEDS: 7 Courses | Available: DSC 100, DSC 102",
    ],
  },
]);
for (const code of ["COGS 9", "DSC 80", "CCE 1", "MUS 20R", "MATH 20A"]) {
  assert.ok(padded.includes(code), `padded audit line dropped ${code}`);
}
// NEEDS/Available rows are requirements, not courses the student has taken.
assert.ok(!padded.includes("DSC 100"));

// Requirement search hides completed/in-progress only — planned Core courses
// must still appear when the student drags that requirement into search.
const schedule = [
  {
    fall: [
      { course_id: "DSC 10", status: "completed", grade: "A" },
      { course_id: "DSC 100", status: "planned" },
    ],
    winter: [{ course_id: "DSC 20", status: "current", grade: "WIP" }],
    spring: [],
  },
];
const completedOnly = extractCompletedCourses([], schedule);
assert.ok(completedOnly.includes("DSC 10"));
assert.ok(completedOnly.includes("DSC 20"));
assert.ok(
  !completedOnly.includes("DSC 100"),
  "planned courses must not be excluded from requirement search"
);
const takenWithPlan = extractTakenCourses([], schedule);
assert.ok(takenWithPlan.includes("DSC 100"), "planned still counts for prereqs");

console.log("recommendations tests passed");
