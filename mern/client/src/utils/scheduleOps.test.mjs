import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  keepTakenCourses,
  normalizePlanGrid,
  placeCourseAt,
} from "./scheduleOps.js";

const course = (id, status) => ({
  course_id: id,
  credits: 4,
  status,
});

const gridWith = (fall) => [
  { fall, winter: [null, null, null], spring: [null, null, null] },
];

describe("keepTakenCourses", () => {
  it("keeps completed and current courses, drops planned", () => {
    const schedule = [
      {
        fall: [course("CSE 8A", "completed"), course("MATH 20A", "planned"), null],
        winter: [course("CSE 8B", "current"), null, null],
        spring: [course("CSE 11", "planned"), null, null],
      },
      {
        fall: [course("CSE 12", "planned"), null, null],
        winter: [null, null, null],
        spring: [null, null, null],
      },
    ];

    const next = keepTakenCourses(schedule);

    assert.equal(next[0].fall.filter(Boolean).length, 1);
    assert.equal(next[0].fall[0].course_id, "CSE 8A");
    assert.equal(next[0].winter.filter(Boolean).length, 1);
    assert.equal(next[0].winter[0].course_id, "CSE 8B");
    assert.equal(next[0].spring.filter(Boolean).length, 0);
    assert.equal(next[1].fall.filter(Boolean).length, 0);
  });

  it("preserves year count of the incoming grid", () => {
    const schedule = Array(5)
      .fill()
      .map(() => ({
        fall: [null, null, null],
        winter: [null, null, null],
        spring: [null, null, null],
      }));
    schedule[0].fall[0] = course("BILD 1", "completed");

    const next = keepTakenCourses(schedule);
    assert.equal(next.length, 5);
    assert.equal(next[0].fall[0].course_id, "BILD 1");
  });
});

describe("placeCourseAt — sidebar drop onto an occupied slot", () => {
  it("displaces the occupant instead of deleting it", () => {
    const schedule = gridWith([course("CSE 100", "planned"), null, null]);

    const next = placeCourseAt(schedule, 0, "fall", 0, {
      course_id: "MATH 20C",
      credits: 4,
    });

    const ids = next[0].fall.filter(Boolean).map((c) => c.course_id);
    assert.deepEqual(ids, ["MATH 20C", "CSE 100"]);
  });

  it("grows the term when every slot is taken", () => {
    const schedule = gridWith([
      course("CSE 100", "planned"),
      course("CSE 101", "planned"),
      course("CSE 105", "planned"),
    ]);

    const next = placeCourseAt(schedule, 0, "fall", 1, {
      course_id: "MATH 20C",
      credits: 4,
    });

    const ids = next[0].fall.filter(Boolean).map((c) => c.course_id);
    assert.deepEqual(ids, ["CSE 100", "MATH 20C", "CSE 105", "CSE 101"]);
    assert.ok(next[0].fall.includes(null), "keeps a trailing empty slot");
  });

  it("refuses to place a course the term already holds", () => {
    const schedule = gridWith([course("CSE 100", "planned"), null, null]);

    const next = placeCourseAt(schedule, 0, "fall", 1, {
      course_id: "CSE 100",
      credits: 4,
    });

    assert.equal(next, schedule, "no-op, so the drop can't duplicate");
  });

  it("still swaps when the drag came from another grid slot", () => {
    const schedule = [
      {
        fall: [course("CSE 100", "planned"), null, null],
        winter: [course("CSE 101", "planned"), null, null],
        spring: [null, null, null],
      },
    ];

    const next = placeCourseAt(
      schedule,
      0,
      "fall",
      0,
      course("CSE 101", "planned"),
      { yearIndex: 0, term: "winter", courseIndex: 0 }
    );

    assert.equal(next[0].fall[0].course_id, "CSE 101");
    assert.equal(next[0].winter[0].course_id, "CSE 100");
  });
});

describe("placed-course credits", () => {
  it("keeps unknown units unknown rather than calling them zero", () => {
    const schedule = gridWith([null, null, null]);

    const next = placeCourseAt(schedule, 0, "fall", 0, {
      course_id: "CAT 1",
      credits: null,
    });

    assert.equal(next[0].fall[0].credits, null);
  });

  it("reads the leading number of a dash-joined sequence", () => {
    const grid = normalizePlanGrid([
      {
        fall: [{ course_id: "HILD 2A", credits: "4-4-4" }],
        winter: [],
        spring: [],
      },
    ]);

    assert.equal(grid[0].fall[0].credits, 4);
  });

  it("preserves null through a full grid normalization", () => {
    const grid = normalizePlanGrid([
      {
        fall: [{ course_id: "CCE 110", credits: null, unverified: true }],
        winter: [],
        spring: [],
      },
    ]);

    assert.equal(grid[0].fall[0].credits, null);
    assert.equal(grid[0].fall[0].status, "planned");
  });
});

describe("placeCourseAt — already taken courses", () => {
  it("refuses a sidebar drop of a course completed on the grid", () => {
    const schedule = [
      {
        fall: [course("CSE 21", "completed"), null, null],
        winter: [null, null, null],
        spring: [null, null, null],
      },
      {
        fall: [null, null, null],
        winter: [null, null, null],
        spring: [null, null, null],
      },
    ];

    const next = placeCourseAt(schedule, 1, "fall", 0, {
      course_id: "CSE 21",
      credits: 4,
    });

    assert.equal(next, schedule);
  });

  it("refuses a sidebar drop listed as taken even if it is not on the grid", () => {
    const schedule = gridWith([null, null, null]);

    const next = placeCourseAt(
      schedule,
      0,
      "fall",
      0,
      { course_id: "DSC 80", credits: 4 },
      null,
      ["DSC 80/80R"]
    );

    assert.equal(next, schedule);
  });

  it("still places a failed course so it can be retaken", () => {
    const schedule = [
      {
        fall: [course("CSE 21", "failed"), null, null],
        winter: [null, null, null],
        spring: [null, null, null],
      },
      {
        fall: [null, null, null],
        winter: [null, null, null],
        spring: [null, null, null],
      },
    ];

    const next = placeCourseAt(schedule, 1, "fall", 0, {
      course_id: "CSE 21",
      credits: 4,
    });

    assert.equal(next[1].fall[0].course_id, "CSE 21");
    assert.equal(next[1].fall[0].status, "planned");
    assert.equal(next[0].fall[0].status, "failed");
  });
});
