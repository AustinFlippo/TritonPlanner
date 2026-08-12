/**
 * Frontend flow checks for refresh → optimize → preview → apply edge cases.
 * Pure helpers only (no React / extension runtime).
 */
import assert from "node:assert/strict";
import {
  buildSectionOptions,
  buildSectionProposal,
  validateProposalStillFresh,
} from "./sectionOptimizer.js";
import { applyEnrollmentsToQuarter } from "./scheduleOps.js";

const mkPkg = (packageId, { days, start, end, instructor = "Staff" } = {}) => ({
  courseId: "CSE 100",
  sectionId: packageId.toUpperCase(),
  component: "LE",
  days,
  start,
  end,
  instructor,
  packageId,
  status: "open",
  seatsAvailable: 5,
  seatsTotal: 40,
  termText: "Fall Quarter",
  year: "2026",
});

const scheduleWith = (courses) => [
  { fall: courses, winter: [], spring: [] },
  { fall: [], winter: [], spring: [] },
  { fall: [], winter: [], spring: [] },
  { fall: [], winter: [], spring: [] },
];

function simulateApply({
  schedule,
  yearIndex,
  term,
  proposal,
  freshSectionsByCourse,
  liveOk = true,
  extensionAvailable = true,
}) {
  if (!extensionAvailable) {
    return {
      ok: false,
      reason:
        "Browser extension unavailable — install/sign in to TSS, then ask again.",
    };
  }
  if (!liveOk) {
    return {
      ok: false,
      reason: "TSS sign-in expired — refresh while signed in, then ask again.",
    };
  }

  const quarterCourses = (schedule?.[yearIndex]?.[term] || []).filter(
    (c) => c && c.course_id
  );
  const present = new Set(quarterCourses.map((c) => c.course_id));
  const missing = (proposal.selections || [])
    .map((s) => s.courseId)
    .filter((id) => !present.has(id));
  if (missing.length) {
    return {
      ok: false,
      reason: `These courses left the enrollment quarter: ${missing.join(", ")}.`,
    };
  }

  const freshOptions = buildSectionOptions({
    courses: quarterCourses,
    sectionsByCourse: freshSectionsByCourse,
    year: "2026",
    term,
    termLabel: "Fall 2026",
    source: "live",
    live: true,
    refreshedAt: Date.now(),
  });
  const freshness = validateProposalStillFresh(proposal, freshOptions);
  if (!freshness.ok) {
    return { ok: false, reason: freshness.reason };
  }

  const updates = proposal.selections.map((row) => ({
    courseId: row.courseId,
    enrollment: { ...row.enrollment, selectedAt: 123 },
  }));
  return {
    ok: true,
    schedule: applyEnrollmentsToQuarter(schedule, yearIndex, term, updates),
  };
}

const sections = {
  "CSE 100": [
    mkPkg("pkg-a", {
      days: ["M", "W", "F"],
      start: "10:00am",
      end: "10:50am",
      instructor: "Gupta",
    }),
    mkPkg("pkg-b", {
      days: ["T", "R"],
      start: "2:00pm",
      end: "3:20pm",
      instructor: "Alt",
    }),
  ],
  "DSC 80": [
    {
      ...mkPkg("dsc-b", {
        days: ["T", "R"],
        start: "3:30pm",
        end: "4:50pm",
        instructor: "Alt",
      }),
      courseId: "DSC 80",
    },
  ],
};

const courses = [
  { course_id: "CSE 100", course_name: "ADS", credits: 4 },
  { course_id: "DSC 80", course_name: "Practice", credits: 4 },
];

const options = buildSectionOptions({
  courses,
  sectionsByCourse: sections,
  year: "2026",
  term: "fall",
  termLabel: "Fall 2026",
  live: true,
  source: "live",
});

const built = buildSectionProposal({
  sectionOptions: options,
  selections: [
    { courseId: "CSE 100", packageId: "pkg-b" },
    { courseId: "DSC 80", packageId: "dsc-b" },
  ],
  explanation: "Afternoon packages avoid the morning clash.",
});
assert.equal(built.ok, true);

// Happy path: refresh options still match → apply writes enrollments
{
  const schedule = scheduleWith(courses.map((c) => ({ ...c })));
  const result = simulateApply({
    schedule,
    yearIndex: 0,
    term: "fall",
    proposal: built.proposal,
    freshSectionsByCourse: sections,
  });
  assert.equal(result.ok, true);
  assert.equal(
    result.schedule[0].fall.find((c) => c.course_id === "CSE 100").enrollment
      .packageId,
    "pkg-b"
  );
  assert.equal(
    result.schedule[0].fall.find((c) => c.course_id === "DSC 80").enrollment
      .packageId,
    "dsc-b"
  );
}

// Extension unavailable
{
  const result = simulateApply({
    schedule: scheduleWith(courses),
    yearIndex: 0,
    term: "fall",
    proposal: built.proposal,
    freshSectionsByCourse: sections,
    extensionAvailable: false,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /extension unavailable/i);
}

// TSS sign-in expired
{
  const result = simulateApply({
    schedule: scheduleWith(courses),
    yearIndex: 0,
    term: "fall",
    proposal: built.proposal,
    freshSectionsByCourse: sections,
    liveOk: false,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /sign-in expired/i);
}

// Course removed from enrollment quarter during optimization
{
  const result = simulateApply({
    schedule: scheduleWith([{ course_id: "CSE 100", credits: 4 }]),
    yearIndex: 0,
    term: "fall",
    proposal: built.proposal,
    freshSectionsByCourse: sections,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /left the enrollment quarter/i);
}

// Package data changed before Apply (selected package gone)
{
  const changed = {
    "CSE 100": [
      mkPkg("pkg-a", {
        days: ["M", "W", "F"],
        start: "10:00am",
        end: "10:50am",
      }),
    ],
    "DSC 80": sections["DSC 80"],
  };
  const result = simulateApply({
    schedule: scheduleWith(courses.map((c) => ({ ...c }))),
    yearIndex: 0,
    term: "fall",
    proposal: built.proposal,
    freshSectionsByCourse: changed,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not a valid option|no longer available|refresh/i);
}

console.log("sectionOptimizerFlow.test.mjs: ok");
