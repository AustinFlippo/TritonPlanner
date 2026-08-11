import test from "node:test";
import assert from "node:assert/strict";

import {
  isPassingGrade,
  isWipGrade,
  isNonPassingGrade,
} from "./courseGrades.js";
import { calculateAuditProgress } from "./auditProgress.js";
import { extractCompletedCourses } from "./recommendations.js";
import { normalizePlanGrid } from "./scheduleOps.js";

const PASSING = ["A+", "A", "A-", "B", "C-", "D", "D-", "P", "S", "TP"];
const NOT_PASSING = ["F", "NP", "W", "I", "U"];

test("passing grades are recognised, case and padding insensitive", () => {
  for (const g of PASSING) {
    assert.equal(isPassingGrade(g), true, g);
    assert.equal(isPassingGrade(` ${g.toLowerCase()} `), true, g);
    assert.equal(isNonPassingGrade(g), false, g);
  }
});

test("F / NP / W / I / U complete nothing", () => {
  for (const g of NOT_PASSING) {
    assert.equal(isPassingGrade(g), false, g);
    assert.equal(isNonPassingGrade(g), true, g);
  }
});

test("in-progress markers are neither passing nor failing", () => {
  for (const g of ["", "NR", "WIP", "In Progress"]) {
    assert.equal(isWipGrade(g), true, g);
    assert.equal(isNonPassingGrade(g), false, g);
  }
});

test("an unrecognised grade token is treated as not passing", () => {
  // Under-crediting is visible to the student; over-crediting hides a
  // requirement they still owe.
  assert.equal(isPassingGrade("ZZ"), false);
});

const gridWith = (course) => [
  { fall: [course], winter: [], spring: [] },
  { fall: [], winter: [], spring: [] },
  { fall: [], winter: [], spring: [] },
  { fall: [], winter: [], spring: [] },
];

const sectionNeedingCse12 = {
  title: "Core",
  status: "not_fulfilled",
  items: [],
  subrequirements: [
    {
      status: "not_fulfilled",
      subtitle: "Core",
      needType: "courses",
      needAmount: 1,
      groups: [["CSE 12"]],
      availableCodes: ["CSE 12"],
      completedCourses: [],
    },
  ],
};

test("a failed course does not project as filling the requirement", () => {
  // Only PLANNED courses drive projection, so the risk when introducing the
  // "failed" status was that it would be lumped in with planned and the failed
  // attempt would be shown as covering the very requirement it failed.
  const planned = calculateAuditProgress(
    [sectionNeedingCse12],
    gridWith({ course_id: "CSE 12", credits: 4 })
  );
  assert.equal(planned.coveredCourseSlots, 1);
  assert.equal(planned.outstandingSections, 0);

  const failed = calculateAuditProgress(
    [sectionNeedingCse12],
    gridWith({ course_id: "CSE 12", grade: "F", credits: 4 })
  );
  assert.equal(failed.coveredCourseSlots, 0);
  assert.equal(failed.outstandingSections, 1);
});

test("a failed course is not hidden from requirement options", () => {
  const sections = [
    {
      title: "Core",
      items: ["CSE 12 - Basic Data Structures (FA24, F)"],
      completedCourses: [
        { course_id: "CSE 12", grade: "F", term: "FA24" },
      ],
      subrequirements: [],
    },
  ];
  assert.deepEqual(extractCompletedCourses(sections), []);
});

test("a passed course is still hidden from requirement options", () => {
  const sections = [
    {
      title: "Core",
      items: ["CSE 12 - Basic Data Structures (FA24, B)"],
      completedCourses: [
        { course_id: "CSE 12", grade: "B", term: "FA24" },
      ],
      subrequirements: [],
    },
  ];
  assert.deepEqual(extractCompletedCourses(sections), ["CSE 12"]);
});

test("normalizePlanGrid preserves the failed status", () => {
  // It used to rewrite anything unrecognised to "planned", which would have
  // put the failed attempt back to work satisfying its own requirement.
  const grid = normalizePlanGrid(
    gridWith({ course_id: "CSE 12", grade: "F", status: "failed", credits: 4 }),
    4
  );
  assert.equal(grid[0].fall[0].status, "failed");
});
