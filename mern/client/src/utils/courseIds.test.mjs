// Conformance suite for the client port of alias expansion.
// Cases live in shared/course-alias-cases.json and are ALSO run against the
// reference (mern/server/scripts/lib/course-ids.test.mjs) and the Python port
// (app/tests/test_course_alias_contract.py). If any port drifts, its suite
// goes red.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { aliasesFor } from "./courseIds.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const casesPath = path.join(here, "../../../../shared/course-alias-cases.json");
const { cases } = JSON.parse(fs.readFileSync(casesPath, "utf-8"));

test("shared alias fixture is present and non-trivial", () => {
  assert.ok(cases.length >= 10, `expected 10+ shared cases, got ${cases.length}`);
});

for (const c of cases) {
  test(`[shared] ${c.name}`, () => {
    assert.deepEqual(aliasesFor(c.input), c.aliases);
  });
}
