import assert from "node:assert/strict";
import test from "node:test";

import {
  prereqPositions,
  prereqWarningFor,
  termSortKey,
  unsatisfiedPrereqGroups,
} from "./prereqCheck.js";

const cse100 = {
  known: true,
  requires: [["CSE 21"], ["CSE 12"]],
  concurrent_allowed: [],
  confidence: "parsed",
};

const ece100 = {
  known: true,
  requires: [["ECE 65"]],
  concurrent_allowed: ["ECE 65"],
  confidence: "parsed",
};

const year = (fall = [], winter = [], spring = []) => ({
  fall,
  winter,
  spring,
});

test("termSortKey is year-major then fall/winter/spring", () => {
  assert.equal(termSortKey(0, "fall"), 0);
  assert.equal(termSortKey(0, "winter"), 1);
  assert.equal(termSortKey(0, "spring"), 2);
  assert.equal(termSortKey(1, "fall"), 3);
});

test("a later course flags when its prereq is missing", () => {
  const schedule = [year([{ course_id: "CSE 100", status: "planned" }])];
  const missing = unsatisfiedPrereqGroups(
    "CSE 100",
    0,
    "fall",
    cse100,
    prereqPositions(schedule)
  );
  assert.deepEqual(
    missing.map((g) => g.opts).sort(),
    ["CSE 12", "CSE 21"]
  );
  assert.ok(prereqWarningFor({ course_id: "CSE 100" }, 0, "fall", cse100, prereqPositions(schedule)));
});

test("an earlier-quarter placement satisfies a plain prerequisite", () => {
  const schedule = [
    year(
      [{ course_id: "CSE 21", status: "planned" }, { course_id: "CSE 12", status: "planned" }],
      [{ course_id: "CSE 100", status: "planned" }]
    ),
  ];
  assert.deepEqual(
    unsatisfiedPrereqGroups("CSE 100", 0, "winter", cse100, prereqPositions(schedule)),
    []
  );
});

test("the same quarter does not satisfy a plain prerequisite", () => {
  const schedule = [
    year([
      { course_id: "CSE 21", status: "planned" },
      { course_id: "CSE 12", status: "planned" },
      { course_id: "CSE 100", status: "planned" },
    ]),
  ];
  const missing = unsatisfiedPrereqGroups(
    "CSE 100",
    0,
    "fall",
    cse100,
    prereqPositions(schedule)
  );
  assert.equal(missing.length, 2);
});

test("a corequisite may sit in the same quarter", () => {
  const schedule = [
    year([
      { course_id: "ECE 65", status: "planned" },
      { course_id: "ECE 100", status: "planned" },
    ]),
  ];
  assert.deepEqual(
    unsatisfiedPrereqGroups("ECE 100", 0, "fall", ece100, prereqPositions(schedule)),
    []
  );
});

test("audit-completed and transfer credit count as already done", () => {
  const schedule = [year([{ course_id: "CSE 100", status: "planned" }])];
  const position = prereqPositions(schedule, ["CSE 21", "CSE 12"]);
  assert.deepEqual(
    unsatisfiedPrereqGroups("CSE 100", 0, "fall", cse100, position),
    []
  );
});

test("a failed attempt does not satisfy a later prerequisite", () => {
  const schedule = [
    year(
      [{ course_id: "CSE 21", status: "failed" }, { course_id: "CSE 12", status: "planned" }],
      [{ course_id: "CSE 100", status: "planned" }]
    ),
  ];
  const missing = unsatisfiedPrereqGroups(
    "CSE 100",
    0,
    "winter",
    cse100,
    prereqPositions(schedule)
  );
  assert.deepEqual(missing.map((g) => g.opts), ["CSE 21"]);
});

test("completed and in-progress cards are not flagged", () => {
  const schedule = [year([{ course_id: "CSE 100", status: "completed" }])];
  const position = prereqPositions(schedule);
  assert.equal(
    prereqWarningFor(
      { course_id: "CSE 100", status: "completed" },
      0,
      "fall",
      cse100,
      position
    ),
    null
  );
  assert.equal(
    prereqWarningFor(
      { course_id: "CSE 100", status: "current" },
      0,
      "fall",
      cse100,
      position
    ),
    null
  );
});

test("unknown graph stays silent rather than guessing", () => {
  assert.equal(
    unsatisfiedPrereqGroups("FAKE 1", 0, "fall", { known: false }, new Map()),
    null
  );
  assert.equal(prereqWarningFor({ course_id: "FAKE 1" }, 0, "fall", null, new Map()), null);
});

test("a self-referencing prereq group is ignored", () => {
  const graph = {
    known: true,
    requires: [["CSE 158"]],
    concurrent_allowed: [],
    confidence: "parsed",
  };
  assert.deepEqual(
    unsatisfiedPrereqGroups("CSE 158", 0, "fall", graph, new Map()),
    []
  );
});

test("a cross-listed alias on the grid satisfies the catalog prereq id", () => {
  // Graph wants "DSC 80/80R"; the student planned "DSC 80".
  const graph = {
    known: true,
    requires: [["DSC 80/80R"]],
    concurrent_allowed: [],
    confidence: "parsed",
  };
  const schedule = [
    year(
      [{ course_id: "DSC 80", status: "planned" }],
      [{ course_id: "DSC 100", status: "planned" }]
    ),
  ];
  assert.deepEqual(
    unsatisfiedPrereqGroups("DSC 100", 0, "winter", graph, prereqPositions(schedule)),
    []
  );
});
