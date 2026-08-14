import assert from "node:assert/strict";
import {
  buildOfferedCompactSet,
  enrollmentPlacementBlock,
  enrollmentSeatWarning,
  isCourseOfferedNext,
  offeringsFromPublished,
  overlayLiveSeats,
} from "./nextQuarterOfferings.js";

const courses = offeringsFromPublished({
  courses: {
    "DSC 80/80R": [
      { courseId: "DSC 80/80R", courseName: "Practice and Application", units: 4 },
    ],
    "CSE 100": [{ courseId: "CSE 100", courseName: "Advanced Data Structures", units: 4 }],
  },
});

assert.equal(courses.length, 2);
assert.equal(courses[0].courseId, "CSE 100");

const offered = buildOfferedCompactSet(courses);
assert.equal(isCourseOfferedNext("CSE 100", offered), true);
assert.equal(isCourseOfferedNext("DSC 80", offered), true, "alias should match published cross-list");
assert.equal(isCourseOfferedNext("DSC 80/80R", offered), true);
assert.equal(isCourseOfferedNext("MATH 20A", offered), false);
assert.equal(isCourseOfferedNext("CSE 100", new Set()), false);
assert.equal(isCourseOfferedNext(null, offered), false);

// overlayLiveSeats: seat fields update, structure survives, unmatched stays.
{
  const snapshot = {
    "BILD 1": [
      {
        sectionRef: "FA26:E 00001249",
        sectionId: "001-000-LE",
        days: ["T", "R"],
        start: "3:30pm",
        instructor: "Stacy Ochoa",
        seatsAvailable: 182,
        seatsTotal: 237,
        seatsTaken: 55,
        status: "open",
      },
      {
        sectionRef: "FA26:E 00003826",
        sectionId: "001-001-DI",
        days: ["F"],
        seatsAvailable: 52,
        status: "open",
      },
    ],
  };
  const live = {
    "BILD 1": [
      {
        sectionRef: "FA26:E 00001249",
        seatsAvailable: 0,
        seatsTotal: 237,
        seatsTaken: 237,
        waitlisted: 4,
        status: "waitlist active",
      },
    ],
  };
  const merged = overlayLiveSeats(snapshot, live);
  const lecture = merged["BILD 1"][0];
  assert.equal(lecture.seatsAvailable, 0, "live seat count replaces snapshot");
  assert.equal(lecture.status, "waitlist active");
  assert.equal(lecture.instructor, "Stacy Ochoa", "structure must survive the overlay");
  assert.deepEqual(lecture.days, ["T", "R"]);
  assert.equal(merged["BILD 1"][1].seatsAvailable, 52, "unmatched section keeps snapshot seats");
  // A live list for a course the snapshot lacks must not invent sections.
  const noInvent = overlayLiveSeats({}, live);
  assert.equal(noInvent["BILD 1"], undefined);
  // Snapshot untouched (no mutation).
  assert.equal(snapshot["BILD 1"][0].seatsAvailable, 182);

  // A live row full of nulls must not erase real snapshot numbers. Class
  // Planner omits capacity for some sections, and the proxy's stale fallback
  // echoes whatever it had — assigning those unconditionally turned "182 seats"
  // into no seat signal at all.
  const blanks = overlayLiveSeats(snapshot, {
    "BILD 1": [
      {
        sectionRef: "FA26:E 00001249",
        seatsAvailable: null,
        seatsTotal: null,
        seatsTaken: null,
        waitlisted: null,
        status: null,
      },
    ],
  });
  const kept = blanks["BILD 1"][0];
  assert.equal(kept.seatsAvailable, 182, "a null live seat count must not erase the snapshot's");
  assert.equal(kept.seatsTotal, 237);
  assert.equal(kept.seatsTaken, 55);
  assert.equal(kept.status, "open");

  // A real zero is not a null: "0 seats left" must still come through.
  const zeroed = overlayLiveSeats(snapshot, {
    "BILD 1": [{ sectionRef: "FA26:E 00001249", seatsAvailable: 0, status: "full" }],
  });
  assert.equal(zeroed["BILD 1"][0].seatsAvailable, 0, "0 is a real count, not a missing one");
  assert.equal(zeroed["BILD 1"][0].status, "full");
}

{
  const course = { course_id: "CSE 100" };
  assert.equal(
    enrollmentPlacementBlock(course, { offeringsReady: false, isOffered: () => false }),
    null,
    "no live feed → do not block"
  );
  assert.equal(
    enrollmentPlacementBlock(
      { course_id: "CSE 100", status: "completed" },
      { offeringsReady: true, isOffered: () => false }
    ),
    null,
    "completed cards stay put"
  );
  const notLive = enrollmentPlacementBlock(course, {
    offeringsReady: true,
    isOffered: () => false,
  });
  assert.equal(notLive.type, "not-live");
  assert.equal(
    enrollmentPlacementBlock(course, {
      offeringsReady: true,
      isOffered: () => true,
      seatChip: { kind: "full" },
    }),
    null,
    "full still places"
  );
  assert.equal(
    enrollmentPlacementBlock(course, {
      offeringsReady: true,
      isOffered: () => true,
      seatChip: { kind: "waitlist" },
    }),
    null,
    "waitlist still places"
  );
  assert.equal(
    enrollmentSeatWarning(course, {
      offeringsReady: true,
      isOffered: () => true,
      seatChip: { kind: "full" },
    }).type,
    "full"
  );
  assert.equal(
    enrollmentSeatWarning(course, {
      offeringsReady: true,
      isOffered: () => true,
      seatChip: { kind: "waitlist" },
    }).type,
    "waitlist"
  );
  assert.equal(
    enrollmentSeatWarning(course, {
      offeringsReady: true,
      isOffered: () => false,
      seatChip: { kind: "full" },
    }),
    null,
    "not-offered is a block, not a seat warning"
  );
  assert.equal(
    enrollmentPlacementBlock(course, {
      offeringsReady: true,
      isOffered: () => true,
      seatChip: { kind: "open", seatsAvailable: 12 },
    }),
    null
  );
}

console.log("nextQuarterOfferings.test.mjs: ok");
