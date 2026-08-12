import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeCourseId,
  parseCredits,
  extractPrereqIds,
  indexCatalog,
  countUnlocks,
  scarcityScore,
} from "./catalog.js";

import {
  buildBookingPlan,
  unitCapFor,
  toMinutes,
  meetingsConflict,
  sectionsConflict,
  rankSections,
  scoreCriticality,
} from "./bookingPlan.js";

// --- catalog ---------------------------------------------------------------

test("normalizeCourseId canonicalizes spacing and case", () => {
  assert.equal(normalizeCourseId("cse101"), "CSE 101");
  assert.equal(normalizeCourseId("  MATH  20a "), "MATH 20A");
  assert.equal(normalizeCourseId("CSE-8A"), "CSE 8A");
  assert.equal(normalizeCourseId(""), null);
});

test("parseCredits handles the real catalog's messy values", () => {
  assert.deepEqual(parseCredits("4"), { units: 4, variable: false });
  assert.deepEqual(parseCredits("N/A"), { units: 0, variable: false });
  // Variable-unit courses assume the max so unit caps stay conservative.
  assert.deepEqual(parseCredits("2 or 4"), { units: 4, variable: true });
});

test("extractPrereqIds pulls course ids out of prose and ignores 'none'", () => {
  const ids = extractPrereqIds("MATH 10A or MATH 20A; department approval, and corequisite of CSE 4GS.");
  assert.deepEqual(ids.sort(), ["CSE 4GS", "MATH 10A", "MATH 20A"]);
  assert.deepEqual(extractPrereqIds("none."), []);
  assert.deepEqual(extractPrereqIds("None"), []);
  // "and"/"or" must not be mistaken for subject codes.
  assert.deepEqual(extractPrereqIds("restricted to undergraduates."), []);
});

test("countUnlocks follows the dependency chain transitively", () => {
  const catalog = indexCatalog([
    { course_id: "CSE 8A", credits: "4", prerequisites: "none" },
    { course_id: "CSE 8B", credits: "4", prerequisites: "CSE 8A" },
    { course_id: "CSE 12", credits: "4", prerequisites: "CSE 8B" },
    { course_id: "HIST 1", credits: "4", prerequisites: "none" },
  ]);
  const planned = ["CSE 8A", "CSE 8B", "CSE 12", "HIST 1"];

  // 8A unlocks 8B, which unlocks 12 — two downstream courses.
  assert.equal(countUnlocks("CSE 8A", planned, catalog), 2);
  assert.equal(countUnlocks("CSE 8B", planned, catalog), 1);
  assert.equal(countUnlocks("HIST 1", planned, catalog), 0);
});

test("countUnlocks only counts courses the student actually plans to take", () => {
  const catalog = indexCatalog([
    { course_id: "CSE 8A", credits: "4", prerequisites: "none" },
    { course_id: "CSE 8B", credits: "4", prerequisites: "CSE 8A" },
  ]);
  // 8B exists in the catalog but is not in this student's plan.
  assert.equal(countUnlocks("CSE 8A", ["CSE 8A"], catalog), 0);
});

test("scarcityScore rewards rarely-offered courses", () => {
  assert.equal(scarcityScore(["FA", "WI", "SP"]), 0);
  assert.equal(scarcityScore(["FA"]), 1);
  assert.equal(scarcityScore([]), 0.5); // unknown, not "never"
});

// --- time handling ---------------------------------------------------------

test("toMinutes parses 12h and 24h forms", () => {
  assert.equal(toMinutes("10:00"), 600);
  assert.equal(toMinutes("2:00p"), 840);
  assert.equal(toMinutes("12:00a"), 0);
  assert.equal(toMinutes("12:30p"), 750);
  // Both meridiem spellings, because this is now also the week grid's parser:
  // TSS renders "3:30p" while hand-entered and OData values use "3:30pm".
  assert.equal(toMinutes("3:30p"), 930);
  assert.equal(toMinutes("3:30pm"), 930);
  assert.equal(toMinutes("11:00am"), 660);
  assert.equal(toMinutes("930am"), 570);
  assert.equal(toMinutes("nonsense"), null);
});

test("meetingsConflict requires both a shared day and a time overlap", () => {
  const a = { days: ["M", "W"], start: "10:00", end: "10:50" };
  assert.equal(meetingsConflict(a, { days: ["M"], start: "10:30", end: "11:20" }), true);
  assert.equal(meetingsConflict(a, { days: ["T"], start: "10:30", end: "11:20" }), false);
  // Back-to-back is not a conflict.
  assert.equal(meetingsConflict(a, { days: ["M"], start: "10:50", end: "11:40" }), false);
});

test("sectionsConflict also compares linked discussion/lab components", () => {
  const lecture = {
    days: ["M", "W", "F"], start: "9:00", end: "9:50",
    linked: [{ days: ["T"], start: "14:00", end: "14:50" }],
  };
  const other = { days: ["T"], start: "14:30", end: "15:20" };
  // The lectures never touch, but the linked discussion collides.
  assert.equal(sectionsConflict(lecture, other), true);
});

// --- section ranking -------------------------------------------------------

test("rankSections puts open sections ahead of full ones", () => {
  const ranked = rankSections([
    { sectionId: "B00", status: "full" },
    { sectionId: "A00", status: "open", seatsTotal: 100, seatsTaken: 50 },
  ]);
  assert.equal(ranked[0].sectionId, "A00");
});

test("rankSections respects an avoidBefore preference", () => {
  const ranked = rankSections(
    [
      { sectionId: "EARLY", status: "open", days: ["M"], start: "8:00", end: "8:50" },
      { sectionId: "LATER", status: "open", days: ["M"], start: "11:00", end: "11:50" },
    ],
    { avoidBefore: "10:00" }
  );
  assert.equal(ranked[0].sectionId, "LATER");
});

// --- criticality -----------------------------------------------------------

test("a gateway course outranks a dependency-free elective", () => {
  const catalog = indexCatalog([
    { course_id: "CSE 8A", credits: "4", prerequisites: "none", offerings: ["FA", "WI", "SP"] },
    { course_id: "CSE 8B", credits: "4", prerequisites: "CSE 8A", offerings: ["WI", "SP"] },
    { course_id: "CSE 12", credits: "4", prerequisites: "CSE 8B", offerings: ["FA"] },
    { course_id: "HIST 1", credits: "4", prerequisites: "none", offerings: ["FA", "WI", "SP"] },
  ]);
  const planned = ["CSE 8A", "CSE 8B", "CSE 12", "HIST 1"];

  const gateway = scoreCriticality({
    courseId: "CSE 8A", entry: catalog.get("CSE 8A"), plannedIds: planned, catalog, sections: [],
  });
  const elective = scoreCriticality({
    courseId: "HIST 1", entry: catalog.get("HIST 1"), plannedIds: planned, catalog, sections: [],
  });

  assert.ok(gateway.score > elective.score);
  assert.match(gateway.reasons.join(" "), /unlocks 2 later courses/);
  assert.match(elective.reasons.join(" "), /safe to defer/);
});

// --- plan construction -----------------------------------------------------

const CATALOG = indexCatalog([
  { course_id: "CSE 8A", credits: "4", prerequisites: "none", offerings: ["FA", "WI", "SP"] },
  { course_id: "CSE 8B", credits: "4", prerequisites: "CSE 8A", offerings: ["WI", "SP"] },
  { course_id: "CSE 12", credits: "4", prerequisites: "CSE 8B", offerings: ["FA"] },
  { course_id: "MATH 20A", credits: "4", prerequisites: "none", offerings: ["FA", "WI", "SP"] },
  { course_id: "HIST 1", credits: "4", prerequisites: "none", offerings: ["FA", "WI", "SP"] },
]);

function gridWith(fallCourses) {
  const empty = () => ({ fall: [], winter: [], spring: [] });
  const grid = [empty(), empty(), empty(), empty()];
  grid[0].fall = fallCourses;
  grid[0].winter = [{ course_id: "CSE 8B", credits: 4 }];
  grid[1].fall = [{ course_id: "CSE 12", credits: 4 }];
  return grid;
}

test("unitCapFor matches the published UCSD caps", () => {
  assert.equal(unitCapFor({ pass: 1 }), 11.5);
  assert.equal(unitCapFor({ pass: 2 }), 19.5);
  assert.equal(unitCapFor({ level: "grad", pass: 1 }), 20);
});

test("first pass respects the 11.5 unit cap and defers the overflow", () => {
  const plan = buildBookingPlan({
    grid: gridWith([
      { course_id: "CSE 8A", credits: 4 },
      { course_id: "MATH 20A", credits: 4 },
      { course_id: "HIST 1", credits: 4 },
    ]),
    yearIndex: 0,
    term: "fall",
    termCode: "FA26",
    catalog: CATALOG,
    pass: 1,
  });

  assert.equal(plan.unitCap, 11.5);
  assert.ok(plan.totalUnits <= 11.5, `totalUnits ${plan.totalUnits} exceeded cap`);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.deferred.length, 1);
  // The elective with no downstream dependencies is what gets cut.
  assert.equal(plan.deferred[0].courseId, "HIST 1");
});

test("second pass fits all three courses", () => {
  const plan = buildBookingPlan({
    grid: gridWith([
      { course_id: "CSE 8A", credits: 4 },
      { course_id: "MATH 20A", credits: 4 },
      { course_id: "HIST 1", credits: 4 },
    ]),
    yearIndex: 0, term: "fall", termCode: "FA26", catalog: CATALOG, pass: 2,
  });
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.deferred.length, 0);
});

test("the gateway course is booked first", () => {
  const plan = buildBookingPlan({
    grid: gridWith([
      { course_id: "HIST 1", credits: 4 },
      { course_id: "CSE 8A", credits: 4 },
    ]),
    yearIndex: 0, term: "fall", termCode: "FA26", catalog: CATALOG, pass: 1,
  });
  assert.equal(plan.steps[0].courseId, "CSE 8A");
});

test("already-booked courses are excluded", () => {
  const plan = buildBookingPlan({
    grid: gridWith([
      { course_id: "CSE 8A", credits: 4 },
      { course_id: "MATH 20A", credits: 4 },
    ]),
    yearIndex: 0, term: "fall", termCode: "FA26", catalog: CATALOG, pass: 1,
    alreadyBooked: ["cse8a"],
  });
  assert.deepEqual(plan.steps.map((s) => s.courseId), ["MATH 20A"]);
});

test("a course that conflicts with everything is deferred, not silently dropped", () => {
  const clash = { days: ["M"], start: "10:00", end: "10:50", status: "open" };
  const plan = buildBookingPlan({
    grid: gridWith([
      { course_id: "CSE 8A", credits: 4 },
      { course_id: "HIST 1", credits: 4 },
    ]),
    yearIndex: 0, term: "fall", termCode: "FA26", catalog: CATALOG, pass: 1,
    sectionsByCourse: {
      "CSE 8A": [{ sectionId: "A00", ...clash }],
      "HIST 1": [{ sectionId: "A00", ...clash }],
    },
  });

  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].courseId, "CSE 8A");
  assert.equal(plan.deferred.length, 1);
  assert.match(plan.deferred[0].reason, /conflicts/);
});

test("a non-conflicting alternate section is chosen over deferring", () => {
  const plan = buildBookingPlan({
    grid: gridWith([
      { course_id: "CSE 8A", credits: 4 },
      { course_id: "HIST 1", credits: 4 },
    ]),
    yearIndex: 0, term: "fall", termCode: "FA26", catalog: CATALOG, pass: 1,
    sectionsByCourse: {
      "CSE 8A": [{ sectionId: "A00", days: ["M"], start: "10:00", end: "10:50", status: "open" }],
      "HIST 1": [
        { sectionId: "A00", days: ["M"], start: "10:00", end: "10:50", status: "open" },
        { sectionId: "B00", days: ["T"], start: "10:00", end: "10:50", status: "open" },
      ],
    },
  });

  assert.equal(plan.steps.length, 2);
  const hist = plan.steps.find((s) => s.courseId === "HIST 1");
  assert.equal(hist.targets[0].sectionId, "B00");
});

test("warns when a course is not normally offered in the target term", () => {
  const plan = buildBookingPlan({
    // CSE 12 is catalogued as fall-only; booking it in spring should warn.
    grid: (() => {
      const g = gridWith([]);
      g[0].spring = [{ course_id: "CSE 12", credits: 4 }];
      return g;
    })(),
    yearIndex: 0, term: "spring", termCode: "SP27", catalog: CATALOG, pass: 1,
  });
  assert.match(plan.warnings.join(" "), /CSE 12 is not normally offered in spring/);
});

test("warns when no section data is loaded", () => {
  const plan = buildBookingPlan({
    grid: gridWith([{ course_id: "CSE 8A", credits: 4 }]),
    yearIndex: 0, term: "fall", termCode: "FA26", catalog: CATALOG, pass: 1,
  });
  assert.match(plan.warnings.join(" "), /No section data loaded/);
});

test("an unknown course surfaces a warning instead of failing", () => {
  const plan = buildBookingPlan({
    grid: gridWith([{ course_id: "ZZZ 999", credits: 4 }]),
    yearIndex: 0, term: "fall", termCode: "FA26", catalog: CATALOG, pass: 1,
  });
  assert.match(plan.warnings.join(" "), /ZZZ 999 is not in the catalog/);
  assert.equal(plan.steps.length, 1); // still planned, just flagged
});
