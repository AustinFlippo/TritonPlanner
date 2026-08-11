// Compact seat/section snapshots for the planner chat and shared TSS context.
// Prefers live extension data over the admin-published term_sections snapshot.

import { courseIdVariants } from "./courseIds.js";

// Same compacting as nextQuarterOfferings.compactCourseId — kept local so
// this util (and its tests) don't pull in the booking-bridge import graph.
export const compactCourseId = (id) =>
  String(id || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/** Unique course ids mentioned in free text. */
export function courseIdsFromText(text) {
  const ids = [];
  const seen = new Set();
  const src = String(text || "");
  // Fresh regex each call — a module-level /g lastIndex would skip matches.
  const re = /\b([A-Z]{2,6})\s*(\d{1,3}[A-Z]{0,3})\b/gi;
  let m;
  while ((m = re.exec(src))) {
    const id = `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
    const key = compactCourseId(id);
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }
  return ids;
}

/** Merge extension sections over a published baseline (live seats win). */
export function mergeSectionMaps(published = {}, live = {}) {
  const merged = { ...published };
  for (const [courseId, list] of Object.entries(live || {})) {
    if (!list?.length) continue;
    const existing = merged[courseId] || [];
    const incomingVerified = list.some((s) => s.termText || s.year);
    const existingVerified = existing.some((s) => s.termText || s.year);
    if (existingVerified && !incomingVerified) continue;
    merged[courseId] = list;
  }
  return merged;
}

function lookupSections(sectionsByCourse, courseId) {
  if (!sectionsByCourse || !courseId) return null;
  if (sectionsByCourse[courseId]?.length) return sectionsByCourse[courseId];
  const wanted = compactCourseId(courseId);
  for (const [key, list] of Object.entries(sectionsByCourse)) {
    if (!list?.length) continue;
    if (compactCourseId(key) === wanted) return list;
    for (const variant of courseIdVariants(key)) {
      if (compactCourseId(variant) === wanted) return list;
    }
  }
  for (const variant of courseIdVariants(courseId)) {
    if (sectionsByCourse[variant]?.length) return sectionsByCourse[variant];
  }
  return null;
}

/** Course ids currently placed in one planner quarter. */
export function courseIdsInQuarter(schedule, yearIndex, term) {
  if (!Array.isArray(schedule) || yearIndex == null || !term) return [];
  const year = schedule[yearIndex];
  if (!year) return [];
  return (year[term] || [])
    .filter(Boolean)
    .map((c) => c.course_id || c.courseId)
    .filter(Boolean);
}

/**
 * Build a compact seat payload for the chat backend.
 * Only includes the requested course ids (plan + message mentions).
 */
export function buildSeatAvailability({
  sectionsByCourse,
  courseIds,
  termLabel = null,
  source = null,
  refreshedAt = null,
  live = false,
} = {}) {
  const courses = [];
  const seen = new Set();
  for (const id of courseIds || []) {
    const key = compactCourseId(id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const list = lookupSections(sectionsByCourse, id);
    if (!list?.length) {
      courses.push({ courseId: id, sections: [], offered: false });
      continue;
    }
    courses.push({
      courseId: list[0]?.courseId || id,
      offered: true,
      sections: list.map((s) => ({
        sectionId: s.sectionId || null,
        component: s.component || null,
        // Full package membership: a lecture belongs to every one of its labs'
        // packages, and the agent cannot assemble a valid enrollment from the
        // first id alone. `packageId` stays for readers not yet migrated.
        packageIds: Array.isArray(s.packageIds)
          ? s.packageIds
          : s.packageId
            ? [s.packageId]
            : [],
        packageId: s.packageId || null,
        days: s.days || [],
        start: s.start || null,
        end: s.end || null,
        // Only when a section really meets at more than one time in the week —
        // otherwise this repeats days/start/end for every section in the payload.
        ...(Array.isArray(s.meetings) && s.meetings.length > 1
          ? { meetings: s.meetings }
          : {}),
        instructor: s.instructor || null,
        location: s.location || null,
        seatsAvailable: Number.isFinite(s.seatsAvailable) ? s.seatsAvailable : null,
        seatsTotal: Number.isFinite(s.seatsTotal) ? s.seatsTotal : null,
        waitlisted: Number.isFinite(s.waitlisted) ? s.waitlisted : null,
        status: s.status || null,
      })),
    });
  }

  return {
    termLabel,
    source,
    live: Boolean(live),
    refreshedAt: refreshedAt || null,
    courses,
  };
}
