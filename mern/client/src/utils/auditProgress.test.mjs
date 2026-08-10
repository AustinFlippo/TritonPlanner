import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateAuditProgress,
  evaluateRequirement,
} from "./auditProgress.js";

const scheduleWith = (...courses) => [
  { fall: courses, winter: [], spring: [] },
];

test("planner's canonical cross-listed ids credit audit requirements", () => {
  const section = {
    status: "not_fulfilled",
    items: ["NEEDS: 3 more courses | Available: DSC 80, ANSC 185, HIUS 267"],
  };
  // The agent places canonical catalog ids; the audit lists plain codes.
  const result = evaluateRequirement(
    section,
    scheduleWith(
      { course_id: "DSC 80/80R", credits: 4 },
      { course_id: "AAS/ANSC 185", credits: 4 },
      { course_id: "HIUS 167/267/ETHN 180", credits: 4 }
    )
  );
  assert.equal(result.requirementResults[0].progress, 3);
  assert.equal(result.projected, true);
});

test("list-less upper-division unit requirement projects from course levels", () => {
  const section = {
    title: "48 Upper Division Unit Requirement",
    status: "not_fulfilled",
    items: ["NEEDS: 8.00 Units"],
  };
  // Lower-division CSE 21 must not count; two upper-division courses do.
  const short = evaluateRequirement(
    section,
    scheduleWith(
      { course_id: "CSE 21", credits: 4 },
      { course_id: "CSE 101", credits: 4 }
    )
  );
  assert.equal(short.requirementResults[0].progress, 4);
  assert.equal(short.projected, false);

  const covered = evaluateRequirement(
    section,
    scheduleWith(
      { course_id: "CSE 101", credits: 4 },
      { course_id: "DSC 140A", credits: 4 }
    )
  );
  assert.equal(covered.requirementResults[0].progress, 8);
  assert.equal(covered.projected, true);
});

test("unit requirement does not steal courses from list requirements", () => {
  // The same upper-division course credits BOTH its named requirement and
  // the units total — no cross-requirement exclusion for unit rules.
  const sections = [
    {
      title: "ELECTIVES",
      status: "not_fulfilled",
      items: ["NEEDS: 1 more Courses | Available: CSE 101"],
    },
    {
      title: "48 Upper Division Unit Requirement",
      status: "not_fulfilled",
      items: ["NEEDS: 4.00 Units"],
    },
  ];
  const schedule = scheduleWith({ course_id: "CSE 101", credits: 4 });
  const electives = evaluateRequirement(sections[0], schedule);
  const units = evaluateRequirement(sections[1], schedule);
  assert.equal(electives.projected, true);
  assert.equal(units.projected, true);
});

test("legacy split NEEDS and Available items form one requirement", () => {
  const section = {
    status: "not_fulfilled",
    items: ["NEEDS: 2 more courses", "Available: DSC 100, 102, 106"],
  };
  const result = evaluateRequirement(
    section,
    scheduleWith({ course_id: "DSC 100", credits: 4 })
  );

  assert.equal(result.requirementResults.length, 1);
  assert.equal(result.requirementResults[0].needAmount, 2);
  assert.deepEqual(result.requirementResults[0].availableCodes, [
    "DSC 100",
    "DSC 102",
    "DSC 106",
  ]);
  assert.equal(result.requirementResults[0].progress, 1);
  assert.equal(result.projected, false);
});

test("partial and full plan coverage update course-slot and category progress", () => {
  const sections = [
    { title: "Completed", status: "fulfilled", items: ["DSC 10 - Intro (FA24, A)"] },
    {
      title: "Electives",
      status: "not_fulfilled",
      items: [
        "NEEDS: 7 Courses | Available: DSC 100, 102, 106, 140A, 140B, 160, 180",
      ],
    },
  ];
  const partial = calculateAuditProgress(
    sections,
    scheduleWith(
      { course_id: "DSC 100", credits: 4 },
      { course_id: "DSC 102", credits: 4 },
      { course_id: "DSC 106", credits: 4 }
    )
  );

  assert.equal(partial.coveredCourseSlots, 3);
  assert.equal(partial.openCourseSlots, 7);
  assert.equal(partial.courseSlotPercent, 43);
  assert.equal(partial.verifiedPercent, 50);
  assert.equal(partial.withPlanPercent, 71);
  assert.equal(partial.projected, 1);
  assert.equal(partial.projectedPercent, 50);

  const full = calculateAuditProgress(
    sections,
    scheduleWith(
      ...["100", "102", "106", "140A", "140B", "160", "180"].map((number) => ({
        course_id: `DSC ${number}`,
        credits: 4,
      }))
    )
  );

  assert.equal(full.coveredCourseSlots, 7);
  assert.equal(full.courseSlotPercent, 100);
  assert.equal(full.withPlanPercent, 100);
  assert.equal(full.projected, 2);
  assert.equal(full.projectedPercent, 100);
});

test("multiple NEEDS rows allocate a planned course only once", () => {
  const section = {
    status: "not_fulfilled",
    items: [
      "NEEDS: 1 Course | Available: DSC 100, DSC 102",
      "NEEDS: 1 Course | Available: DSC 102, DSC 106",
    ],
  };
  const result = evaluateRequirement(
    section,
    scheduleWith(
      { course_id: "DSC 100", credits: 4 },
      { course_id: "DSC 102", credits: 4 }
    )
  );

  assert.deepEqual(
    result.requirementResults.map((requirement) =>
      requirement.matchedCourses.map((course) => course.course_id)
    ),
    [["DSC 100"], ["DSC 102"]]
  );
  assert.equal(result.projected, true);
});

test("cross-listed audit tokens match undefined-status dragged courses", () => {
  const section = {
    status: "not_fulfilled",
    subrequirements: [
      {
        status: "not_fulfilled",
        needType: "courses",
        needAmount: 1,
        availableCodes: ["DSC 80/80R"],
      },
    ],
  };
  const result = evaluateRequirement(
    section,
    scheduleWith({ course_id: "DSC80R", credits: 4 })
  );

  assert.equal(result.projected, true);
  assert.equal(result.matchedCourses[0].status, "planned");
});
