import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalRangeToken,
  courseFitsRange,
  courseRangeToken,
  formatCourseToken,
  isRangeSeparator,
  parseCourseRange,
} from "./courseRanges.js";
import { readCourseGroups } from "./readCourseGroups.js";

test("parseCourseRange accepts the forms a degree audit actually prints", () => {
  for (const token of [
    "ECON 100TO199",
    "ECON 100 TO 199",
    "ECON 100 TO ECON 199",
    "Econ 100 to Econ 199",
    "ECON 100-199",
    "ECON 100–199",
  ]) {
    assert.deepEqual(parseCourseRange(token), { dept: "ECON", lo: 100, hi: 199 }, token);
  }
});

test("parseCourseRange rejects non-ranges and cross-department spans", () => {
  assert.equal(parseCourseRange("ECON 100"), null);
  assert.equal(parseCourseRange("GO TOHTTP"), null);
  assert.equal(parseCourseRange("ECON 100 TO POLI 199"), null);
  assert.equal(parseCourseRange("100TO199"), null);
});

test("courseRangeToken collapses same-department endpoints", () => {
  assert.equal(courseRangeToken("ECON 100", "ECON 199"), "ECON 100TO199");
  assert.equal(courseRangeToken("Econ 199", "ECON 100"), "ECON 100TO199");
  assert.equal(courseRangeToken("ECON 100", "POLI 199"), null);
  assert.equal(courseRangeToken("ECON 100", "ECON 100"), null);
});

test("canonicalRangeToken rewrites a hyphenated single span", () => {
  assert.equal(canonicalRangeToken("ECON 100-199"), "ECON 100TO199");
  assert.equal(canonicalRangeToken("ECON 100"), "ECON 100");
});

test("formatCourseToken is what the sidebar shows", () => {
  assert.equal(formatCourseToken("ECON 100TO199"), "ECON 100–199");
  assert.equal(formatCourseToken("DSC 100"), "DSC 100");
});

test("isRangeSeparator is only the word to or a dash", () => {
  assert.equal(isRangeSeparator(" to "), true);
  assert.equal(isRangeSeparator("-"), true);
  assert.equal(isRangeSeparator(" OR "), false);
  assert.equal(isRangeSeparator(", "), false);
});

test("courseFitsRange uses the leading department and first number", () => {
  const range = { dept: "ECON", lo: 100, hi: 199 };
  assert.equal(courseFitsRange("ECON 120", range), true);
  assert.equal(courseFitsRange("ECON 100", range), true);
  assert.equal(courseFitsRange("ECON 199", range), true);
  assert.equal(courseFitsRange("ECON 99", range), false);
  assert.equal(courseFitsRange("POLI 120", range), false);
});

// Minimal DOM so readCourseGroups can run under node --test.
const TEXT = 3;
const ELEM = 1;
const text = (value) => ({ nodeType: TEXT, nodeValue: value });
const el = (className, children = [], attrs = {}) => ({
  nodeType: ELEM,
  classList: { contains: (c) => className.split(/\s+/).includes(c) },
  childNodes: children,
  getAttribute: (k) => attrs[k] ?? null,
  querySelector: () => null,
  textContent: children.map((c) => c.nodeValue || c.textContent || "").join(""),
});
const course = (dept, number) =>
  el("course", [el("number", [text(number)])], { department: dept, number });

test("readCourseGroups collapses 'ECON 100 to ECON 199' into one range token", () => {
  const groups = readCourseGroups(
    el("selectcourses", [
      course("ECON ", "100"),
      text(" to "),
      course("ECON ", "199"),
    ])
  );
  assert.deepEqual(groups, [["ECON 100TO199"]]);
});

test("readCourseGroups still treats OR as alternatives for one slot", () => {
  const groups = readCourseGroups(
    el("selectcourses", [
      course("MATH ", "189"),
      text(" OR "),
      course("DSC ", "152"),
      text(", "),
      course("DSC ", "100"),
    ])
  );
  assert.deepEqual(groups, [["MATH 189", "DSC 152"], ["DSC 100"]]);
});

test("readCourseGroups does not join different departments with 'to'", () => {
  const groups = readCourseGroups(
    el("selectcourses", [
      course("ECON ", "100"),
      text(" to "),
      course("POLI ", "199"),
    ])
  );
  assert.deepEqual(groups, [["ECON 100"], ["POLI 199"]]);
});

test("readCourseGroups canonicalizes a hyphenated number attribute", () => {
  const groups = readCourseGroups(
    el("selectcourses", [course("ECON ", "100-199")])
  );
  assert.deepEqual(groups, [["ECON 100TO199"]]);
});
