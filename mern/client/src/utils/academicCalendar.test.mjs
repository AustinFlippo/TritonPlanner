// The enrollment quarter must track the ENROLLMENT window, not the quarter in
// progress. UCSD opens enrollment around week 6 of the prior quarter, so from
// mid-November a student is shopping Winter — and Class Planner has already
// rolled over. The old month-only rule returned Fall on 15 Nov, which made both
// fetchServerTerm and loadNextQuarterOfferings reject the server's payload on a
// term mismatch and blanked the whole schedule feature for weeks.

import assert from "node:assert/strict";
import test from "node:test";
import { levelOfCourseId, nextEnrollmentQuarter } from "./academicCalendar.js";

// Local noon avoids a UTC-vs-local date rollover changing the day under test.
const on = (y, m, d) => nextEnrollmentQuarter(new Date(y, m - 1, d, 12));

test("today (2026-08-11) still resolves to FA26 / academicYear 2026", () => {
  const q = on(2026, 8, 11);
  assert.equal(q.term, "fall");
  assert.equal(q.termCode, "FA");
  assert.equal(q.chipLabel, "FA26");
  assert.equal(q.calendarYear, "2026");
  assert.equal(q.academicYear, "2026");
  assert.equal(q.label, "Fall 2026");
});

test("mid-November opens Winter enrollment, in the next calendar year", () => {
  const before = on(2026, 11, 14);
  assert.equal(before.term, "fall", "Nov 14 is still the Fall window");

  const q = on(2026, 11, 15);
  assert.equal(q.term, "winter");
  assert.equal(q.chipLabel, "WI27");
  assert.equal(q.calendarYear, "2027");
  // TSS AcademicYear is the start of the academic year: WI27 belongs to 2026.
  assert.equal(q.academicYear, "2026");
});

test("December stays on Winter", () => {
  const q = on(2026, 12, 20);
  assert.equal(q.chipLabel, "WI27");
  assert.equal(q.academicYear, "2026");
});

test("January is Winter in the current calendar year", () => {
  const q = on(2027, 1, 10);
  assert.equal(q.term, "winter");
  assert.equal(q.chipLabel, "WI27");
  assert.equal(q.academicYear, "2026");
});

test("late February rolls to Spring", () => {
  assert.equal(on(2027, 2, 19).term, "winter", "Feb 19 is still Winter");

  const q = on(2027, 2, 20);
  assert.equal(q.term, "spring");
  assert.equal(q.chipLabel, "SP27");
  assert.equal(q.calendarYear, "2027");
  assert.equal(q.academicYear, "2026");
});

test("mid-May rolls to the next Fall", () => {
  assert.equal(on(2027, 5, 14).term, "spring", "May 14 is still Spring");

  const q = on(2027, 5, 15);
  assert.equal(q.term, "fall");
  assert.equal(q.chipLabel, "FA27");
  assert.equal(q.calendarYear, "2027");
  // A new academic year starts at Fall.
  assert.equal(q.academicYear, "2027");
});

test("summer points at the Fall that enrollment is open for", () => {
  const q = on(2027, 7, 4);
  assert.equal(q.term, "fall");
  assert.equal(q.academicYear, "2027");
});

test("every day of a year resolves to a real quarter", () => {
  const d = new Date(2026, 0, 1, 12);
  while (d.getFullYear() === 2026) {
    const q = nextEnrollmentQuarter(d);
    assert.ok(["fall", "winter", "spring"].includes(q.term), String(d));
    assert.match(q.chipLabel, /^(FA|WI|SP)\d{2}$/);
    d.setDate(d.getDate() + 1);
  }
});

test("levelOfCourseId buckets by number", () => {
  assert.equal(levelOfCourseId("CSE 8A"), "lower");
  assert.equal(levelOfCourseId("CSE 100"), "upper");
  assert.equal(levelOfCourseId("CSE 250A"), "grad");
});
