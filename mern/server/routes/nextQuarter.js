// The upcoming term's schedule, served to anyone — no TSS session, no
// extension, no admin publish step.
//
// Before this route, next-quarter section data reached the client only two
// ways, both requiring a signed-in TSS session: an admin captured it through
// the browser extension and published it to Supabase, or each student ran the
// extension against their own session. That made the schedule unavailable to
// signed-out visitors, stale whenever nobody ran a capture, and — the real
// cost — invisible to the server, so the planner agent reasoned about "next
// quarter" using only historical offering patterns.
//
// scripts/scrape-upcoming-term.mjs pulls the same data from UCSD's public
// Class Planner API, so it can simply be read off disk here. The response
// mirrors the published-Supabase shape (see client/src/utils/termSections.js)
// because the client already knows how to render that.
//
// Seat counts in the snapshot are stale by construction — they move
// continuously upstream while the file sits still (measured: 22% of sections
// drifted within a day). `GET /` therefore serves structure (sections, times,
// instructors) plus indicative seats, and `GET /seats?courses=...` re-reads the
// seat numbers live from Class Planner for the handful of courses actually on
// a student's plan. During an enrollment window, the student's own TSS session
// through booking-bridge remains the authority.

import express from "express";
import fs from "fs";
import path from "path";
import { requireAdmin } from "../lib/adminAuth.js";
import * as refreshScheduler from "../lib/refreshScheduler.js";

const router = express.Router();

const upcomingPath = path.resolve("./scripts/data/upcoming-term.json");
const courseDataPath = path.resolve("./controllers/v5.json");

// Class Planner carries no unit count, so credits come from the catalog. Keyed
// by normalized id to survive the "CSE 100" / "DSC 80/80R" spelling gap.
const creditsById = new Map();
try {
  const catalog = JSON.parse(fs.readFileSync(courseDataPath, "utf-8"));
  for (const c of catalog) {
    const units = Number(c.credits);
    if (Number.isFinite(units)) creditsById.set(c.normalized_course_id, units);
  }
} catch {
  // Credits are a nicety here; the schedule is still worth serving without them.
}

const normalize = (id) => String(id || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

// The seat vocabulary the client keys on is hyphenated ("waitlist-active").
// Both producers emit that now; this keeps a snapshot written before the fix
// (or an older deploy's file left on disk) from rendering waitlists as "Full".
const normalizeStatus = (status) =>
  status ? String(status).trim().toLowerCase().replace(/\s+/g, "-") : status;

// Reloadable: read at boot, re-read whenever the scheduler finishes a scrape.
let enriched = null;
// normalized id -> the snapshot's own spelling, so a caller's "cse 100" or
// "DSC 80" reaches the row filed under "CSE 100" / "DSC 80/80R".
let canonicalKeys = new Map();

function loadSnapshot() {
  let upcoming = null;
  try {
    upcoming = JSON.parse(fs.readFileSync(upcomingPath, "utf-8"));
  } catch (err) {
    console.error(
      "⚠️ Upcoming-term data not found — run scripts/scrape-upcoming-term.mjs:",
      err.message,
    );
  }
  if (!upcoming?.courses) return;
  const courses = {};
  const keys = new Map();
  for (const [courseId, sections] of Object.entries(upcoming.courses)) {
    const units = creditsById.get(normalize(courseId)) ?? null;
    courses[courseId] = sections.map((s) => ({
      ...s,
      units: s.units ?? units,
      status: normalizeStatus(s.status),
      // Older snapshots predate `packageIds`; give every reader the plural
      // form so nothing downstream has to branch on snapshot vintage.
      packageIds: Array.isArray(s.packageIds)
        ? s.packageIds
        : s.packageId
          ? [String(s.packageId)]
          : [],
    }));
    keys.set(normalize(courseId), courseId);
    // Cross-listings: "DSC 80/80R" should also answer to "DSC 80" and "DSC 80R".
    const m = String(courseId).match(/^([A-Z]+)\s+(.+)$/i);
    if (m) {
      for (const part of m[2].split("/")) {
        const alias = normalize(`${m[1]} ${part}`);
        if (!keys.has(alias)) keys.set(alias, courseId);
      }
    }
  }
  enriched = { ...upcoming, courses };
  canonicalKeys = keys;
}

/** The snapshot's own spelling of a course id, or the input when unknown. */
const canonicalCourseKey = (id) => canonicalKeys.get(normalize(id)) ?? String(id);
loadSnapshot();
refreshScheduler.init({ onRefreshed: loadSnapshot });

/**
 * GET /next-quarter
 *
 * 503 rather than an empty 200 when the data was never scraped: "no schedule
 * exists" and "the server was deployed without it" are different problems, and
 * the client falls back to the published/extension paths on either.
 */
router.get("/", (req, res) => {
  if (!enriched) {
    return res.status(503).json({
      error: "Upcoming-term schedule not available on this server.",
      hint: "Run scripts/scrape-upcoming-term.mjs and restart.",
    });
  }
  res.json({
    termCode: enriched.term_code,
    year: enriched.year,
    term: enriched.term,
    source: "classplanner",
    // Two clocks (see scrape-upcoming-term.mjs): when UCSD last rebuilt the
    // catalog structure, and when this snapshot was taken. Seat counts in
    // `courses` follow neither — they are indicative; /seats reads them live.
    refreshedAt: enriched.source_refreshed_at,
    scrapedAt: enriched.scraped_at ?? null,
    seatsIndicative: true,
    courseCount: enriched.course_count,
    sectionCount: enriched.section_count,
    courses: enriched.courses,
  });
});

// ---------------------------------------------------------------------------
// Live seats, proxied per course from Class Planner.
//
// The full-term snapshot cannot keep seat numbers current, but a student only
// needs current numbers for the few courses on their plan — and Class Planner
// answers a targeted `course_key` query with fresh counts. Proxying (rather
// than the client calling UCSD directly) keeps the browser same-origin and
// gives one place to be polite from.

const CP_SEARCH = "https://classplanner.apps.ucsd.edu/api/v1/catalog/courses/search";
const UA = "TritonPlanner live-seat check (student project; contact smahadkar@ucsd.edu)";
const MAX_COURSES_PER_REQUEST = 24;

// A short TTL is not about our load — it stops a pathological client (or a
// stuck retry loop) from hammering UCSD through us.
const CACHE_TTL_MS = 30 * 1000;
const seatCache = new Map(); // course key -> { at, sections }

/**
 * GET /next-quarter/seats?courses=CSE 100,BILD 1
 *
 * Returns { termCode, checkedAt, courses: { "CSE 100": [{ sectionRef,
 * seatsAvailable, seatsTotal, waitlisted, status }] } } — seat fields only,
 * keyed to merge onto the snapshot's sections by `sectionRef`.
 */
router.get("/seats", async (req, res) => {
  if (!enriched) {
    return res.status(503).json({ error: "Upcoming-term schedule not available on this server." });
  }
  const requested = String(req.query.courses || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_COURSES_PER_REQUEST);
  if (!requested.length) {
    return res.status(400).json({ error: "Pass ?courses=CSE 100,BILD 1 (comma-separated)." });
  }

  const now = Date.now();
  // The caller writes whatever they have ("cse 100", "DSC 80"), while the
  // snapshot and Class Planner both speak one canonical spelling ("CSE 100",
  // "DSC 80/80R"). Resolve once, up front: cache and snapshot lookups then use
  // the canonical key while the response stays keyed the way the caller asked,
  // so the stale-fallback path can no longer miss the snapshot row that the
  // success path finds.
  const canonicalOf = new Map(requested.map((raw) => [raw, canonicalCourseKey(raw)]));
  const byCanonical = new Map(); // canonical key -> seat rows
  const toFetch = [];
  for (const canonical of new Set(canonicalOf.values())) {
    const hit = seatCache.get(canonical);
    if (hit && now - hit.at < CACHE_TTL_MS) byCanonical.set(canonical, hit.sections);
    else toFetch.push(canonical);
  }

  const respond = (extra) =>
    res.json({
      termCode: enriched.term_code,
      ...extra,
      courses: Object.fromEntries(
        requested.map((raw) => [raw, byCanonical.get(canonicalOf.get(raw)) ?? []]),
      ),
    });

  if (toFetch.length) {
    try {
      const upstream = await fetch(CP_SEARCH, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: JSON.stringify({
          term_code: enriched.term_code,
          q: "",
          course_key: toFetch,
          subject_code: [],
          academic_level: [],
          instructor: [],
          instruction_type: [],
          availability: "any",
          delivery: "any",
          day_code: [],
          earliest_start: null,
          latest_end: null,
          sort: "relevance",
          direction: "asc",
          offset: 0,
          limit: 48,
        }),
      });
      if (!upstream.ok) throw new Error(`Class Planner HTTP ${upstream.status}`);
      const payload = await upstream.json();
      const fetched = new Map();
      for (const c of payload.courses ?? []) {
        const number = String(c.course_code).replace(/^0+(?=\d)/, "");
        const key = canonicalCourseKey(`${c.subject_code} ${number}`);
        const sections = (c.sections ?? []).map((s) => {
          const capacity = Number(s.capacity);
          const available = Number(s.seats_available);
          const hasSeats = Number.isFinite(capacity) && Number.isFinite(available);
          const waitlisted = Number(s.waitlist_enrolled);
          return {
            sectionRef: s.section_ref,
            sectionId: s.section_code || s.section_id || null,
            seatsAvailable: hasSeats ? available : null,
            seatsTotal: hasSeats ? capacity : null,
            seatsTaken: hasSeats ? capacity - available : null,
            waitlisted: Number.isFinite(waitlisted) ? waitlisted : null,
            // Hyphenated, matching sectionPackages.js's STATUS_RANK and
            // WeekSchedule's STATUS_STYLE. "waitlist active" (space) missed
            // every one of those and painted a waitlisted course red "Full".
            status: !hasSeats
              ? null
              : available > 0
                ? "open"
                : waitlisted > 0
                  ? "waitlist-active"
                  : "full",
          };
        });
        // A course can span several result rows (topic courses, section
        // families) exactly as it does in the scraper, so accumulate rather
        // than overwrite — assigning lost every row but the last.
        const prior = fetched.get(key) ?? [];
        const seen = new Set(prior.map((s) => s.sectionRef));
        fetched.set(key, [...prior, ...sections.filter((s) => !seen.has(s.sectionRef))]);
      }
      for (const [key, sections] of fetched) {
        byCanonical.set(key, sections);
        seatCache.set(key, { at: now, sections });
      }
      // A requested course Class Planner does not list (dropped, wrong id) is
      // reported as an empty list — "no data", distinct from "no seats" — and
      // that negative is cached too. Without it, an unlistable course on
      // someone's plan re-queried UCSD on every single request.
      for (const key of toFetch) {
        if (byCanonical.has(key)) continue;
        byCanonical.set(key, []);
        seatCache.set(key, { at: now, sections: [] });
      }
    } catch (err) {
      // Stale-but-labeled beats an error page: fall back to snapshot numbers
      // for whatever could not be fetched, and say so.
      for (const key of toFetch) {
        if (byCanonical.has(key)) continue;
        byCanonical.set(
          key,
          (enriched.courses[key] ?? []).map((s) => ({
            sectionRef: s.sectionRef,
            sectionId: s.sectionId,
            seatsAvailable: s.seatsAvailable,
            seatsTotal: s.seatsTotal,
            seatsTaken: s.seatsTaken,
            waitlisted: s.waitlisted,
            status: s.status,
          })),
        );
      }
      return respond({ checkedAt: null, stale: true, reason: String(err.message || err) });
    }
  }

  respond({ checkedAt: new Date(now).toISOString(), stale: false });
});

// ---------------------------------------------------------------------------
// Refresh control. Reading status is public — it is just freshness metadata,
// and the client may want to show "schedule as of X". Triggering a scrape or
// changing the cadence is admin-only (the same app_admins row that gates the
// legacy Supabase publish).

const snapshotMeta = () => ({
  termCode: enriched?.term_code ?? null,
  scrapedAt: enriched?.scraped_at ?? null,
  sourceRefreshedAt: enriched?.source_refreshed_at ?? null,
  courseCount: enriched?.course_count ?? null,
  sectionCount: enriched?.section_count ?? null,
});

/**
 * GET /next-quarter/refresh-status — public.
 *
 * `lastRun.output` is the scraper's own stdout/stderr tail: on a failure that
 * is a Node stack trace with absolute paths from the deploy host. Freshness
 * metadata is fine for anyone to read; the server's filesystem layout is not,
 * so the tail is stripped here and served only from the admin-gated twin below.
 */
router.get("/refresh-status", (req, res) => {
  const { lastRun, ...status } = refreshScheduler.getStatus();
  res.json({
    ...status,
    lastRun: lastRun
      ? {
          at: lastRun.at,
          ok: lastRun.ok,
          // A failure is worth admitting; its stack trace is not.
          error: lastRun.ok ? null : "The last refresh failed.",
          durationMs: lastRun.durationMs,
        }
      : null,
    ...snapshotMeta(),
  });
});

/** GET /next-quarter/refresh-status/detail — admin-only, includes scraper output. */
router.get("/refresh-status/detail", requireAdmin, (req, res) => {
  res.json({ ...refreshScheduler.getStatus(), ...snapshotMeta() });
});

/** POST /next-quarter/refresh — start a scrape now. 202; poll refresh-status. */
router.post("/refresh", requireAdmin, (req, res) => {
  const status = refreshScheduler.getStatus();
  if (status.running) {
    return res.status(409).json({ error: "A refresh is already running." });
  }
  refreshScheduler.runRefresh(); // runs in the background; status reports it
  res.status(202).json({ started: true });
});

/** PUT /next-quarter/refresh-config { intervalHours } — 0 means manual-only. */
router.put("/refresh-config", requireAdmin, express.json(), (req, res) => {
  try {
    res.json(refreshScheduler.setIntervalHours(Number(req.body?.intervalHours)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
