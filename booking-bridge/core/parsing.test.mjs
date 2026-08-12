/**
 * Tests the extension's parsing.js by evaluating the exact shipped file in a
 * sandbox, so there is no second copy of the logic to drift out of sync.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(here, "..", "extension", "content", "parsing.js"),
  "utf8"
);

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const raw = sandbox.TPBB_parsing;

// Objects built inside the vm carry that realm's prototypes, which makes
// deepStrictEqual fail on identity even when the values match. Round-trip
// results into this realm so assertions compare data, not provenance.
const plain = (value) => JSON.parse(JSON.stringify(value));

const parseDays = (...args) => plain(raw.parseDays(...args));
const parseTimeRange = (...args) => plain(raw.parseTimeRange(...args));
const { normalizeStatus, normalizeCourseId } = raw;

// Mirrors extension/content/selectors.js statusText.
const STATUS_TEXT = {
  open: ["available", "open", "seats available"],
  "waitlist-active": ["waitlist active", "waitlist"],
  "waitlist-inactive": ["waitlist inactive", "waitlist closed"],
  full: ["full", "closed", "no seats"],
  booked: ["booked", "enrolled"],
  "booked-waitlist": ["booked on wait list", "waitlisted"],
  "conditionally-booked": ["conditionally booked"],
};

test("parseDays handles the two-letter tokens correctly", () => {
  assert.deepEqual(parseDays("MWF"), ["M", "W", "F"]);
  // The failure mode that matters: TH must not parse as Tuesday + Thursday.
  assert.deepEqual(parseDays("TuTh"), ["T", "R"]);
  assert.deepEqual(parseDays("TH"), ["R"]);
  assert.deepEqual(parseDays("M,W,F"), ["M", "W", "F"]);
  assert.deepEqual(parseDays("Tu Th"), ["T", "R"]);
  assert.deepEqual(parseDays(""), []);
});

test("parseDays de-duplicates repeated days", () => {
  assert.deepEqual(parseDays("MM W"), ["M", "W"]);
});

test("parseTimeRange handles the formats TSS renders", () => {
  assert.deepEqual(parseTimeRange("10:00a-10:50a"), { start: "10:00a", end: "10:50a" });
  assert.deepEqual(parseTimeRange("2:00p - 3:20p"), { start: "2:00p", end: "3:20p" });
  assert.deepEqual(parseTimeRange("9:00 to 9:50"), { start: "9:00", end: "9:50" });
  assert.deepEqual(parseTimeRange("11:00 a.m. – 11:50 a.m."), { start: "11:00am", end: "11:50am" });
  assert.deepEqual(parseTimeRange("TBA"), { start: null, end: null });
});

test("normalizeStatus prefers the longest matching phrase", () => {
  // These are the ambiguous pairs that a naive substring match gets wrong.
  assert.equal(normalizeStatus("Waitlist Inactive", STATUS_TEXT), "waitlist-inactive");
  assert.equal(normalizeStatus("Waitlist Active", STATUS_TEXT), "waitlist-active");
  assert.equal(normalizeStatus("Booked on Wait List", STATUS_TEXT), "booked-waitlist");
  assert.equal(normalizeStatus("Conditionally Booked", STATUS_TEXT), "conditionally-booked");
  assert.equal(normalizeStatus("Booked", STATUS_TEXT), "booked");
  assert.equal(normalizeStatus("Full", STATUS_TEXT), "full");
  assert.equal(normalizeStatus("", STATUS_TEXT), "unknown");
  assert.equal(normalizeStatus("Something Else", STATUS_TEXT), "unknown");
});

test("normalizeCourseId matches the core module's canonical form", () => {
  assert.equal(normalizeCourseId("CSE-101"), "CSE 101");
  assert.equal(normalizeCourseId("cse 101"), "CSE 101");
  assert.equal(normalizeCourseId("MATH20A"), "MATH 20A");
  assert.equal(normalizeCourseId(""), null);
  // TSS OData zero-pads course numbers; the catalog does not.
  assert.equal(normalizeCourseId("AAS-010R"), "AAS 10R");
  assert.equal(normalizeCourseId("CSE-008A"), "CSE 8A");
  assert.equal(normalizeCourseId("CSE-100"), "CSE 100");
});

test("extension and core agree on course id normalization", async () => {
  const core = await import("./catalog.js");
  for (const raw of [
    "CSE-101", "cse 101", "MATH20A", "  CHEM 6A ", "CSE 8A",
    "AAS-010R", "CSE-008A", "CSE-100",
  ]) {
    assert.equal(
      normalizeCourseId(raw),
      core.normalizeCourseId(raw),
      `mismatch for ${JSON.stringify(raw)}`
    );
  }
});
