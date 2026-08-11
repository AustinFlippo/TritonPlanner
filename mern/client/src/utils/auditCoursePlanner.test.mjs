import assert from "node:assert/strict";
import test from "node:test";

import {
  convertAuditToPlanner,
  gridBaseYear,
  outOfWindowAuditCourses,
  parseCatalogYear,
  parseCourseFromAuditItem,
  parseTermToCoordinates,
  planWindow,
  readStampedGrid,
  stampGrid,
  yearLabelsFor,
} from "./auditCoursePlanner.js";

const AUG_2026 = new Date(2026, 7, 11);

test("parseCatalogYear reads the audit header value", () => {
  assert.equal(parseCatalogYear("Fall 2024"), 24);
  assert.equal(parseCatalogYear("Fall 2026"), 26);
  // Winter/Spring belong to the academic year that started the prior fall.
  assert.equal(parseCatalogYear("Winter 2025"), 24);
  assert.equal(parseCatalogYear("Spring 2025"), 24);
  assert.equal(parseCatalogYear(""), null);
  assert.equal(parseCatalogYear(null), null);
  assert.equal(parseCatalogYear("not a year"), null);
});

test("planWindow anchors Year 1 to the student's catalog year", () => {
  // A 2026 freshman gets a full 4 years starting at their own first year —
  // previously they were dropped into "Year 3" with 6 quarters left.
  assert.deepEqual(planWindow(26, AUG_2026), { baseYear: 26, yearCount: 4 });
  assert.deepEqual(yearLabelsFor(planWindow(26, AUG_2026))[0], "2026-2027");

  // A 2024 student is mid-degree; still 4 rows.
  assert.deepEqual(planWindow(24, AUG_2026), { baseYear: 24, yearCount: 4 });
});

test("planWindow grows the grid past 4 years so a fifth-year keeps this quarter", () => {
  // Started 2022, now in academic year 2026-27 = their 5th year.
  const w = planWindow(22, AUG_2026);
  assert.deepEqual(w, { baseYear: 22, yearCount: 5 });
  const labels = yearLabelsFor(w);
  assert.equal(labels.length, 5);
  assert.equal(labels[0], "2022-2023");
  // The year they're actually enrolling in is ON the grid, not off the end.
  assert.equal(labels[4], "2026-2027");
});

test("planWindow caps runaway years and falls back without a catalog year", () => {
  assert.equal(planWindow(5, AUG_2026).yearCount, 8); // garbled input capped
  // No audit loaded: keep the old calendar anchor.
  assert.deepEqual(planWindow(null, AUG_2026), {
    baseYear: gridBaseYear(AUG_2026),
    yearCount: 4,
  });
});

test("term coordinates are relative to the student's own Year 1", () => {
  const freshman = planWindow(26, AUG_2026);
  assert.deepEqual(parseTermToCoordinates("FA26", false, AUG_2026, freshman), {
    yearIndex: 0,
    quarter: "fall",
  });
  assert.deepEqual(parseTermToCoordinates("SP30", false, AUG_2026, freshman), {
    yearIndex: 3,
    quarter: "spring",
  });

  // The same term lands in a different row for a different cohort.
  const fifthYear = planWindow(22, AUG_2026);
  assert.deepEqual(parseTermToCoordinates("FA26", false, AUG_2026, fifthYear), {
    yearIndex: 4,
    quarter: "fall",
  });
  // ...and their earliest UCSD coursework now fits instead of being dropped.
  assert.deepEqual(parseTermToCoordinates("FA22", false, AUG_2026, fifthYear), {
    yearIndex: 0,
    quarter: "fall",
  });
});

test("parseCourseFromAuditItem accepts space-less course codes", () => {
  const math = parseCourseFromAuditItem("MATH183 - Statistical Methods (WI26, A+)");
  assert.deepEqual(math, {
    course_id: "MATH 183",
    course_name: "Statistical Methods",
    term: "WI26",
    grade: "A+",
    // The item string says nothing about units, so it must not claim any.
    credits: null,
  });

  const cogs = parseCourseFromAuditItem(
    "COGS108 - Data Science in Practice (SP26, A+)"
  );
  assert.equal(cogs.course_id, "COGS 108");
  assert.equal(cogs.term, "SP26");
  assert.equal(cogs.grade, "A+");
});

test("parseCourseFromAuditItem still accepts spaced codes", () => {
  const course = parseCourseFromAuditItem(
    "MATH 20A - Calculus I (FA24, TP)"
  );
  assert.equal(course.course_id, "MATH 20A");
  assert.equal(course.grade, "TP");
});

test("gridBaseYear keeps launch anchor then re-anchors at FA28", () => {
  assert.equal(gridBaseYear(new Date(2024, 9, 1)), 24);
  assert.equal(gridBaseYear(new Date(2027, 9, 1)), 24);
  assert.equal(gridBaseYear(new Date(2028, 9, 1)), 28);
  assert.equal(gridBaseYear(new Date(2029, 1, 1)), 28);
});

test("stampGrid round-trips the grid and records its base year", () => {
  const grid = [{ fall: [{ course_id: "CSE 100" }], winter: [], spring: [] }];
  const stored = stampGrid(grid, new Date(2024, 9, 1));
  assert.equal(stored.baseYear, 24);
  assert.deepEqual(readStampedGrid(stored), { grid, baseYear: 24 });

  // Saved after the FA28 re-anchor, the same year_index means something else.
  assert.equal(stampGrid(grid, new Date(2028, 9, 1)).baseYear, 28);
});

test("readStampedGrid still reads plans saved before the stamp existed", () => {
  // Rows written before stampGrid are a bare grid array.
  const legacy = [{ fall: [{ course_id: "CSE 21" }], winter: [], spring: [] }];
  assert.deepEqual(readStampedGrid(legacy), { grid: legacy, baseYear: null });

  // ...and nothing at all degrades to an empty grid rather than throwing.
  assert.deepEqual(readStampedGrid(null), { grid: [], baseYear: null });
  assert.deepEqual(readStampedGrid(undefined), { grid: [], baseYear: null });
});

test("parseTermToCoordinates maps FA28 into the grid after re-anchor", () => {
  const now = new Date(2028, 9, 1); // Oct 2028
  assert.deepEqual(parseTermToCoordinates("FA28", false, now), {
    yearIndex: 0,
    quarter: "fall",
  });
  assert.deepEqual(parseTermToCoordinates("WI29", false, now), {
    yearIndex: 0,
    quarter: "winter",
  });
  // Still inside the launch window in 2026.
  const mid = new Date(2026, 7, 10);
  assert.deepEqual(parseTermToCoordinates("FA26", false, mid), {
    yearIndex: 2,
    quarter: "fall",
  });
});

test("outOfWindowAuditCourses lists transfer/AP rows before Year 1", () => {
  // Catalog Year Fall 2024: SP22/SP23 transfer+AP credit has no UCSD term
  // on the grid, but FA24 coursework does.
  const window = planWindow(24, AUG_2026);
  const sections = [
    {
      title: "Major",
      status: "fulfilled",
      items: [
        "BILD 1 - The Cell (SP22, TP)",
        "MATH 20B - Calculus II (SP23, tP)",
        "MATH 20A - Calculus I (FA24, A)",
        "EAP 100 - Education Abroad (SU24, A)", // summer — not out-of-window
      ],
      subrequirements: [
        {
          completedCourses: [
            { course_id: "BILD 1", credits: 4 },
            { course_id: "MATH 20B", credits: 4 },
            { course_id: "MATH 20A", credits: 4 },
          ],
        },
      ],
    },
  ];

  const omitted = outOfWindowAuditCourses(sections, window, AUG_2026);
  assert.deepEqual(
    omitted.map((c) => c.course_id),
    ["BILD 1", "MATH 20B"]
  );
  // Units come from the audit's own hours column, not a default.
  assert.equal(
    omitted.reduce((sum, c) => sum + c.credits, 0),
    8
  );
});

test("audit courses take their units from the audit, never a default 4", () => {
  const window = planWindow(24, AUG_2026);
  const sections = [
    {
      title: "Major",
      status: "fulfilled",
      items: [
        "CHEM 7L - General Chemistry Lab (FA24, A)",
        "MATH 20A - Calculus I (FA24, A)",
        "DSC 152 - Unlisted Elective (WI25, A)",
      ],
      subrequirements: [
        {
          completedCourses: [
            // A 2-unit lab and a 4-unit lecture, as the audit prints them.
            { course_id: "CHEM 7L", credits: "2.0" },
            { course_id: "MATH 20A", credits: 4 },
            // No hours on the row: honestly unknown, not a fabricated 4.
            { course_id: "DSC 152", credits: null },
          ],
        },
      ],
    },
  ];

  const byId = Object.fromEntries(
    convertAuditToPlanner(sections, window).map((c) => [c.course_id, c.credits])
  );
  assert.deepEqual(byId, {
    "CHEM 7L": 2,
    "MATH 20A": 4,
    "DSC 152": null,
  });
});

test("an audit with no structured hours yields unknown units, not 4", () => {
  // Restored / pre-hours saved audits carry only the flat item strings.
  const window = planWindow(24, AUG_2026);
  const sections = [
    {
      title: "Major",
      status: "fulfilled",
      items: ["MATH 20A - Calculus I (FA24, A)"],
    },
  ];
  assert.equal(convertAuditToPlanner(sections, window)[0].credits, null);
});

test("outOfWindowAuditCourses dedupes the same course across sections", () => {
  const window = planWindow(24, AUG_2026);
  const sections = [
    {
      title: "Biology",
      items: ["BILD 1 - The Cell (SP22, TP)"],
    },
    {
      title: "GE",
      items: ["BILD 1 - The Cell (SP22, TP)"],
    },
  ];
  assert.equal(outOfWindowAuditCourses(sections, window, AUG_2026).length, 1);
});
