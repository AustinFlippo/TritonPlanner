import assert from "node:assert/strict";
import {
  buildSeatAvailability,
  courseIdsFromText,
  courseIdsInQuarter,
  mergeSectionMaps,
  unseenSeatCourseIds,
} from "./seatAvailability.js";

assert.deepEqual(
  unseenSeatCourseIds(["DSC 80/80R", "CSE 100"], ["DSC 80R"]),
  ["CSE 100"]
);
assert.deepEqual(unseenSeatCourseIds(["DSC 80"], ["DSC 80R"]), []);

assert.deepEqual(courseIdsFromText("Is CSE 100 open? Also DSC80."), [
  "CSE 100",
  "DSC 80",
]);

const schedule = [
  {
    fall: [{ course_id: "CSE 21" }, null, { course_id: "DSC 80" }],
    winter: [],
    spring: [],
  },
];
assert.deepEqual(courseIdsInQuarter(schedule, 0, "fall"), ["CSE 21", "DSC 80"]);

const published = {
  "CSE 100": [
    {
      courseId: "CSE 100",
      sectionId: "A00",
      component: "LE",
      days: ["M", "W", "F"],
      start: "10:00am",
      end: "10:50am",
      seatsAvailable: 2,
      seatsTotal: 100,
      status: "open",
    },
  ],
};
const live = {
  "CSE 100": [
    {
      courseId: "CSE 100",
      sectionId: "A00",
      component: "LE",
      days: ["M", "W", "F"],
      start: "10:00am",
      end: "10:50am",
      seatsAvailable: 0,
      seatsTotal: 100,
      status: "full",
      termText: "Fall Quarter",
      year: "2026",
    },
  ],
};
const merged = mergeSectionMaps(published, live);
assert.equal(merged["CSE 100"][0].seatsAvailable, 0);
assert.equal(merged["CSE 100"][0].status, "full");

const payload = buildSeatAvailability({
  sectionsByCourse: merged,
  courseIds: ["CSE 100", "MATH 20C"],
  termLabel: "Fall 2026",
  source: "live",
  live: true,
  refreshedAt: 123,
});
assert.equal(payload.courses.length, 2);
assert.equal(payload.courses[0].sections[0].seatsAvailable, 0);
assert.equal(payload.courses[1].offered, false);

console.log("seatAvailability.test.mjs: ok");
