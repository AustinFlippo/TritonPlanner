import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  countPlacedCourses,
  localPlanBelongsTo,
  resolvePlanConflict,
} from "./plannerStateStore.js";

const ALICE = "alice-uuid";
const BOB = "bob-uuid";

const gridOf = (...courseIds) => [
  {
    fall: courseIds.map((id) => ({ course_id: id, credits: 4 })),
    winter: [],
    spring: [],
  },
];

const blob = ({ ownerId = null, courses = ["CSE 100"], savedAt = 1000 }) => ({
  ownerId,
  schedule: gridOf(...courses),
  parsedCourseData: { sections: [], metadata: {} },
  savedAt,
});

const iso = (ms) => new Date(ms).toISOString();

describe("localPlanBelongsTo", () => {
  it("treats signed-out state as adoptable by anyone", () => {
    assert.equal(localPlanBelongsTo({ ownerId: null }, ALICE), true);
    assert.equal(localPlanBelongsTo({}, ALICE), true);
  });

  it("rejects state stamped with a different account", () => {
    assert.equal(localPlanBelongsTo({ ownerId: BOB }, ALICE), false);
  });

  it("accepts the owner's own state", () => {
    assert.equal(localPlanBelongsTo({ ownerId: ALICE }, ALICE), true);
  });
});

describe("resolvePlanConflict — ownership", () => {
  it("never applies or uploads another student's device copy", () => {
    const result = resolvePlanConflict({
      local: blob({ ownerId: BOB, courses: ["CSE 100", "CSE 101"] }),
      server: null,
      userId: ALICE,
    });

    assert.equal(result.apply, "none");
    assert.equal(result.upload, false);
  });

  it("prefers the account's own plan over a stranger's newer local blob", () => {
    const result = resolvePlanConflict({
      local: blob({ ownerId: BOB, savedAt: 9_000_000 }),
      server: { schedule: gridOf("MATH 20A") },
      serverUpdatedAt: iso(1_000_000),
      userId: ALICE,
    });

    assert.equal(result.apply, "server");
    assert.equal(result.upload, false);
  });
});

describe("resolvePlanConflict — anonymous migration", () => {
  it("adopts anonymous local work when the account has no plan", () => {
    const result = resolvePlanConflict({
      local: blob({ ownerId: null }),
      server: null,
      userId: ALICE,
    });

    assert.equal(result.apply, "local");
    assert.equal(result.upload, true);
  });

  it("does not let an anonymous doodle replace a real account plan", () => {
    const result = resolvePlanConflict({
      local: blob({ ownerId: null, courses: ["CSE 100"], savedAt: 9_000_000 }),
      server: { schedule: gridOf("A", "B", "C", "D", "E") },
      serverUpdatedAt: iso(1_000_000),
      userId: ALICE,
    });

    assert.equal(result.apply, "server");
    assert.equal(result.upload, false);
  });
});

describe("resolvePlanConflict — same owner", () => {
  it("keeps the richer plan when the two writes are seconds apart", () => {
    // The drag-during-hydration case: the local write is synchronous, so its
    // timestamp always leads the server's, but it holds one course.
    const now = 1_700_000_000_000;
    const result = resolvePlanConflict({
      local: blob({ ownerId: ALICE, courses: ["CSE 100"], savedAt: now + 400 }),
      server: { schedule: gridOf("A", "B", "C", "D") },
      serverUpdatedAt: iso(now),
      userId: ALICE,
    });

    assert.equal(result.apply, "server");
    assert.equal(result.upload, false);
  });

  it("takes the local side when it is both recent and richer", () => {
    const now = 1_700_000_000_000;
    const result = resolvePlanConflict({
      local: blob({
        ownerId: ALICE,
        courses: ["A", "B", "C"],
        savedAt: now + 400,
      }),
      server: { schedule: gridOf("A") },
      serverUpdatedAt: iso(now),
      userId: ALICE,
    });

    assert.equal(result.apply, "local");
    assert.equal(result.upload, true);
  });

  it("honours a genuinely later local edit", () => {
    const now = 1_700_000_000_000;
    const result = resolvePlanConflict({
      local: blob({ ownerId: ALICE, courses: ["A"], savedAt: now + 600_000 }),
      server: { schedule: gridOf("A", "B", "C") },
      serverUpdatedAt: iso(now),
      userId: ALICE,
    });

    assert.equal(result.apply, "local");
    assert.equal(result.upload, true);
  });

  it("falls back to the server when neither side has anything", () => {
    const result = resolvePlanConflict({ local: null, server: null, userId: ALICE });
    assert.equal(result.apply, "none");
    assert.equal(result.upload, false);
  });
});

describe("countPlacedCourses", () => {
  it("counts across years and terms, ignoring empty slots", () => {
    const grid = [
      {
        fall: [{ course_id: "A" }, null],
        winter: [null],
        spring: [{ course_id: "B" }],
      },
      { fall: [{ course_id: "C" }], winter: [], spring: [] },
    ];
    assert.equal(countPlacedCourses(grid), 3);
    assert.equal(countPlacedCourses(null), 0);
  });
});
