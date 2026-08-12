/**
 * Tests the SoC -> RateMyProfessors name join.
 *
 * The fixtures below are real shapes taken from professors-rmp.json, chosen
 * because each one broke a simpler matcher: the Porter trio (an exact-spelled
 * stub competing with a rated short form), two Miles Jones pages, a Weng who
 * is a different person from the Weng in the Schedule of Classes, and the
 * three colleagues whose ratings were shipped on courses they have never
 * taught (Hyunmi Cho on MATH 213, Xiaolong Bruce Li on PSY 405, Deanna
 * Erdmann on VIS 165).
 *
 * Run: node --test scripts/lib/professor-names.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  departmentsForCourse,
  indexProfessors,
  matchDisplayName,
  matchInstructor,
  matchProfessor,
  splitSocName,
  toV5Professor,
  toV5Unrated,
} from "./professor-names.mjs";

const prof = (legacy_id, first_name, last_name, department, num_ratings, quality_rating, difficulty, would_take_again) => ({
  legacy_id, first_name, last_name, department, num_ratings, quality_rating, difficulty, would_take_again,
});

const FIXTURES = [
  prof(1992362, "Leo", "Porter", "Computer Science", 45, 3.4, 3.5, 53.3),
  prof(2934669, "Leonard", "Porter", "Computer Science", 0, null, null, null),
  prof(2324708, "George", "Porter", "Computer Science", 9, 4.6, 2.1, 88),
  prof(2110462, "Miles", "Jones", "Computer Science", 30, 3.7, 3.1, 65),
  prof(1513786, "Miles", "Jones", "Mathematics", 60, 3.7, 3.2, 67),
  prof(3110381, "Lily", "Weng", "Data Science", 3, 2.7, 3.0, 33),
  prof(1739027, "Steve", "Levkoff", "Economics", 368, 4.1, 3.3, 68),
  prof(2987363, "Ivonne", "Gonzalez Gamboa", "Computer Science", 26, 4.6, 2.0, 96),
  prof(563826, "Russell", "Impagliazzo", "Computer Science", 41, 1.7, 4.2, 6),
  // Multi-word surname AND multi-word given name — the case that makes the
  // "First Last" split ambiguous.
  prof(2554105, "Adalbert Gerald", "Soosai Raj", "Computer Science", 75, 3.5, 3.3, 60),
  // The wrong-professor trio. Each one's given name is a character prefix of
  // the SoC/Class Planner name it was wrongly matched to, in the direction
  // that cannot be told apart from a real short form.
  prof(2438196, "Hyunmi", "Cho", "Theater", 6, 1.7, 3.6, 16),
  prof(1234567, "Xiaolong Bruce", "Li", "Mathematics", 14, 3.2, 3.0, 55),
  prof(2765432, "Deanna", "Erdmann", "Visual Arts", 7, 4.0, 2.5, 80),
  // Same person, spelled with and without the internal space.
  prof(2111111, "Wanlu", "Li", "Engineering", 0, null, null, null),
];

const index = indexProfessors(FIXTURES);
const match = (name) => matchProfessor(name, index);

test("splits 'Last, First M' including multi-word surnames", () => {
  // Bare initials go; every other given-name token stays. Keeping only the
  // first token turned "Hyun Keun" into "Hyun", which the prefix rule then
  // read as a short form of a Theater lecturer named Hyunmi.
  assert.deepEqual(splitSocName("Jones, Miles E"), { last: "jones", given: "miles" });
  assert.deepEqual(splitSocName("Gonzalez Gamboa, Ivonne"), {
    last: "gonzalez gamboa",
    given: "ivonne",
  });
  assert.deepEqual(splitSocName("Levkoff, Steven B."), { last: "levkoff", given: "steven" });
  assert.deepEqual(splitSocName("Cho, Hyun Keun"), { last: "cho", given: "hyun keun" });
});

test("a rated short form beats an exact-spelled stub", () => {
  // The whole point of the join is the ratings, so "Leonard Porter" with zero
  // of them must lose to "Leo Porter" with 45 despite spelling SoC exactly.
  assert.equal(match("Porter, Leonard Emerson").legacy_id, 1992362);
});

test("does not confuse same-surname colleagues", () => {
  assert.equal(match("Porter, George").legacy_id, 2324708);
});

test("never falls back to surname alone", () => {
  // Olivia Weng has no RMP page; Lily Weng is someone else entirely.
  assert.equal(match("Weng, Olivia"), null);
  assert.equal(match("Impagliazzo, Russell").legacy_id, 563826);
});

test("a same-surname colleague is not claimed by a prefix of their name", () => {
  // All three shipped in v5.json: Hyunmi Cho (Theater, 1.7 stars) was listed
  // as the instructor of MATH 213 and PHB 248, Xiaolong Bruce Li on PSY 405,
  // Deanna Erdmann on VIS 165/165A/183B. A course with no professor is far
  // better than a course with a stranger's ratings.
  assert.equal(match("Cho, Hyun Keun"), null);
  assert.equal(matchDisplayName("Xia Li", index), null);
  assert.equal(match("Erdmann, Dean"), null);
  // ...and the reverse spellings must not resolve either.
  assert.equal(matchDisplayName("Hyun Keun Cho", index), null);
  assert.equal(matchInstructor("Dean Erdmann", index), null);
});

test("the same name with the space moved still matches", () => {
  // "Li, Wan-Lu" and RMP's "Wanlu Li" are one person; every character lines
  // up, which is what separates this from "Hyun Keun" reaching "Hyunmi".
  assert.equal(match("Li, Wan-Lu").legacy_id, 2111111);
  assert.equal(matchDisplayName("Wan-Lu Li", index).legacy_id, 2111111);
});

test("a name clipped by the SoC column still finds its page", () => {
  // The real row is "Soosai Raj, Adalbert Geral" — his only historic spelling,
  // across six CSE courses. Earlier tokens must match exactly, so a clipped
  // tail can never reach a different compound given name.
  assert.equal(match("Soosai Raj, Adalbert Geral").legacy_id, 2554105);
  assert.equal(match("Soosai Raj, Ada"), null); // one token, no anchor
});

test("middle names present in one source and absent in the other", () => {
  // Token by token, never character by character.
  assert.equal(match("Porter, George Michael").legacy_id, 2324708);
  assert.equal(matchDisplayName("Ivonne Gonzalez Gamboa", index).legacy_id, 2987363);
});

test("resolves nicknames that are not prefixes", () => {
  assert.equal(match("Levkoff, Steven B.").legacy_id, 1739027);
});

test("breaks duplicate-page ties by rating count", () => {
  assert.equal(match("Jones, Miles E").legacy_id, 1513786);
});

test("the course's own subject breaks a duplicate-page tie first", () => {
  // Two Miles Jones pages, one Computer Science and one Mathematics. Rating
  // count alone always hands back the Math one; the course being CSE 20 says
  // which of them is actually in the room. Advisory only — a department that
  // matches nothing never rejects a candidate.
  assert.equal(
    matchProfessor("Jones, Miles E", index, departmentsForCourse("CSE 20")).legacy_id,
    2110462,
  );
  assert.equal(
    matchProfessor("Jones, Miles E", index, departmentsForCourse("MATH 154")).legacy_id,
    1513786,
  );
  // A subject with no mapping (or a course that isn't one) falls straight
  // through to the rating-count tiebreak.
  assert.equal(
    matchProfessor("Jones, Miles E", index, departmentsForCourse("ZZZ 1")).legacy_id,
    1513786,
  );
  assert.deepEqual(departmentsForCourse(""), []);
  assert.ok(departmentsForCourse("SIO 104/SIOG 255").includes("Oceanography"));
});

test("ignores non-people and unparseable names", () => {
  assert.equal(match("Staff"), null);
  assert.equal(match(""), null);
  // A bare initial must not claim every M-name in the department.
  assert.equal(match("Jones, M"), null);
});

test("emits the v5 string schema the UI renders verbatim", () => {
  assert.deepEqual(toV5Professor(FIXTURES[0]), {
    name: "Leo Porter",
    quality_rating: "3.4",
    num_ratings: "45 ratings",
    would_take_again: "53%",
    difficulty: "3.5",
    profile_link: "https://www.ratemyprofessors.com/professor/1992362",
    department: "Computer Science",
  });
});

test("matches Class Planner display names, splitting on the surname index", () => {
  // "Adalbert Gerald Soosai Raj" must split as Adalbert Gerald / Soosai Raj,
  // not Adalbert / Gerald Soosai Raj — only the RMP index knows where.
  assert.equal(matchDisplayName("Adalbert Gerald Soosai Raj", index).legacy_id, 2554105);
  assert.equal(matchDisplayName("Leo Porter", index).legacy_id, 1992362);
  assert.equal(matchDisplayName("Steven Levkoff", index).legacy_id, 1739027);
  assert.equal(matchDisplayName("Olivia Weng", index), null);
  assert.equal(matchDisplayName("Cher", index), null);
});

test("dispatches on the format each source writes", () => {
  // Same person, both spellings, same page.
  assert.equal(matchInstructor("Porter, Leonard Emerson", index).legacy_id, 1992362);
  assert.equal(matchInstructor("Leo Porter", index).legacy_id, 1992362);
});

test("lists an unrated instructor by name with no RMP link", () => {
  // Someone teaching next quarter with no page still belongs on the course.
  assert.deepEqual(toV5Unrated("Libby Butler"), {
    name: "Libby Butler",
    quality_rating: "N/A",
    num_ratings: "No ratings",
    would_take_again: "N/A",
    difficulty: "N/A",
    profile_link: null,
    department: "",
  });
});

test("renders missing values as N/A rather than null", () => {
  const stub = toV5Professor(FIXTURES[1]);
  assert.equal(stub.quality_rating, "N/A");
  assert.equal(stub.would_take_again, "N/A");
  assert.equal(stub.difficulty, "N/A");
  assert.equal(stub.num_ratings, "0 ratings");
});
