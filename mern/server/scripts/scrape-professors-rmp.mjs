// Scrapes every RateMyProfessors entry for UCSD.
//
// This replaces the carry-over in build-catalog.mjs: the `professors` field in
// v5.json used to be copied verbatim from the previous v5 forever, because the
// original RMP data arrived with no scraper. Ratings drift every quarter, so
// the copy went stale with no way to refresh it. This is that way.
//
// Source: RMP's own GraphQL endpoint, the one their web app calls. The
// Authorization header below is a public constant shipped in RMP's client
// bundle (it decodes to "test:test") — it is not a credential of ours and
// carries no account. We read the same data any visitor sees, one school,
// ~4,000 professors, at 100 per request behind a delay.
//
// Relay pagination: the cursor is base64 "arrayconnection:<offset>", and the
// endpoint honours offsets well past the 1,000-result cap that limits RMP's
// own search UI, so a straight walk reaches every professor.
//
// Usage:  node scripts/scrape-professors-rmp.mjs
// Output: scripts/data/professors-rmp.json
//
// Pairs with scrape-instructors.mjs, which supplies the course -> instructor
// mapping; build-catalog.mjs joins the two on name.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "data");
const outPath = path.join(outDir, "professors-rmp.json");

const ENDPOINT = "https://www.ratemyprofessors.com/graphql";
// "University of California San Diego", legacyId 1079.
const SCHOOL_ID = "U2Nob29sLTEwNzk=";
const AUTH = "Basic dGVzdDp0ZXN0";
const PAGE_SIZE = 100;
const DELAY_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const QUERY = `query($id: ID!, $first: Int!, $after: String!) {
  newSearch {
    teachers(query: { text: "", schoolID: $id }, first: $first, after: $after) {
      resultCount
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          legacyId
          firstName
          lastName
          department
          avgRating
          numRatings
          avgDifficulty
          wouldTakeAgainPercent
        }
      }
    }
  }
}`;

async function post(after) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: AUTH,
          // RMP 403s a default fetch UA.
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        },
        body: JSON.stringify({
          query: QUERY,
          variables: { id: SCHOOL_ID, first: PAGE_SIZE, after },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 200));
      return json.data.newSearch.teachers;
    } catch (e) {
      if (attempt >= 4) throw new Error(`${e.message} (after="${after}")`);
      await sleep(1500 * attempt);
    }
  }
}

// wouldTakeAgainPercent is -1 when nobody answered the question; numRatings 0
// means the professor has a page but no ratings. Both stay out of the output
// as nulls rather than being written as real-looking zeroes.
function clean(node) {
  return {
    legacy_id: node.legacyId,
    first_name: (node.firstName || "").trim(),
    last_name: (node.lastName || "").trim(),
    department: (node.department || "").trim(),
    quality_rating: node.numRatings > 0 ? node.avgRating : null,
    num_ratings: node.numRatings ?? 0,
    difficulty: node.numRatings > 0 ? node.avgDifficulty : null,
    would_take_again:
      typeof node.wouldTakeAgainPercent === "number" && node.wouldTakeAgainPercent >= 0
        ? node.wouldTakeAgainPercent
        : null,
  };
}

async function main() {
  const byId = new Map();
  let after = "";
  let expected = null;

  for (let page = 1; ; page++) {
    const batch = await post(after);
    if (expected === null) {
      expected = batch.resultCount;
      console.log(`${expected} UCSD professors listed on RateMyProfessors`);
    }
    for (const edge of batch.edges) {
      const p = clean(edge.node);
      if (p.legacy_id != null) byId.set(p.legacy_id, p);
    }
    console.log(`  page ${page}: +${batch.edges.length} (${byId.size} unique so far)`);
    if (!batch.pageInfo.hasNextPage || batch.edges.length === 0) break;
    after = batch.pageInfo.endCursor;
    await sleep(DELAY_MS);
  }

  const professors = [...byId.values()].sort((a, b) =>
    `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`),
  );
  const rated = professors.filter((p) => p.num_ratings > 0).length;

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify({ school: "University of California San Diego", school_id: SCHOOL_ID, professors }, null, 1),
  );

  console.log(`\nWrote ${professors.length} professors to ${outPath}`);
  console.log(`  ${rated} have at least one rating, ${professors.length - rated} have an empty page`);
  if (expected && Math.abs(professors.length - expected) > expected * 0.02) {
    console.warn(`  WARNING: expected ~${expected} but got ${professors.length} — pagination may be truncating`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
