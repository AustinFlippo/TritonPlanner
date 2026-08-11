import assert from "node:assert/strict";
import {
  extractCourseMentions,
  splitCourseMentions,
} from "./chatCourseMentions.js";

assert.deepEqual(extractCourseMentions("Try MAE 154 and MGT167."), [
  "MAE 154",
  "MGT 167",
]);

assert.deepEqual(extractCourseMentions("DSC 100 (4u), CSE 158 (?u)"), [
  "DSC 100",
  "CSE 158",
]);

const parts = splitCourseMentions("Take **CSE 100** next.");
assert.equal(parts[0].type, "text");
assert.equal(parts[1].type, "course");
assert.equal(parts[1].value, "CSE 100");
assert.equal(parts[1].raw, "CSE 100");

console.log("chatCourseMentions.test.mjs: ok");
