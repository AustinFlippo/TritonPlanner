// Pulls the upcoming term's real schedule — courses, instructors, section and
// seat counts — from UC San Diego's own Class Planner API.
//
// Why this exists: TritonPlanner's other two sources both stop before the term
// a student is actually about to enrol in. catalog.ucsd.edu describes courses
// without saying who teaches them; legacy act.ucsd.edu ends at Summer 2026
// (`subject-list.json?selectedTerm=FA26` returns []). That left the upcoming
// quarter reachable only inside TSS behind SSO + Duo — see the booking-bridge
// README for why that forces a browser extension.
//
// classplanner.apps.ucsd.edu is the exception, and it is worth being precise
// about what it changes: UCSD's own planner is a public, unauthenticated
// Next.js app over a REST API that serves the current term's sections,
// instructors, meeting times and live seat counts. No SSO, no Duo, no
// extension. It does NOT expose anything student-specific — no enrolment, no
// booking, no personal data — so the booking-bridge constraint still holds for
// everything it was written about. What it removes is the belief that *read-
// only schedule data* for the upcoming term is unreachable from a backend.
//
// Endpoints (both public, both GET unless noted):
//   /api/v1/planner/terms                  -> which terms are loaded
//   /api/v1/catalog/courses/search  (POST) -> paginated course list; the body
//                                             mirrors the app's own filter bar,
//                                             and offset/limit walk the term
//
// Instructor names arrive as preferred display names ("Leo Porter",
// "Geoff Voelker"), which match RateMyProfessors more closely than the
// registry spellings the Schedule of Classes uses ("Porter, Leonard Emerson").
//
// Usage:  node scripts/scrape-upcoming-term.mjs [TERM]   (default: the term
//         the API reports as configured)
// Output: scripts/data/upcoming-term.json
//         { term_code, year, term, fetched_from, course_count, section_count,
//           courses: { "CSE 100": [section, ...] } }
//
// Two fields on each section carry more than their singular predecessors, and
// both exist because the singular form quietly lost data:
//
//   packageIds  every enrollment package this section belongs to. A lecture
//               belongs to all of its labs' packages; `packageId` (first only)
//               left every package but one without its lecture.
//   meetings    one row per distinct weekly time+room. A section can meet at
//               two different times in a week (BENG 133 does); the flat
//               days/start/end pair can only describe one of them.
//
// The flat `packageId` / `days` / `start` / `end` fields remain for readers that
// have not migrated, but they are a lossy view — prefer the plural ones.
//
// `courses` deliberately mirrors the shape `term_sections.courses` already uses
// in Supabase (see client/src/utils/termSections.js), so WeekSchedule, the
// quarter view and the chat context read it without a single change — this is a
// new source for an existing contract, not a new contract.
//
// Two different clocks, and conflating them is a trap:
//
//   source_refreshed_at  UCSD's own `last_full_refresh_at` — when the catalog
//                        structure (courses, sections, times, instructors) was
//                        last rebuilt. It sits unchanged for days.
//   scraped_at           when THIS file was written.
//
// Seat counts do NOT follow either one: they move continuously while
// `last_full_refresh_at` stays frozen (measured 2026-08-11: 50 of 223 sections
// changed seats in 21 hours with that timestamp untouched). So the structural
// data here ages slowly and safely, while the seat numbers are stale the moment
// they are written. Treat `seatsAvailable` in this file as indicative only —
// `GET /next-quarter/seats` re-reads them live per course, and during an
// enrollment window the student's own TSS session is still the authority.
//
// Re-run whenever the term rolls over or staffing changes; unlike the
// act.ucsd.edu harvests there is nothing irreplaceable here, since this
// endpoint tracks the live term.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "data");
const outPath = path.join(outDir, "upcoming-term.json");

const BASE = "https://classplanner.apps.ucsd.edu/api/v1";
const UA = "TritonPlanner upcoming-term sync (student project; contact smahadkar@ucsd.edu)";
const PAGE_SIZE = 48; // the API's documented ceiling: limit > 48 is a 422
const DELAY_MS = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, init) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": UA, Accept: "application/json", ...(init?.headers ?? {}) },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt >= 3) throw new Error(`${e.message} for ${url}`);
      await sleep(1000 * attempt);
    }
  }
}

async function resolveTerm(requested) {
  const { terms } = await request(`${BASE}/planner/terms`);
  if (!terms?.length) throw new Error("Class Planner reports no configured terms");
  if (requested) {
    const hit = terms.find((t) => t.term_code === requested);
    if (!hit) {
      throw new Error(
        `term ${requested} not loaded; available: ${terms.map((t) => t.term_code).join(", ")}`,
      );
    }
    return hit;
  }
  return terms.find((t) => t.configured) ?? terms[0];
}

// The search body is the app's own filter bar with everything left wide open,
// so the only thing narrowing the result set is the term.
const searchBody = (termCode, offset) => ({
  term_code: termCode,
  q: "",
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
  offset,
  limit: PAGE_SIZE,
});

// "001-000-LE" -> "LE". The component code the planner already speaks; the API
// only spells it out ("lecture"), and the abbreviation lives in the section id.
const componentOf = (sectionCode) => {
  const m = String(sectionCode || "").match(/-([A-Z]{2})$/);
  return m ? m[1] : null;
};

// `room_code` already carries the building ("GH 242", "JEANN AUD"), so joining
// it to `building_code` would read "GH GH 242".
const locationOf = (meeting) => {
  if (!meeting) return null;
  if (meeting.is_remote) return "Remote";
  return meeting.room_code || meeting.building_code || null;
};

// Matches booking-bridge's normalizeStatus vocabulary. The API's own `status`
// is "AC" for everything on the schedule, so it says nothing about seats; the
// counts do.
//
// The hyphen in "waitlist-active" is load-bearing: sectionPackages.js's
// STATUS_RANK, courseSeatChip and WeekSchedule's STATUS_STYLE all key on the
// hyphenated form. This file used to emit "waitlist active" (space), which fell
// through every one of those lookups and rendered a waitlisted course as a red
// "Full" chip. Normalize here, at the boundary, so nothing downstream has to.
function statusOf({ seats_available: available, waitlist_enrolled: waitlisted }) {
  if (!Number.isFinite(available)) return null;
  if (available > 0) return "open";
  return waitlisted > 0 ? "waitlist-active" : "full";
}

// The planner's weekday vocabulary (R = Thursday), which Class Planner happens
// to share. Meetings come back in whatever order the API stored them, so days
// are sorted into week order — otherwise "MWF" renders as "FMW".
const DAY_ORDER = ["M", "T", "W", "R", "F", "S", "U"];

const sortDays = (days) =>
  [...new Set(days.filter(Boolean))].sort(
    (a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b),
  );

/**
 * Collapse a section's weekly meetings into one row per distinct time+room.
 *
 * A section is NOT one time range. BENG 133's lecture really meets M 11:00–11:50
 * *and* T/R 9:30–10:50. Unioning the days and keeping only the first meeting's
 * clock (what this file used to do) stored that as "MTR 11:00am–11:50am", which
 * both invents a Tuesday/Thursday 11am block that does not exist and hides the
 * two 9:30 blocks that do — producing phantom conflicts and missed ones in the
 * same section.
 *
 * Days that share a start/end/room are merged so the common case still reads as
 * one "TuTh 9:30–10:50" row rather than two identical single-day rows.
 */
function meetingsOf(weekly) {
  const byTime = new Map();
  for (const m of weekly) {
    const start = m.start_time_display ?? null;
    const end = m.end_time_display ?? null;
    const location = locationOf(m);
    const key = `${start}|${end}|${location}`;
    if (!byTime.has(key)) byTime.set(key, { days: [], start, end, location });
    if (m.day_code) byTime.get(key).days.push(m.day_code);
  }
  return [...byTime.values()]
    .map((m) => ({ ...m, days: sortDays(m.days) }))
    .sort(
      (a, b) =>
        DAY_ORDER.indexOf(a.days[0]) - DAY_ORDER.indexOf(b.days[0]) ||
        String(a.start).localeCompare(String(b.start)),
    );
}

// Class Planner returns package ids as strings already, but a number here and a
// string there would silently split a package in two once these are used as map
// keys — so canonicalize.
const packageIdsOf = (section) =>
  [...new Set((section.event_package_ids ?? []).map((id) => String(id)).filter(Boolean))];

// One Class Planner section -> one planner section, in booking-bridge's shape.
function toSection(course, section, termInfo) {
  // `final` meetings are one-off exam slots; letting them through would draw an
  // exam block onto the weekly grid.
  const weekly = (section.meetings ?? []).filter((m) => m.meeting_kind === "class" && !m.is_tba);
  const meetings = meetingsOf(weekly);
  const first = weekly[0] ?? null;
  const packageIds = packageIdsOf(section);
  const capacity = Number(section.capacity);
  const available = Number(section.seats_available);
  const hasSeats = Number.isFinite(capacity) && Number.isFinite(available);
  const number = String(course.course_code).replace(/^0+(?=\d)/, "");

  return {
    courseId: `${course.subject_code} ${number}`,
    courseName: course.module_name || null,
    sectionId: section.section_code || section.section_id || null,
    component: componentOf(section.section_code),
    componentName: section.instruction_type_name || null,
    // Every weekly meeting, each with its own clock and room. This is the
    // truthful shape; consumers that draw a week grid should read it.
    meetings,
    // Backward compat for readers that predate `meetings`: the first meeting,
    // days and times consistent with each other. (They used to union the days
    // across all meetings while keeping only the first meeting's times, which
    // described a schedule nobody has.)
    days: meetings[0]?.days ?? [],
    start: meetings[0]?.start ?? first?.start_time_display ?? null,
    end: meetings[0]?.end ?? first?.end_time_display ?? null,
    instructor: section.instructors?.[0] ?? null,
    location: meetings[0]?.location ?? locationOf(first),
    // Class Planner carries no unit count; the catalog does, and the server
    // fills it in from v5.json when it serves this.
    units: null,
    unitsMin: null,
    unitsMax: null,
    seatsAvailable: hasSeats ? available : null,
    seatsTotal: hasSeats ? capacity : null,
    seatsTaken: hasSeats ? capacity - available : null,
    waitlisted: Number.isFinite(Number(section.waitlist_enrolled))
      ? Number(section.waitlist_enrolled)
      : null,
    // A section belongs to EVERY package that names it — a lecture is shared by
    // all nine of its labs' packages. Keeping only the first stranded the shared
    // component: package #2..#9 became lab-only orphans, and for 222 courses no
    // package bundled a lecture with a linked section at all, making a complete
    // enrollment unrepresentable. `packageId` stays as the first id purely so
    // readers that have not migrated to `packageIds` keep working.
    packageIds,
    packageId: packageIds[0] ?? null,
    status: statusOf(section),
    term: termInfo.term_code,
    termKey: termInfo.term_code,
    year: termInfo.year,
    scrapedFrom: "classplanner",
  };
}

async function main() {
  const term = await resolveTerm(process.argv[2]);
  console.log(
    `${term.term_code}: ${term.course_count} courses, ${term.section_count} sections ` +
      `(UCSD last refreshed ${term.last_full_refresh_at})`,
  );

  // "FA26" -> the { year, term } the client's academicCalendar.js speaks, so a
  // published Supabase row and this file describe the same quarter the same way.
  const TERM_NAMES = { FA: "fall", WI: "winter", SP: "spring" };
  const calendarYear = 2000 + Number(term.term_code.slice(2));
  const termName = TERM_NAMES[term.term_code.slice(0, 2)] ?? null;
  const termMeta = {
    term_code: term.term_code,
    // Fall opens the academic year; winter and spring belong to the one before.
    year: String(termName === "fall" ? calendarYear : calendarYear - 1),
    term: termName,
  };

  const courses = {};
  let offset = 0;
  let total = null;

  while (total === null || offset < total) {
    const page = await request(`${BASE}/catalog/courses/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(searchBody(term.term_code, offset)),
    });
    if (total === null) total = page.total;

    for (const c of page.courses ?? []) {
      // "CSE-008A" -> "CSE 8A": strip SAP's zero padding so the key matches the
      // catalog ids every other script in this pipeline uses.
      const number = String(c.course_code).replace(/^0+(?=\d)/, "");
      const key = `${c.subject_code} ${number}`;
      const list = (courses[key] ??= []);
      // A course can span several result rows (topic courses, section
      // families), so sections accumulate and dedupe on the API's own id.
      for (const s of c.sections ?? []) {
        if (list.some((existing) => existing.sectionRef === s.section_ref)) continue;
        list.push({ ...toSection(c, s, termMeta), sectionRef: s.section_ref });
      }
    }

    offset += PAGE_SIZE;
    console.log(`  ${Math.min(offset, total)}/${total} courses`);
    if (!page.courses?.length) break; // defensive: never spin on an empty page
    await sleep(DELAY_MS);
  }

  const keys = Object.keys(courses);
  const sections = keys.reduce((n, k) => n + courses[k].length, 0);
  const withInstructors = keys.filter((k) =>
    courses[k].some((s) => s.instructor),
  ).length;
  const withTimes = keys.filter((k) => courses[k].some((s) => s.start)).length;

  fs.mkdirSync(outDir, { recursive: true });
  // Write-then-rename, because this file is ~5MB and the refresh scheduler
  // SIGKILLs a run that overruns its timeout. A kill landing mid-writeFileSync
  // on the real path leaves truncated JSON, which makes the route's
  // loadSnapshot throw and serve 503 forever — a wedged scrape must never be
  // able to destroy the last good snapshot. rename(2) is atomic within a
  // filesystem, so a reader sees either the old file or the whole new one.
  const tmpPath = `${outPath}.${process.pid}.tmp`;
  fs.writeFileSync(
    tmpPath,
    JSON.stringify(
      {
        ...termMeta,
        fetched_from: "classplanner.apps.ucsd.edu",
        source_refreshed_at: term.last_full_refresh_at,
        scraped_at: new Date().toISOString(),
        course_count: keys.length,
        section_count: sections,
        courses,
      },
      null,
      1,
    ),
  );
  fs.renameSync(tmpPath, outPath);

  console.log(`\nWrote ${keys.length} courses / ${sections} sections to ${outPath}`);
  console.log(`  ${withInstructors} have at least one named instructor`);
  console.log(`  ${withTimes} have at least one scheduled meeting time`);
  const staffOnly = keys.length - withInstructors;
  if (staffOnly) console.log(`  ${staffOnly} are staffed TBD (no instructor announced yet)`);
}

main().catch((e) => {
  // Never leave a half-written temp beside the snapshot it was meant to replace.
  try {
    for (const f of fs.readdirSync(outDir)) {
      if (f.startsWith("upcoming-term.json.") && f.endsWith(".tmp")) {
        fs.unlinkSync(path.join(outDir, f));
      }
    }
  } catch {
    /* the scrape already failed; cleanup is best-effort */
  }
  console.error(e);
  process.exit(1);
});
