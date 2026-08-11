// Server-side guards for the upcoming-term route and its refresh scheduler.
//
// Run from mern/server (the route resolves ./scripts/data and ./controllers
// relative to cwd, same as the controller tests):
//   node --test routes/nextQuarter.test.mjs

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import express from "express";

import router from "./nextQuarter.js";
import * as scheduler from "../lib/refreshScheduler.js";

const app = express();
app.use("/next-quarter", router);
const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (p) => {
  const res = await fetch(`${base}${p}`);
  return { status: res.status, body: await res.json() };
};

test.after(() => server.close());

// ---------------------------------------------------------------------------
// FIX 7: the public status endpoint leaked the scraper's stdout/stderr tail —
// on a failure that is a Node stack trace with absolute paths from the deploy
// host. Freshness metadata is public; the server's filesystem layout is not.

test("public refresh-status carries no scraper output", async () => {
  const { status, body } = await get("/next-quarter/refresh-status");
  assert.equal(status, 200);
  assert.equal("output" in (body.lastRun ?? {}), false, "lastRun.output must not be public");
  assert.equal(JSON.stringify(body).includes("/Users/"), false, "no absolute host paths");
  assert.equal(JSON.stringify(body).includes("at Object."), false, "no stack frames");
  // The useful part is still there.
  assert.ok("intervalHours" in body);
  assert.ok("scrapedAt" in body);
  assert.ok("termCode" in body);
});

test("the detail endpoint that does carry output is admin-gated", async () => {
  const { status } = await get("/next-quarter/refresh-status/detail");
  assert.notEqual(status, 200, "must not answer an unauthenticated caller");
});

// ---------------------------------------------------------------------------
// FIX 1: the served snapshot must carry full package membership.

test("served sections expose packageIds, and a shared lecture is in all of them", async () => {
  const { status, body } = await get("/next-quarter");
  if (status === 503) return; // no snapshot on this checkout; nothing to assert
  assert.equal(status, 200);

  const sections = Object.values(body.courses).flat();
  assert.ok(sections.length > 0);
  for (const s of sections) {
    assert.ok(Array.isArray(s.packageIds), `${s.courseId} ${s.sectionId} needs packageIds`);
    // The singular field stays as the first id, for readers mid-migration.
    assert.equal(s.packageId ?? null, s.packageIds[0] ?? null);
  }

  // At least one course must have a section belonging to several packages —
  // that is the whole point, and if it stops being true the scrape regressed.
  assert.ok(
    sections.some((s) => s.packageIds.length > 1),
    "no section belongs to more than one package — packageIds was truncated again"
  );
});

test("no served section still uses the space-separated waitlist spelling", async () => {
  const { status, body } = await get("/next-quarter");
  if (status === 503) return;
  const statuses = new Set(Object.values(body.courses).flat().map((s) => s.status));
  assert.equal(statuses.has("waitlist active"), false);
  for (const s of statuses) {
    if (s) assert.equal(/\s/.test(s), false, `status "${s}" should be hyphenated`);
  }
});

test("multi-meeting sections keep every weekly slot", async () => {
  const { status, body } = await get("/next-quarter");
  if (status === 503) return;
  const sections = Object.values(body.courses).flat();
  const multi = sections.filter((s) => (s.meetings || []).length > 1);
  assert.ok(multi.length > 0, "some UCSD sections really do meet at two different times");
  for (const s of sections) {
    if (!s.meetings?.length) continue;
    // The flat fields describe the first meeting and must agree with it —
    // they used to union the days while keeping only the first clock.
    assert.deepEqual(s.days, s.meetings[0].days);
    assert.equal(s.start, s.meetings[0].start);
  }
});

// ---------------------------------------------------------------------------
// FIX 5: a failing scraper must back off instead of hammering UCSD.

test("backoff doubles from the floor and caps at the configured interval", () => {
  const floor = 30_000;
  const interval = 24 * 3600 * 1000;
  assert.equal(scheduler.backoffMs(1, interval, floor), 30_000);
  assert.equal(scheduler.backoffMs(2, interval, floor), 60_000);
  assert.equal(scheduler.backoffMs(3, interval, floor), 120_000);
  assert.equal(scheduler.backoffMs(10, interval, floor), 30_000 * 512);
  // Never longer than the cadence the admin asked for.
  assert.equal(scheduler.backoffMs(40, interval, floor), interval);
  // A short interval clamps immediately rather than going below the floor.
  assert.equal(scheduler.backoffMs(5, 10_000, floor), floor);
});

test("getStatus reports whether it is backing off", () => {
  const status = scheduler.getStatus();
  assert.equal(typeof status.consecutiveFailures, "number");
  assert.equal(typeof status.backingOff, "boolean");
});
