// Package grouping and multi-meeting parsing.
//
// Both behaviours here replace ones that silently lost data, so each test names
// the real course it was reduced from.

import assert from "node:assert/strict";
import test from "node:test";
import {
  blocksOf,
  blocksOverlap,
  courseSeatChip,
  normalizeSectionStatus,
  packageIdsOf,
  packageMatchesId,
  packagesFor,
  whenLabel,
} from "./sectionPackages.js";

const year = "2026";
const sec = (over) => ({
  courseId: "CSE 8A",
  year,
  days: ["M"],
  start: "10:00am",
  end: "10:50am",
  seatsAvailable: 20,
  seatsTotal: 30,
  status: "open",
  ...over,
});

// ---------------------------------------------------------------------------
// FIX 1: a section belongs to EVERY package that names it.
//
// CSE 8A really has one lecture, one discussion and nine labs; the lecture and
// discussion are members of all nine packages. Reading only packageIds[0] put
// them in one package and left the other eight as lab-only orphans, so eight of
// the nine enrollable combinations could not be represented at all.

test("a shared lecture appears in every package its labs define", () => {
  const sections = [
    sec({ sectionId: "001-000-LE", component: "LE", packageIds: ["p1", "p2", "p3"], seatsAvailable: 40 }),
    sec({ sectionId: "001-001-DI", component: "DI", packageIds: ["p1", "p2", "p3"], days: ["F"], seatsAvailable: 40 }),
    sec({ sectionId: "001-001-LA", component: "LA", packageIds: ["x9", "p1"], days: ["W"], start: "9:00am", end: "9:50am", seatsAvailable: 12 }),
    sec({ sectionId: "001-002-LA", component: "LA", packageIds: ["p2"], days: ["W"], start: "10:00am", end: "10:50am", seatsAvailable: 5 }),
    sec({ sectionId: "001-003-LA", component: "LA", packageIds: ["p3"], days: ["W"], start: "11:00am", end: "11:50am", seatsAvailable: 0, status: "full" }),
  ];

  const packages = packagesFor(sections);
  assert.equal(packages.length, 3, "one package per lab, not one total");

  for (const pkg of packages) {
    const components = pkg.meetings.map((m) => m.component).sort();
    assert.deepEqual(components, ["DI", "LA", "LE"], `${pkg.id} should be a full bundle`);
  }

  // "x9" is an id the lab carries from another course's package family. Once
  // real lecture-bearing packages exist, it is not something anyone can enrol
  // in, so it must not show up as a lab-only option.
  assert.equal(
    packages.some((p) => p.meetings.every((m) => m.component === "LA")),
    false,
    "lab-only orphan package should be dropped"
  );
});

test("a lecture-only package id is not offered when the lecture needs a discussion", () => {
  // MATH 20C's lecture carries nine package ids, only six of which name a
  // discussion. The lecture-only ones are not bookable — and being the whole
  // (large) lecture hall they sorted straight to the top on seat count, so the
  // package shown by default was one nobody could actually enrol in.
  const sections = [
    sec({ sectionId: "001-000-LE", component: "LE", packageIds: ["solo1", "solo2", "d1", "d2"], seatsAvailable: 300 }),
    sec({ sectionId: "001-001-DI", component: "DI", packageIds: ["d1"], days: ["R"], start: "9:00am", end: "9:50am", seatsAvailable: 4 }),
    sec({ sectionId: "001-002-DI", component: "DI", packageIds: ["d2"], days: ["R"], start: "10:00am", end: "10:50am", seatsAvailable: 7 }),
  ];
  const packages = packagesFor(sections);
  assert.equal(packages.length, 2, "one per discussion; the lecture-alone ids are not options");
  for (const pkg of packages) {
    assert.deepEqual(pkg.meetings.map((m) => m.component).sort(), ["DI", "LE"]);
  }
  assert.equal(packages[0].seatsAvailable, 7, "ranked on the bundle's seats, not the lecture's 300");
});

test("a lecture with no discussion at all stays offered", () => {
  // The subset rule must not empty a course that genuinely is lecture-only.
  const packages = packagesFor([
    sec({ sectionId: "A00", component: "LE", packageIds: ["p1", "p2"] }),
  ]);
  assert.equal(packages.length, 1);
  assert.deepEqual(packages[0].packageIds, ["p1", "p2"]);
});

test("package seats are the bundle minimum, not the lecture's", () => {
  const sections = [
    sec({ sectionId: "LE", component: "LE", packageIds: ["p1"], seatsAvailable: 200, seatsTotal: 200 }),
    sec({ sectionId: "LA1", component: "LA", packageIds: ["p1"], days: ["W"], seatsAvailable: 3, seatsTotal: 24 }),
  ];
  const [pkg] = packagesFor(sections);
  assert.equal(pkg.seatsAvailable, 3, "you need a seat in every section of the package");
  assert.equal(pkg.seatsTotal, 24);
  assert.equal(pkg.seatsLimitedBy.sectionId, "LA1");
});

test("a package with a full lab is not open because its lecture is", () => {
  const sections = [
    sec({ sectionId: "LE", component: "LE", packageIds: ["p1"], seatsAvailable: 100, status: "open" }),
    sec({ sectionId: "LA1", component: "LA", packageIds: ["p1"], days: ["W"], seatsAvailable: 0, status: "full" }),
  ];
  const [pkg] = packagesFor(sections);
  assert.equal(pkg.status, "full");
  assert.equal(pkg.seatsAvailable, 0);
  assert.equal(courseSeatChip(sections).kind, "full");
});

test("duplicate package ids for the same bundle collapse, and still resolve", () => {
  // UCSD hands out several ids that resolve to the same single section.
  const sections = [
    sec({ sectionId: "LA5", component: "LA", packageIds: ["a", "b", "c"], days: ["W"] }),
  ];
  const packages = packagesFor(sections);
  assert.equal(packages.length, 1, "three ids, one bundle, one option");
  assert.deepEqual(packages[0].packageIds, ["a", "b", "c"]);
  assert.equal(packages[0].id, "a");
  // A plan saved under a collapsed alias must not silently revert.
  assert.equal(packageMatchesId(packages[0], "c"), true);
  assert.equal(packageMatchesId(packages[0], "zz"), false);
});

test("legacy rows carrying only packageId still group", () => {
  const sections = [
    sec({ sectionId: "A00", component: "LE", packageId: "old1" }),
    sec({ sectionId: "A01", component: "DI", packageId: "old1", days: ["W"] }),
    sec({ sectionId: "B00", component: "LE", packageId: "old2", days: ["T"] }),
  ];
  assert.deepEqual(packageIdsOf({ packageId: "old1" }), ["old1"]);
  const packages = packagesFor(sections);
  assert.equal(packages.length, 2);
  assert.equal(packages.find((p) => p.id === "old1").meetings.length, 2);
});

test("rows with no package id at all fall back to the section letter", () => {
  // DOM scrapes from the extension carry neither field.
  assert.deepEqual(packageIdsOf({ sectionId: "A01" }), ["letter:A"]);
  const packages = packagesFor([
    sec({ sectionId: "A00", component: "LE", packageId: null, packageIds: [] }),
    sec({ sectionId: "A01", component: "DI", packageId: null, packageIds: [], days: ["W"] }),
  ]);
  assert.equal(packages.length, 1);
  assert.equal(packages[0].id, "letter:A");
});

test("a lecture-free course keeps its packages", () => {
  // BIBC 103 is lab-only. The orphan filter must not empty it.
  const packages = packagesFor([
    sec({ sectionId: "LA1", component: "LA", packageIds: ["p1"] }),
    sec({ sectionId: "LA2", component: "LA", packageIds: ["p2"], days: ["T"] }),
  ]);
  assert.equal(packages.length, 2);
});

// ---------------------------------------------------------------------------
// FIX 2: a section can meet at more than one time in a week.
//
// BENG 133's lecture is M 11:00–11:50 *and* T/R 9:30–10:50. Unioning the days
// while keeping the first meeting's clock stored that as "MTR 11:00–11:50" —
// a phantom Tue/Thu 11am block plus two missing 9:30 ones.

const beng133 = {
  courseId: "BENG 133",
  sectionId: "001-000-LE",
  component: "LE",
  year,
  meetings: [
    { days: ["M"], start: "11:00am", end: "11:50am", location: "WLH 2112" },
    { days: ["T", "R"], start: "9:30am", end: "10:50am", location: "WLH 2112" },
  ],
  days: ["M"],
  start: "11:00am",
  end: "11:50am",
  location: "WLH 2112",
  status: "open",
};

test("blocksOf expands every weekly meeting", () => {
  const blocks = blocksOf(beng133);
  assert.equal(blocks.length, 3, "M + T + R");
  const mon = blocks.find((b) => b.day === "M");
  const thu = blocks.find((b) => b.day === "R");
  assert.equal(mon.startMin, 11 * 60);
  assert.equal(thu.startMin, 9 * 60 + 30);
  assert.equal(thu.endMin, 10 * 60 + 50);
  // Each block carries its own label so the grid draws the right time.
  assert.equal(thu.start, "9:30am");
  assert.equal(thu.location, "WLH 2112");
});

test("a 9:30 class conflicts with the 9:30 meeting, not the 11:00 one", () => {
  const other = {
    courseId: "MATH 20C",
    sectionId: "A00",
    component: "LE",
    year,
    days: ["R"],
    start: "10:00am",
    end: "10:50am",
    status: "open",
  };
  const clash = blocksOf(beng133).some((a) =>
    blocksOf(other).some((b) => blocksOverlap(a, b))
  );
  assert.equal(clash, true, "Thu 9:30–10:50 overlaps Thu 10:00–10:50");

  // …and the phantom the old flattening invented must not conflict.
  const tueEleven = { ...other, courseId: "X", days: ["T"], start: "11:00am", end: "11:50am" };
  const phantom = blocksOf(beng133).some((a) =>
    blocksOf(tueEleven).some((b) => blocksOverlap(a, b))
  );
  assert.equal(phantom, false, "there is no Tue 11:00 meeting");
});

test("blocksOf falls back to flat fields when meetings is absent", () => {
  const blocks = blocksOf({ days: ["M", "W"], start: "2:00pm", end: "3:20pm" });
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].startMin, 14 * 60);
});

test("whenLabel names both meetings of a multi-meeting section", () => {
  assert.equal(whenLabel(beng133), "M 11:00am–11:50am + TuTh 9:30am–10:50am");
  assert.equal(
    whenLabel({ days: ["T", "R"], start: "11:00am", end: "12:20pm" }),
    "TuTh 11:00am–12:20pm"
  );
});

// ---------------------------------------------------------------------------
// FIX 6: one spelling of "waitlist-active".

test("waitlist status is normalized to the hyphenated vocabulary", () => {
  assert.equal(normalizeSectionStatus("waitlist active"), "waitlist-active");
  assert.equal(normalizeSectionStatus("Waitlist Active"), "waitlist-active");
  assert.equal(normalizeSectionStatus("waitlist-active"), "waitlist-active");
  assert.equal(normalizeSectionStatus(null), null);
});

test("a waitlisted course reads as Waitlist, not Full, whichever spelling arrived", () => {
  for (const spelling of ["waitlist active", "waitlist-active"]) {
    const chip = courseSeatChip([
      sec({ sectionId: "A00", component: "LE", packageIds: ["p1"], seatsAvailable: 0, status: spelling }),
    ]);
    assert.equal(chip.kind, "waitlist", `"${spelling}" should rank as a waitlist`);
    assert.equal(chip.label, "Waitlist");
  }
});

test("packagesFor normalizes the status it reports", () => {
  const [pkg] = packagesFor([
    sec({ sectionId: "A00", component: "LE", packageIds: ["p1"], seatsAvailable: 0, status: "waitlist active" }),
  ]);
  assert.equal(pkg.status, "waitlist-active");
});
