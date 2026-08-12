// Run from mern/server: node --test controllers/searchController.test.mjs
// (searchController resolves v5.json / prereq_graph.json relative to cwd).
//
// Exercises the one thing that silently breaks for cross-listed courses: an
// audit names a course the way the registrar writes it ("DSC 80"), the catalog
// id is "DSC 80/80R", and comparing the two as plain strings makes a completed
// prerequisite invisible — so a student is told they can't take a course they
// are ready for, and the course they finished keeps being recommended.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { offeringsFor, recommendCourses, searchCourses } from "./searchController.js";
import { aliasesFor, sequenceMembers } from "../scripts/lib/course-ids.mjs";

const graph = JSON.parse(fs.readFileSync("./controllers/prereq_graph.json", "utf-8"));

// The forms an audit line might use for one catalog id: "DSC 80/80R" is
// written "DSC 80" or "DSC 80R", "BENG/BIMM/CSE 181" is written "CSE 181".
const writtenForms = (id) => aliasesFor(id).filter((a) => a !== id);

// Pick a real case from the shipped data rather than hard-coding a course, so
// a catalog re-scrape can't quietly make this test vacuous. Each candidate is
// confirmed end-to-end before use: the token must resolve back to the same
// catalog entry (a token that is itself cross-listed resolves elsewhere, and
// then the prereqs under test belong to some other course), the canonical form
// must report met, and the empty transcript must report unmet — otherwise the
// assertion below would hold no matter what the code did.
function crossListedPrereqCase() {
  for (const [courseId, entry] of Object.entries(graph)) {
    if (courseId.includes("/")) continue; // want a plain id with cross-listed prereqs
    const groups = entry.requires || [];
    if (!groups.length || !groups.every((g) => g.length === 1)) continue;
    const prereqs = groups.map((g) => g[0]);
    if (!prereqs.every((id) => writtenForms(id).length)) continue;

    const [row] = recommendCourses([courseId], prereqs);
    if (row?.course?.course_id !== courseId || row.prereqs_met !== true) continue;
    if (recommendCourses([courseId], [])[0]?.prereqs_met !== false) continue;
    return { courseId, prereqs };
  }
  return null;
}

test("a completed prereq counts when the audit uses the registrar's code", () => {
  const found = crossListedPrereqCase();
  assert.ok(found, "expected a course whose prereqs are all cross-listed");
  const { courseId, prereqs } = found;

  for (const [i, prereq] of prereqs.entries()) {
    for (const alias of writtenForms(prereq)) {
      // Complete this prereq under its alias, the rest under their catalog ids.
      const taken = prereqs.map((id, j) => (j === i ? alias : id));
      const [row] = recommendCourses([courseId], taken);
      assert.equal(
        row?.prereqs_met,
        true,
        `${courseId}: "${alias}" should satisfy the "${prereq}" prerequisite`,
      );
    }
  }
});

test("a completed cross-listed course is excluded from its own recommendation", () => {
  const crossListed = Object.keys(graph).find((id) => writtenForms(id).length);
  assert.ok(crossListed, "expected a cross-listed catalog id");
  const [asWritten] = writtenForms(crossListed);

  assert.equal(recommendCourses([asWritten], [asWritten]).length, 0);
  // ...but an unrelated completed course must not filter it out.
  assert.equal(recommendCourses([asWritten], ["CSE 100"]).length, 1);
});

// ---------------------------------------------------------------------------
// Audit-vouched courses the catalog has never published.
//
// DSC 152 was taught in SP26 and is one of the two alternatives in the Data
// Science major's Core requirement, yet it appears nowhere in the General
// Catalog. Before this, it was invisible: absent from search, and absent from
// the very requirement listing it as an option.
// ---------------------------------------------------------------------------

const UNCATALOGED = "ZZZ 152"; // stands in for DSC 152 without pinning to data

test("an uncataloged course is unfindable unless the audit vouches for it", () => {
  assert.equal(searchCourses(UNCATALOGED).results.length, 0);

  const { results } = searchCourses(UNCATALOGED, {}, [UNCATALOGED]);
  assert.equal(results.length, 1);
  assert.equal(results[0].course_id, UNCATALOGED);
  assert.equal(results[0].unverified, true);
  // Unknown, never a confident zero — the UI renders "? u" off this.
  assert.equal(results[0].credits, null);
});

test("vouching never shadows a real catalog course with an empty stub", () => {
  const { results } = searchCourses("CSE 100", {}, ["CSE 100"]);
  const hit = results.find((c) => c.course_id === "CSE 100");
  assert.ok(hit, "expected the real CSE 100");
  assert.ok(!hit.unverified);
  assert.ok(hit.course_name, "real catalog data must win over a stub");
  assert.equal(results.filter((c) => c.course_id === "CSE 100").length, 1);
});

test("a vouched course surfaces by code but not by stray text", () => {
  // It has no name or description, so it can only ever land in the id tiers.
  assert.equal(searchCourses("ZZZ", {}, [UNCATALOGED]).results.length, 1);
  assert.equal(searchCourses("machine learning", {}, [UNCATALOGED]).results.length > 0, true);
  assert.ok(
    !searchCourses("machine learning", {}, [UNCATALOGED]).results.some(
      (c) => c.course_id === UNCATALOGED,
    ),
  );
});

test("audit credit placeholders are never vouched into search", () => {
  // An empty query is browse mode (the route guards that, not this function),
  // so assert on what must never appear rather than on the result count.
  for (const junk of ["AP **3", "IB MU5", "", "   ", "TO", "100TO199"]) {
    const { results } = searchCourses(junk, {}, [junk]);
    assert.ok(
      !results.some((c) => c.unverified),
      `${JSON.stringify(junk)} must not become a course`,
    );
  }
});

test("level and department filters still apply to a vouched course", () => {
  const upper = { levels: ["upper"] };
  assert.equal(searchCourses(UNCATALOGED, upper, [UNCATALOGED]).results.length, 1);
  assert.equal(
    searchCourses(UNCATALOGED, { levels: ["lower"] }, [UNCATALOGED]).results.length,
    0,
  );
  assert.equal(
    searchCourses(UNCATALOGED, { depts: ["CSE"] }, [UNCATALOGED]).results.length,
    0,
  );
  // Offered quarters are unknown, so a quarter filter must not claim it runs.
  assert.equal(
    searchCourses(UNCATALOGED, { quarters: ["FA"] }, [UNCATALOGED]).results.length,
    0,
  );
});

test("a requirement lists its uncataloged option instead of dropping it", () => {
  // Every token reaching recommendCourses came from the audit, so no separate
  // vouching is needed here — that IS the vouch.
  const rows = recommendCourses([UNCATALOGED, "CSE 100"]);
  const stub = rows.find((r) => r.course.course_id === UNCATALOGED);
  assert.ok(stub, "the audit's own option must appear in its options list");
  assert.equal(stub.course.unverified, true);
  assert.equal(stub.course.credits, null);
  assert.equal(stub.prereqs_met, null); // unknown, so no "Ready" badge
  assert.ok(rows.some((r) => r.course.course_id === "CSE 100"));
});

test("a completed uncataloged course stops being recommended", () => {
  assert.equal(recommendCourses([UNCATALOGED], [UNCATALOGED]).length, 0);
});

test("junk audit tokens do not become recommendations", () => {
  assert.equal(recommendCourses(["AP **3", "IB MU5"]).length, 0);
});

// ---------------------------------------------------------------------------
// The audit's spelling must find the catalog's spelling. The catalog publishes
// multi-quarter sequences as one dash-joined entry and often lists only the
// base of a section variant, while audits and students name neither that way.
// ---------------------------------------------------------------------------

const seqEntry = JSON.parse(fs.readFileSync("./controllers/v5.json", "utf-8")).find(
  (c) => /^[A-Z ]+ \d+[A-Z](-[A-Z])+$/.test(c.course_id) && /^\d+(-\d+)+$/.test(String(c.credits)),
);

test("every quarter of a sequence is searchable on its own", () => {
  assert.ok(seqEntry, "expected a dash-joined sequence entry in the catalog");
  const members = sequenceMembers(seqEntry.course_id);
  const perQuarter = String(seqEntry.credits).split("-");
  assert.equal(members.length, perQuarter.length);

  members.forEach((member, i) => {
    const hit = searchCourses(member).results[0];
    assert.ok(hit, `${member} must be findable`);
    // Narrowed to the quarter asked for, not the whole sequence...
    assert.equal(hit.course_id, member);
    // ...carrying that quarter's units, not the dash-joined string. Reading
    // "4-4-4" whole would make one quarter worth 12 units; Number() on it in
    // the client would make it worth 0.
    assert.equal(String(hit.credits), perQuarter[i]);
  });

  // The sequence itself still resolves to itself, unnarrowed.
  const whole = searchCourses(seqEntry.course_id).results[0];
  assert.equal(whole.course_id, seqEntry.course_id);
  assert.equal(String(whole.credits), String(seqEntry.credits));
});

test("a section variant finds its base catalog course", () => {
  // "MUS 20R" is the remote section of "MUS 20"; the catalog lists only "MUS 20".
  for (const [written, expected] of [["MUS 20R", "MUS 20"], ["MUS 8GS", "MUS 8"]]) {
    const hit = searchCourses(written).results[0];
    assert.ok(hit, `${written} must be findable`);
    assert.equal(hit.course_id, expected);
    assert.ok(!hit.unverified, `${written} resolves, so it must not be stubbed`);
  }
});

test("a resolvable variant is never stubbed as unverified", () => {
  // The bug this guards: vouching stubbed "MUS 20R" as uncataloged because the
  // alias index only expanded catalog ids, never the query.
  for (const written of ["MUS 20R", "MUS 8GS", "HILD 2A", "DSC 80R"]) {
    const { results } = searchCourses(written, {}, [written]);
    assert.ok(
      !results.some((c) => c.unverified),
      `${written} resolves in the catalog and must not be vouched into a stub`,
    );
  }
});

test("offeringsFor knows about exactly the courses search can find", () => {
  // These two answered known:false while searchCourses resolved them fine,
  // because offeringsFor looked the raw code up in an index built from CATALOG
  // ids instead of resolving the query the same way. A student who dragged
  // "MUS 20R" onto the grid was told it wasn't in the catalog.
  const codes = ["MUS 20R", "MUS 8GS", "HILD 2A", "DSC 80R", "ANSC 185"];
  const offerings = offeringsFor(codes);
  for (const code of codes) {
    assert.ok(
      searchCourses(code).results.length > 0,
      `${code} must be findable by search`,
    );
    assert.equal(offerings[code].known, true, `${code} must be known to offeringsFor`);
  }
  // ...and a code that really isn't in the catalog still reads as unknown.
  assert.equal(offeringsFor([UNCATALOGED])[UNCATALOGED].known, false);
});

// ---------------------------------------------------------------------------
// The alias index, built in two passes so a canonical id always keeps its own
// key. One pass in catalog order let an alphabetically earlier cross-listed
// row answer for a standalone course — 50 codes resolved to the wrong entry.
// ---------------------------------------------------------------------------

test("a standalone course is never answered by a cross-listed neighbour", () => {
  // Each of these has BOTH a standalone catalog row and an earlier-sorting row
  // that mentions it. The standalone row is the right answer: SIOG 255 is 6
  // units where "SIO 104/SIOG 255" is 4, and HILD 7B runs WI/SP where the
  // "HILD 7A-B-C" sequence row carries no offerings at all.
  for (const [code, credits] of [["SIOG 255", "6"], ["HILD 7B", "4"]]) {
    const hit = searchCourses(code).results[0];
    assert.equal(hit?.course_id, code);
    assert.equal(String(hit.credits), credits);
  }
  // The same entry must answer the offerings lookup, or the planner grid marks
  // a course that runs two quarters a year as never offered.
  assert.deepEqual(offeringsFor(["HILD 7B"])["HILD 7B"].offerings, ["WI", "SP"]);
});

test("one course_id can never appear twice in one result list", () => {
  // "HILD 7A-B-C" narrowed to its second quarter and the standalone "HILD 7B"
  // row are both called "HILD 7B", which put two cards in the sidebar and two
  // React children under one key.
  for (const query of ["HILD 7B", "VIS 128E", "SIOG 255", "CSE 100", "MUS 20"]) {
    const ids = searchCourses(query).results.map((c) => c.course_id);
    assert.equal(new Set(ids).size, ids.length, `${query} returned a duplicate id`);
  }
});

test("browsing a department shows its introductory courses first", () => {
  // Sorting ids as text puts "CSE 100" before "CSE 8A", so the first fifty CSE
  // courses ran out at "CSE 15L" and hid 8A/8B/20/21/30 entirely.
  const ids = searchCourses("", { depts: ["CSE"] }).results.map((c) => c.course_id);
  assert.ok(ids.length > 0);
  const numberOf = (id) => parseInt(id.match(/(\d+)/)[1], 10);
  for (let i = 1; i < ids.length; i++) {
    assert.ok(
      numberOf(ids[i - 1]) <= numberOf(ids[i]),
      `${ids[i - 1]} sorted before ${ids[i]}`,
    );
  }
  for (const intro of ["CSE 8A", "CSE 20", "CSE 30"]) {
    assert.ok(ids.includes(intro), `browsing CSE must show ${intro}`);
  }
});

// ---------------------------------------------------------------------------
// One course can satisfy several requirements, and the client sends every
// requirement's codes in a single request and regroups the rows by token.
// ---------------------------------------------------------------------------

test("a course claimed by one token still appears under the others", () => {
  const rows = recommendCourses(["CSE 100TO199", "CSE 101"]);
  const tagged = rows.filter((r) => r.token === "CSE 101");
  assert.equal(tagged.length, 1, "CSE 101 must be listed under its own token");
  assert.equal(tagged[0].course.course_id, "CSE 101");
  // ...and the answer must not depend on the order the tokens arrived in.
  const reversed = recommendCourses(["CSE 101", "CSE 100TO199"]);
  assert.equal(reversed.length, rows.length);
  assert.equal(reversed.filter((r) => r.token === "CSE 101").length, 1);
});

test("a token still lists each course only once", () => {
  const rows = recommendCourses(["CSE 100TO199"]);
  const ids = rows.map((r) => r.course.course_id);
  assert.equal(new Set(ids).size, ids.length);
});

test("the vouching budget is spent on stubs, not on codes examined", () => {
  // codesNamedByAudit harvests every code an audit names and most of them
  // resolve; capping the INPUT meant the handful of genuinely uncataloged ones
  // could sit past the cut and be dropped — the DSC 152 case this exists for.
  const cataloged = searchCourses("", { depts: ["CSE"] }).results.map((c) => c.course_id);
  assert.ok(cataloged.length >= 40, "expected plenty of real codes to pad with");
  const padding = Array.from({ length: 600 }, (_, i) => cataloged[i % cataloged.length]);
  const { results } = searchCourses(UNCATALOGED, {}, [...padding, UNCATALOGED]);
  assert.equal(results.length, 1);
  assert.equal(results[0].course_id, UNCATALOGED);
});

test("a trailing letter that is part of the number is left alone", () => {
  for (const id of ["MATH 20B", "DSC 140A", "CSE 100"]) {
    assert.equal(searchCourses(id).results[0]?.course_id, id);
  }
});
