// Regenerates mern/client/src/utils/crossListingAliases.js — the reverse index
// (normalized alias -> canonical course_id) that lets the browser resolve
// "DSC 80R" to the "DSC 80/80R" catalog row without shipping all of v5.json.
//
// The client half of requirement matching has no catalog, so without this file
// the sidebar would call a requirement unmet that the planner agent (which
// does load v5.json) calls met. Run this after build-catalog.mjs whenever
// cross-listings change:
//   node scripts/build-catalog.mjs
//   node scripts/build-cross-listing-aliases.mjs
//   node scripts/build-prereq-graph.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalize, aliasesFor } from "./lib/course-ids.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const v5Path = path.join(here, "..", "controllers", "v5.json");
const outPath = path.join(
  here, "..", "..", "client", "src", "utils", "crossListingAliases.js",
);

const catalog = JSON.parse(fs.readFileSync(v5Path, "utf-8"));

// Only slashed rows carry aliases; a plain "CSE 100" needs no entry.
//
// TWO passes, matching load_catalog() in app/catalog.py and the alias index in
// controllers/searchController.js, so the same token resolves to the same row
// everywhere. Pass one reserves every canonical id — including the plain rows
// that get no alias entry of their own — so pass two can only fill slots no
// real course claimed. Iterating slashed rows alone would have mapped "ECON 5"
// (a standalone course) to "POLI 5R/POLI 5DR/ECON 5R" the moment that
// cross-listing appeared.
const claimed = new Map(); // normalized canonical id -> course_id
for (const course of catalog) {
  const id = course.course_id || "";
  const key = course.normalized_course_id || normalize(id);
  if (key && !claimed.has(key)) claimed.set(key, id);
}

const aliases = {};
let rows = 0;
let shadowed = 0;
for (const course of catalog) {
  const id = course.course_id || "";
  if (!id.includes("/")) continue;
  rows++;
  for (const alias of aliasesFor(id)) {
    const key = normalize(alias);
    if (!key || key in aliases) continue;
    const owner = claimed.get(key);
    if (owner !== undefined && owner !== id) {
      shadowed++;
      continue; // a different catalog row already answers to this code
    }
    aliases[key] = id;
  }
}

const banner = `// Auto-generated alias -> canonical course_id map for cross-listed catalog
// rows. Built from mern/server/controllers/v5.json by
// mern/server/scripts/build-cross-listing-aliases.mjs — do not hand-edit;
// re-run that script after build-catalog.mjs instead.
`;
fs.writeFileSync(outPath, `${banner}export default ${JSON.stringify(aliases)};\n`);
console.log(
  `Wrote ${Object.keys(aliases).length} aliases from ${rows} cross-listed rows to ${outPath}`,
);
console.log(
  `  ${shadowed} alias slots left alone because a standalone catalog row owns that code`,
);
