import assert from "node:assert/strict";
import test from "node:test";

import { parseCredits, hasUnknownCredits } from "./courseCredits.js";
import { courseIdVariants } from "./courseIds.js";

test("dash-joined sequence credits read as one quarter, not NaN", () => {
  // Number("4-4-4") is NaN, and every call site spelled that `|| 0`, so a
  // sequence course entered the planner worth zero units.
  assert.equal(parseCredits("4-4-4"), 4);
  assert.equal(parseCredits("2-2-2"), 2);
  assert.equal(parseCredits("4"), 4);
  assert.equal(parseCredits(4), 4);
  assert.equal(parseCredits("4.0"), 4);
});

test("credits with no number at all fall back rather than becoming NaN", () => {
  assert.equal(parseCredits(null), 0);
  assert.equal(parseCredits(undefined), 0);
  assert.equal(parseCredits(""), 0);
  assert.equal(parseCredits("varies"), 0);
  assert.ok(Number.isNaN(parseCredits(null, NaN)));
});

test("unknown credits are distinguishable from a real zero", () => {
  assert.equal(hasUnknownCredits({ credits: null }), true);
  assert.equal(hasUnknownCredits({ credits: "" }), true);
  assert.equal(hasUnknownCredits({ credits: "varies" }), true);
  assert.equal(hasUnknownCredits({ credits: 0 }), false);
  assert.equal(hasUnknownCredits({ credits: "4-4-4" }), false);
  assert.equal(hasUnknownCredits({ credits: 4 }), false);
});

test("a sequence entry answers to each of its quarters", () => {
  const variants = courseIdVariants("HILD 2A-B-C");
  for (const member of ["HILD 2A", "HILD 2B", "HILD 2C"]) {
    assert.ok(variants.has(member), `expected ${member}`);
  }
  assert.ok(variants.has("HILD 2A-B-C"));
});

test("sequence expansion handles long runs and leaves ordinary ids alone", () => {
  const long = courseIdVariants("MUS 201A-B-C-D-E-F");
  assert.equal(long.has("MUS 201F"), true);
  assert.equal(long.size, 7); // the sequence itself plus six quarters
  // A trailing letter that is part of the number is not a sequence.
  assert.deepEqual([...courseIdVariants("DSC 140A")], ["DSC 140A"]);
  assert.deepEqual([...courseIdVariants("MATH 20B")], ["MATH 20B"]);
});
