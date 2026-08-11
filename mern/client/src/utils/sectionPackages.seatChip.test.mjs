import assert from "node:assert/strict";
import { courseSeatChip } from "./sectionPackages.js";

const openLecture = {
  courseId: "CSE 100",
  sectionId: "A00",
  component: "LE",
  days: ["M", "W", "F"],
  start: "10:00am",
  end: "10:50am",
  packageId: "p1",
  seatsAvailable: 12,
  seatsTotal: 100,
  status: "open",
};

assert.equal(courseSeatChip([]), null);
assert.equal(courseSeatChip(null), null);

const open = courseSeatChip([openLecture]);
assert.equal(open.kind, "open");
assert.equal(open.label, "12 left");

const full = courseSeatChip([
  { ...openLecture, seatsAvailable: 0, status: "full" },
  {
    ...openLecture,
    sectionId: "B00",
    packageId: "p2",
    seatsAvailable: 0,
    status: "full",
  },
]);
assert.equal(full.kind, "full");
assert.equal(full.label, "Full");

const waitlist = courseSeatChip([
  {
    ...openLecture,
    seatsAvailable: 0,
    status: "waitlist-active",
  },
]);
assert.equal(waitlist.kind, "waitlist");
assert.equal(waitlist.label, "Waitlist");

// Best open section wins the number (not a sum across packages).
const multi = courseSeatChip([
  { ...openLecture, seatsAvailable: 3 },
  {
    ...openLecture,
    sectionId: "B00",
    packageId: "p2",
    seatsAvailable: 18,
    status: "open",
  },
]);
assert.equal(multi.label, "18 left");

// Untimed independent-study rows still get a seat chip.
const untimed = courseSeatChip([
  {
    courseId: "AAS 198",
    sectionId: "001",
    component: "IN",
    days: [],
    start: null,
    seatsAvailable: 10,
    seatsTotal: 10,
    status: "open",
  },
]);
assert.equal(untimed.kind, "open");
assert.equal(untimed.label, "10 left");

console.log("sectionPackages.seatChip.test.mjs: ok");
