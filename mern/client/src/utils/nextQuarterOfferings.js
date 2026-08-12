// Shared next-enrollment-quarter offerings: one fetch path for Course Search's
// "Next" filter and the "offered next quarter" tags on planner / quarter /
// search cards.
//
// Source of truth is the server's Class Planner feed (UCSD's own public
// schedule mirror — verified to track TSS within minutes): works signed out,
// needs no extension and no admin, and is the only source the planner agent
// can also see. The one fallback is an admin-published term_sections row in
// Supabase — a dormant copy of the old TSS-capture workflow, kept solely for
// the day UCSD gates Class Planner. The extension is no longer part of this
// read path at all; it exists for booking (see booking-bridge/README).

import { nextEnrollmentQuarter } from "./academicCalendar.js";
import { courseIdVariants } from "./courseIds.js";

export const compactCourseId = (id) =>
  String(id || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/** Flatten admin-published term_sections into a Course Search offerings list. */
export function offeringsFromPublished(published) {
  const byId = new Map();
  for (const [key, sections] of Object.entries(published?.courses || {})) {
    const first = Array.isArray(sections) ? sections[0] : null;
    const courseId = key || first?.courseId;
    if (!courseId || byId.has(courseId)) continue;
    const units = Number(first?.units ?? first?.unitsMax ?? first?.unitsMin);
    byId.set(courseId, {
      courseId,
      courseName: first?.courseName || null,
      credits: Number.isFinite(units) ? units : null,
    });
  }
  return [...byId.values()].sort((a, b) =>
    a.courseId.localeCompare(b.courseId)
  );
}

/**
 * Compact-id set covering every offered course and its cross-listing aliases,
 * so planner/audit ids ("DSC 80") match published keys ("DSC 80/80R").
 */
export function buildOfferedCompactSet(courses) {
  const set = new Set();
  for (const course of courses || []) {
    const id = course?.courseId || course?.course_id;
    if (!id) continue;
    set.add(compactCourseId(id));
    for (const variant of courseIdVariants(id)) {
      set.add(compactCourseId(variant));
    }
  }
  return set;
}

export function isCourseOfferedNext(courseId, offeredSet) {
  if (!offeredSet?.size || !courseId) return false;
  if (offeredSet.has(compactCourseId(courseId))) return true;
  for (const variant of courseIdVariants(courseId)) {
    if (offeredSet.has(compactCourseId(variant))) return true;
  }
  return false;
}

/**
 * Overlay live seat numbers onto snapshot sections without touching structure.
 *
 * The /next-quarter/seats endpoint returns only seat fields per section
 * (matched by sectionRef, falling back to sectionId), because the snapshot
 * already has the times/instructors/rooms and those age slowly. This is
 * deliberately NOT mergeSectionMaps, which swaps whole section lists and
 * would discard that structure.
 */
export function overlayLiveSeats(sectionsByCourse = {}, liveSeats = {}) {
  const out = { ...sectionsByCourse };
  // Course keys are matched through cross-listing aliases, not by exact string.
  // The snapshot keys a course by the catalog's spelling ("DSC 80/80R") while a
  // live row can come back under a single one ("DSC 80"), and an exact lookup
  // silently skipped those courses — leaving stale snapshot seat counts on
  // screen with no indication they hadn't refreshed.
  const keyIndex = new Map();
  for (const key of Object.keys(sectionsByCourse || {})) {
    for (const variant of courseIdVariants(key)) {
      if (!keyIndex.has(variant)) keyIndex.set(variant, key);
    }
  }
  const resolveKey = (courseKey) => {
    if (out[courseKey]?.length) return courseKey;
    for (const variant of courseIdVariants(courseKey)) {
      const hit = keyIndex.get(variant);
      if (hit && out[hit]?.length) return hit;
    }
    return null;
  };

  for (const [rawKey, liveList] of Object.entries(liveSeats || {})) {
    if (!liveList?.length) continue;
    const courseKey = resolveKey(rawKey);
    if (!courseKey) continue;
    const existing = out[courseKey];
    if (!existing?.length) continue;
    const byRef = new Map();
    for (const s of liveList) {
      if (s.sectionRef) byRef.set(s.sectionRef, s);
      else if (s.sectionId) byRef.set(s.sectionId, s);
    }
    out[courseKey] = existing.map((section) => {
      const live = byRef.get(section.sectionRef) ?? byRef.get(section.sectionId);
      if (!live) return section;
      // Every field is `??`-guarded, not just status. A live row can carry
      // nulls — Class Planner omits capacity for some sections, and the proxy's
      // stale fallback echoes whatever it had — and assigning those
      // unconditionally erased a real snapshot number, turning "37 seats" into
      // no seat signal at all.
      return {
        ...section,
        seatsAvailable: live.seatsAvailable ?? section.seatsAvailable,
        seatsTotal: live.seatsTotal ?? section.seatsTotal,
        seatsTaken: live.seatsTaken ?? section.seatsTaken,
        waitlisted: live.waitlisted ?? section.waitlisted,
        status: live.status ?? section.status,
      };
    });
  }
  return out;
}

/**
 * The server's Class Planner schedule for one quarter, in the same shape
 * `fetchPublishedTerm` returns, or null when the server doesn't have that
 * quarter (or is down). Lets the quarter view treat "server feed" and "admin
 * publish" as interchangeable baselines, server first.
 */
export async function fetchServerTerm(academicYear, term) {
  if (!academicYear || !term) return null;
  try {
    const { API_URL } = await import("./api.js");
    const res = await fetch(`${API_URL}/next-quarter`);
    if (!res.ok) return null;
    const payload = await res.json();
    if (!payload?.courses) return null;
    // The snapshot names its own quarter, and that name is the truth — the
    // caller's year/term is a guess from academicCalendar.js. Rather than
    // discarding a perfectly good schedule when the two disagree (which is
    // exactly what happens the week Class Planner rolls over), hand the data
    // back labelled with the server's quarter and let the caller decide.
    const termMatches =
      payload.year === String(academicYear) && payload.term === term;
    return {
      courses: payload.courses,
      courseCount: payload.courseCount ?? null,
      sectionCount: payload.sectionCount ?? null,
      truncated: false,
      source: "classplanner",
      termMatches,
      serverYear: payload.year ?? null,
      serverTerm: payload.term ?? null,
      serverTermCode: payload.termCode ?? null,
      seatsIndicative: Boolean(payload.seatsIndicative),
      refreshedAt: payload.scrapedAt ? new Date(payload.scrapedAt).getTime() : null,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch current seat counts for these courses from the server's Class Planner
 * proxy. Returns { ok, stale, checkedAt, courses } or { ok: false } — never
 * throws. `stale: true` means the proxy could not reach Class Planner and
 * echoed snapshot numbers instead.
 */
export async function fetchLiveSeatCounts(courseIds) {
  const ids = [...new Set((courseIds || []).filter(Boolean))];
  if (!ids.length) return { ok: true, courses: {}, stale: false, checkedAt: null };
  try {
    const { API_URL } = await import("./api.js");
    const res = await fetch(
      `${API_URL}/next-quarter/seats?courses=${encodeURIComponent(ids.join(","))}`
    );
    if (!res.ok) return { ok: false, courses: {}, stale: true, checkedAt: null };
    const payload = await res.json();
    return {
      ok: true,
      courses: payload.courses || {},
      stale: Boolean(payload.stale),
      checkedAt: payload.checkedAt ? new Date(payload.checkedAt).getTime() : null,
    };
  } catch {
    return { ok: false, courses: {}, stale: true, checkedAt: null };
  }
}

// In-flight loads, keyed by quarter. The provider's eager effect and the
// manual refresh can both fire before either resolves — harmless when this
// read was a Supabase call, wasteful now that it is a multi-megabyte term
// schedule over HTTP. Entries are dropped the moment they settle, so this
// coalesces a burst without caching a stale answer across a refresh.
const inFlight = new Map();

/**
 * Load offerings for the next enrollment quarter.
 * Returns { status: "ready"|"error", courses, ... } — never throws.
 */
export function loadNextQuarterOfferings(
  enrollmentQuarter = nextEnrollmentQuarter()
) {
  const key = `${enrollmentQuarter?.academicYear}-${enrollmentQuarter?.term}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = loadNextQuarterOfferingsUncached(enrollmentQuarter).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}

async function loadNextQuarterOfferingsUncached(enrollmentQuarter) {
  if (!enrollmentQuarter?.academicYear || !enrollmentQuarter?.term) {
    return {
      status: "error",
      courses: [],
      sections: {},
      reason: "Could not determine the next enrollment quarter.",
      needsSignIn: false,
      source: null,
    };
  }

  // Dynamic import keeps matching helpers free of Supabase deps
  // (so unit tests can import this module under plain Node).
  const { fetchPublishedTerm } = await import("./termSections.js");

  // 1) The server's Class Planner feed — no Supabase row, no extension, no TSS
  // session, and available to a signed-out visitor on first paint.
  try {
    const { API_URL } = await import("./api.js");
    const res = await fetch(`${API_URL}/next-quarter`);
    if (res.ok) {
      const payload = await res.json();
      const courses = offeringsFromPublished(payload);
      if (courses.length) {
        // The snapshot's own term wins over the calendar's guess. This used to
        // require a match, which meant that the moment Class Planner rolled to
        // the next quarter — during enrollment, precisely when this matters —
        // the offerings feature returned nothing at all for weeks. A schedule
        // that says which quarter it describes is strictly better information
        // than a date heuristic, so report it rather than reject it.
        return {
          status: "ready",
          courses,
          sections: payload.courses || {},
          reason: null,
          needsSignIn: false,
          truncated: false,
          count: courses.length,
          source: "classplanner",
          year: payload.year ?? enrollmentQuarter.academicYear,
          term: payload.term ?? enrollmentQuarter.term,
          termCode: payload.termCode ?? enrollmentQuarter.termCode,
          // True when the server describes a different quarter than the client
          // guessed — the caller may want to relabel rather than assume.
          termMatches:
            payload?.year === enrollmentQuarter.academicYear &&
            payload?.term === enrollmentQuarter.term,
          // `scrapedAt` (when the snapshot was taken) is the honest age of the
          // seat numbers; `refreshedAt` from the server is UCSD's catalog
          // rebuild clock, which seats do not follow.
          refreshedAt: payload.scrapedAt
            ? new Date(payload.scrapedAt).getTime()
            : payload.refreshedAt
              ? new Date(payload.refreshedAt).getTime()
              : null,
        };
      }
    }
  } catch (err) {
    console.warn("Class Planner offerings unavailable:", err);
  }

  // 2) Dormant fallback: the last admin-published capture. Only reachable if
  // the server (or Class Planner itself) is down, so its age is whatever it
  // is — better labeled-stale data than an empty schedule.
  try {
    const published = await fetchPublishedTerm(
      enrollmentQuarter.academicYear,
      enrollmentQuarter.term
    );
    const courses = offeringsFromPublished(published);
    if (courses.length) {
      return {
        status: "ready",
        courses,
        // Full section map (times + snapshot seats) for chat / quarter view.
        sections: published.courses || {},
        reason: null,
        needsSignIn: false,
        truncated: Boolean(published.truncated),
        count: courses.length,
        source: "published",
        year: enrollmentQuarter.academicYear,
        term: enrollmentQuarter.term,
        termCode: enrollmentQuarter.termCode,
        termMatches: true,
        refreshedAt: published.refreshedAt || null,
      };
    }
  } catch (err) {
    console.warn("Published term offerings unavailable:", err);
  }

  return {
    status: "error",
    courses: [],
    sections: {},
    reason:
      "The upcoming-quarter schedule is unavailable right now — the schedule server could not be reached.",
    needsSignIn: false,
    source: null,
  };
}
