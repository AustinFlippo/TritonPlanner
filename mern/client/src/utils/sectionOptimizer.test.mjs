import assert from "node:assert/strict";
import {
  buildSectionOptions,
  buildSectionProposal,
  validateProposalStillFresh,
  validateSectionSelection,
} from "./sectionOptimizer.js";
import { packagesFor, packagesClash, blocksOverlap } from "./sectionPackages.js";

const le = (overrides = {}) => ({
  courseId: "CSE 100",
  sectionId: "A00",
  component: "LE",
  days: ["M", "W", "F"],
  start: "10:00am",
  end: "10:50am",
  instructor: "Gupta",
  packageId: "pkg-a",
  status: "open",
  seatsAvailable: 5,
  seatsTotal: 100,
  termText: "Fall Quarter",
  year: "2026",
  ...overrides,
});

const di = (overrides = {}) => ({
  courseId: "CSE 100",
  sectionId: "A01",
  component: "DI",
  days: ["F"],
  start: "1:00pm",
  end: "1:50pm",
  instructor: "TA",
  packageId: "pkg-a",
  status: "open",
  seatsAvailable: 5,
  seatsTotal: 100,
  termText: "Fall Quarter",
  year: "2026",
  ...overrides,
});

// Package grouping by packageId
{
  const pkgs = packagesFor([
    le(),
    di(),
    le({
      sectionId: "B00",
      packageId: "pkg-b",
      start: "11:00am",
      end: "11:50am",
      instructor: "Other",
    }),
    di({
      sectionId: "B01",
      packageId: "pkg-b",
      start: "2:00pm",
      end: "2:50pm",
    }),
  ]);
  assert.equal(pkgs.length, 2);
  assert.equal(pkgs.find((p) => p.id === "pkg-a").meetings.length, 2);
}

// Exact overlap boundary: back-to-back is NOT a conflict
{
  assert.equal(
    blocksOverlap(
      { day: "M", startMin: 600, endMin: 650 },
      { day: "M", startMin: 650, endMin: 700 }
    ),
    false
  );
  assert.equal(
    blocksOverlap(
      { day: "M", startMin: 600, endMin: 651 },
      { day: "M", startMin: 650, endMin: 700 }
    ),
    true
  );
}

const sectionsByCourse = {
  "CSE 100": [
    le(),
    di(),
    le({
      sectionId: "B00",
      packageId: "pkg-b",
      days: ["T", "R"],
      start: "10:00am",
      end: "11:20am",
      instructor: "Other",
      seatsAvailable: 0,
      status: "full",
    }),
    di({
      sectionId: "B01",
      packageId: "pkg-b",
      days: ["T"],
      start: "2:00pm",
      end: "2:50pm",
      seatsAvailable: 0,
      status: "full",
    }),
  ],
  "DSC 80": [
    {
      courseId: "DSC 80",
      sectionId: "A00",
      component: "LE",
      days: ["M", "W", "F"],
      start: "10:00am",
      end: "10:50am",
      instructor: "Staff",
      packageId: "dsc-a",
      status: "open",
      seatsAvailable: 20,
      seatsTotal: 80,
      termText: "Fall Quarter",
      year: "2026",
    },
    {
      courseId: "DSC 80",
      sectionId: "B00",
      component: "LE",
      days: ["T", "R"],
      start: "3:30pm",
      end: "4:50pm",
      instructor: "Alt",
      packageId: "dsc-b",
      status: "open",
      seatsAvailable: 10,
      seatsTotal: 80,
      termText: "Fall Quarter",
      year: "2026",
    },
  ],
};

const courses = [
  { course_id: "CSE 100", course_name: "ADS", credits: 4, enrollment: { packageId: "pkg-a" } },
  { course_id: "DSC 80", course_name: "Practice", credits: 4 },
];

const options = buildSectionOptions({
  courses,
  sectionsByCourse,
  year: "2026",
  term: "fall",
  termLabel: "Fall 2026",
  source: "live",
  live: true,
  refreshedAt: 1,
});

assert.equal(options.courses.length, 2);
assert.equal(options.courses[0].packages.length, 2);
assert.equal(options.courses[0].currentPackageId, "pkg-a");
assert.equal(options.courses[0].selectionSource, "saved");
assert.equal(
  options.courses[0].packages.find((p) => p.packageId === "pkg-a").currentlySelected,
  true
);
// DSC 80 has no saved enrollment — Quarter View draws the default first package.
assert.equal(options.courses[1].selectionSource, "default");
assert.ok(options.courses[1].currentPackageId);
assert.equal(
  options.courses[1].packages.find(
    (p) => p.packageId === options.courses[1].currentPackageId
  ).currentlySelected,
  true
);

// Conflict: CSE 100 pkg-a overlaps DSC 80 dsc-a (same MWF 10am)
{
  const bad = validateSectionSelection(options, [
    { courseId: "CSE 100", packageId: "pkg-a" },
    { courseId: "DSC 80", packageId: "dsc-a" },
  ]);
  assert.equal(bad.ok, false);
  assert.ok(bad.conflicts.some((c) => c.includes("CSE 100") && c.includes("DSC 80")));
}

// Conflict-free: CSE 100 pkg-a + DSC 80 dsc-b
{
  const good = validateSectionSelection(options, [
    { courseId: "CSE 100", packageId: "pkg-a" },
    { courseId: "DSC 80", packageId: "dsc-b" },
  ]);
  assert.equal(good.ok, true);
  assert.equal(good.conflicts.length, 0);
}

// Invalid package id
{
  const bad = validateSectionSelection(options, [
    { courseId: "CSE 100", packageId: "nope" },
  ]);
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((i) => /not a valid option/i.test(i.message)));
}

// Proposal build + freshness
{
  const built = buildSectionProposal({
    sectionOptions: options,
    selections: [
      { courseId: "CSE 100", packageId: "pkg-a" },
      { courseId: "DSC 80", packageId: "dsc-b" },
    ],
    explanation: "Afternoon DSC avoids the conflict.",
  });
  assert.equal(built.ok, true);
  assert.equal(built.proposal.selections.length, 2);
  assert.ok(built.proposal.selections.every((s) => s.enrollment?.packageId));
  assert.equal(built.proposal.afterConflicts.length, 0);

  const fresh = validateProposalStillFresh(built.proposal, options);
  assert.equal(fresh.ok, true);

  const staleOpts = buildSectionOptions({
    courses,
    sectionsByCourse: { "CSE 100": sectionsByCourse["CSE 100"] }, // DSC gone
    year: "2026",
    term: "fall",
  });
  const stale = validateProposalStillFresh(built.proposal, staleOpts);
  assert.equal(stale.ok, false);
}

// Missing / untimed sections → not offered
{
  const empty = buildSectionOptions({
    courses: [{ course_id: "MATH 20C", credits: 4 }],
    sectionsByCourse: {
      "MATH 20C": [
        {
          courseId: "MATH 20C",
          sectionId: "A00",
          component: "LE",
          // no days/times
          termText: "Fall Quarter",
          year: "2026",
        },
      ],
    },
    year: "2026",
    term: "fall",
  });
  assert.equal(empty.courses[0].offered, false);
  assert.equal(empty.courses[0].packages.length, 0);
}

// Cross-listed ids resolve section rows (DSC 80 ↔ DSC 80/80R)
{
  const xl = buildSectionOptions({
    courses: [{ course_id: "DSC 80", course_name: "Practice", credits: 4 }],
    sectionsByCourse: {
      "DSC 80/80R": [
        {
          courseId: "DSC 80/80R",
          sectionId: "A00",
          component: "LE",
          days: ["T", "R"],
          start: "3:30pm",
          end: "4:50pm",
          instructor: "Alt",
          packageId: "xl-a",
          status: "open",
          seatsAvailable: 4,
          seatsTotal: 40,
          termText: "Fall Quarter",
          year: "2026",
        },
      ],
    },
    year: "2026",
    term: "fall",
  });
  assert.equal(xl.courses[0].offered, true);
  assert.equal(xl.courses[0].packages[0].packageId, "xl-a");
}

// Default package conflicts match Quarter View (unsaved course uses packages[0])
{
  const fromDisplay = buildSectionOptions({
    courses: [
      {
        course_id: "CSE 100",
        credits: 4,
        enrollment: { packageId: "pkg-a" },
      },
      { course_id: "DSC 80", credits: 4 }, // no enrollment → default dsc-a
    ],
    sectionsByCourse,
    year: "2026",
    term: "fall",
  });
  assert.equal(fromDisplay.courses[1].currentPackageId, "dsc-a");
  assert.equal(fromDisplay.courses[1].selectionSource, "default");
  const displayed = fromDisplay.courses
    .map((c) => ({
      courseId: c.courseId,
      packageId: c.currentPackageId,
    }));
  const clash = validateSectionSelection(fromDisplay, displayed, {
    requireNoConflicts: true,
  });
  assert.equal(clash.ok, false);
  assert.ok(clash.conflicts.some((c) => /CSE 100/.test(c) && /DSC 80/.test(c)));
}

// No perfect conflict-free solution → validation fails; best-effort allowed
{
  const onlyConflict = validateSectionSelection(
    options,
    [
      { courseId: "CSE 100", packageId: "pkg-a" },
      { courseId: "DSC 80", packageId: "dsc-a" },
    ],
    { requireNoConflicts: true }
  );
  assert.equal(onlyConflict.ok, false);
  const bestEffort = validateSectionSelection(
    options,
    [
      { courseId: "CSE 100", packageId: "pkg-a" },
      { courseId: "DSC 80", packageId: "dsc-a" },
    ],
    { requireNoConflicts: false }
  );
  assert.equal(bestEffort.ok, true);
  assert.ok(bestEffort.conflicts.length > 0);
}

console.log("sectionOptimizer.test.mjs: ok");
