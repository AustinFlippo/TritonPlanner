// Pure schedule-grid operations shared by views that edit the plan.
// Slot semantics mirror the planner: each term keeps at least 2 slots and
// always ends with one empty slot ready to receive a drop.

import { normalizeCourseCredits } from "./courseCredits.js";
import { isTakenCourse } from "./courseIds.js";

const TERMS = ["fall", "winter", "spring"];

const cloneSchedule = (schedule) =>
  schedule.map((year) => {
    const copy = {};
    TERMS.forEach((t) => {
      copy[t] = [...(year?.[t] || [])];
    });
    return copy;
  });

const tidySlots = (slots) => {
  const courses = slots.filter(Boolean);
  while (courses.length < 2) courses.push(null);
  courses.push(null);
  return courses;
};

/**
 * Sidebar / catalog drops have no audit status — treat them as planned.
 *
 * Credits go through normalizeCourseCredits rather than `Number(x) || 0`:
 * a search result normalized to `credits: null`, or an audit-vouched course
 * the catalog has never published, has genuinely unknown units. Coercing that
 * to 0 made hasUnknownCredits false, so the card stopped showing "? u" and
 * every unit total quietly understated. Unknown stays null.
 */
const normalizePlacedCourse = (course) => {
  const normalized = normalizeCourseCredits(course) || {};
  const status = normalized.status;
  // "failed" must survive here. It is set from an F/W/NP/I on the audit, and
  // rewriting it to "planned" would put the failed attempt back to work
  // satisfying the very requirement it failed.
  if (
    status === "completed" ||
    status === "current" ||
    status === "planned" ||
    status === "failed"
  ) {
    return normalized;
  }
  return { ...normalized, status: "planned" };
};

// Coerce a restored or proposed grid into the planner's shape. yearCount comes
// from the student's plan window (4 for most, more for a fifth-year); it never
// shrinks below the incoming grid, so restoring a longer saved plan before the
// audit loads cannot silently drop its last years.
export const normalizePlanGrid = (plan, yearCount = 4) =>
  Array(Math.max(yearCount, Array.isArray(plan) ? plan.length : 0))
    .fill()
    .map((_, yearIndex) => {
      const source = (plan && plan[yearIndex]) || {};
      const year = {};
      TERMS.forEach((term) => {
        const courses = (source[term] || [])
          .filter(
            (course) =>
              course && typeof course === "object" && course.course_id
          )
          .map((course) => normalizePlacedCourse(course));
        year[term] = tidySlots(courses);
      });
      return year;
    });

export const quarterHasCourse = (schedule, yearIndex, term, courseId) =>
  (schedule?.[yearIndex]?.[term] || []).some(
    (c) => c && c.course_id === courseId
  );

/** Completed or in-progress cards anywhere on the grid — not failed retakes. */
export const scheduleHasTakenCourse = (schedule, courseId) => {
  if (!courseId) return false;
  for (const year of schedule || []) {
    for (const term of TERMS) {
      for (const c of year?.[term] || []) {
        if (!c?.course_id) continue;
        if (c.status !== "completed" && c.status !== "current") continue;
        if (isTakenCourse(courseId, [c.course_id])) return true;
      }
    }
  }
  return false;
};

// Remove the course at a slot, trimming excess empty slots
export const removeCourseAt = (schedule, yearIndex, term, courseIndex) => {
  const next = cloneSchedule(schedule);
  next[yearIndex][term][courseIndex] = null;
  next[yearIndex][term] = tidySlots(next[yearIndex][term]);
  return next;
};

// Add a course to a quarter: first empty slot, keeping a trailing empty one
export const insertCourse = (
  schedule,
  yearIndex,
  term,
  course,
  takenIds = null
) => {
  const placed = normalizePlacedCourse(course);
  if (takenIds && isTakenCourse(placed.course_id, takenIds)) return schedule;
  if (scheduleHasTakenCourse(schedule, placed.course_id)) return schedule;
  const next = cloneSchedule(schedule);
  const slots = next[yearIndex][term];
  const empty = slots.findIndex((c) => c === null);
  if (empty === -1) slots.push(placed);
  else slots[empty] = placed;
  if (!slots.some((c) => c === null)) slots.push(null);
  return next;
};

/**
 * Place a course on a specific planner slot (sidebar drop or move/swap).
 *
 * Always deep-clones — the planner used to shallow-copy the year array and
 * mutate term slots in place, so React sometimes kept a stale schedule and
 * auto-save never saw the drag.
 *
 * A drag between two grid slots is a swap: the courses trade places, so
 * nothing is lost. A drop FROM the sidebar has nowhere to send the occupant,
 * and used to simply overwrite it — no confirm, no undo, and every slot in a
 * term is a drop target, so this was a routine way to silently delete a
 * planned course. The occupant is displaced to the next free slot instead
 * (the term grows one if it has to), and a course already in the term is not
 * added twice, matching the QuarterlyView insert path.
 *
 * Sidebar drops of a course the student already completed (or is taking) are
 * refused — `takenIds` covers the degree audit, and the grid itself covers
 * completed/current cards even when that list is omitted. Failed attempts
 * stay placeable so a retake can land in a later term.
 */
export const placeCourseAt = (
  schedule,
  yearIndex,
  term,
  courseIndex,
  course,
  source = null,
  takenIds = null
) => {
  const next = cloneSchedule(schedule);
  const targetSlot = next[yearIndex]?.[term];
  if (!targetSlot || courseIndex < 0 || courseIndex > targetSlot.length) {
    return schedule;
  }

  const existingCourse = targetSlot[courseIndex];
  const placed = normalizePlacedCourse(course);

  if (source) {
    const { yearIndex: sy, term: st, courseIndex: si } = source;
    if (sy === yearIndex && st === term && si === courseIndex) return schedule;
    if (!next[sy]?.[st] || Number.isNaN(si)) return schedule;
    next[sy][st][si] = existingCourse || null;
    next[sy][st] = tidySlots(next[sy][st]);
    targetSlot[courseIndex] = placed;
    if (!targetSlot.some((c) => c === null)) targetSlot.push(null);
    return next;
  }

  // Sidebar / catalog drop from here down.
  if (takenIds && isTakenCourse(placed.course_id, takenIds)) {
    return schedule;
  }
  if (scheduleHasTakenCourse(schedule, placed.course_id)) {
    return schedule;
  }
  if (quarterHasCourse(schedule, yearIndex, term, placed.course_id)) {
    return schedule;
  }

  targetSlot[courseIndex] = placed;
  if (existingCourse) {
    let free = -1;
    for (let i = courseIndex + 1; i < targetSlot.length; i += 1) {
      if (targetSlot[i] === null) {
        free = i;
        break;
      }
    }
    if (free === -1) targetSlot.push(existingCourse);
    else targetSlot[free] = existingCourse;
  }
  if (!targetSlot.some((c) => c === null)) targetSlot.push(null);
  return next;
};

const emptyTerm = () => [null, null, null];

/** True when the year has no completed / in-progress courses (safe to wipe). */
export const isFutureYear = (year) =>
  TERMS.every((term) =>
    (year?.[term] || []).every(
      (c) => !c || (c.status !== "completed" && c.status !== "current")
    )
  );

export const yearHasPlannedCourses = (year) =>
  TERMS.some((term) =>
    (year?.[term] || []).some(
      (c) => c && c.status !== "completed" && c.status !== "current"
    )
  );

/** Wipe a future year back to empty term slots. No-op if the year isn't future. */
export const clearYear = (schedule, yearIndex) => {
  const year = schedule?.[yearIndex];
  if (!year || !isFutureYear(year)) return schedule;
  const next = cloneSchedule(schedule);
  TERMS.forEach((term) => {
    next[yearIndex][term] = emptyTerm();
  });
  return next;
};

/**
 * Fresh named plan: keep transcript history (completed / in-progress), drop
 * everything the student only planned. Used by "Create new plan" so an
 * already-placed degree audit isn't wiped from prior years.
 */
export const keepTakenCourses = (schedule) => {
  const yearCount = Math.max(4, Array.isArray(schedule) ? schedule.length : 0);
  return Array(yearCount)
    .fill()
    .map((_, yearIndex) => {
      const year = {};
      TERMS.forEach((term) => {
        const kept = (schedule?.[yearIndex]?.[term] || []).filter(
          (c) => c && (c.status === "completed" || c.status === "current")
        );
        year[term] = tidySlots(kept);
      });
      return year;
    });
};

/**
 * Patch fields on a course already in a quarter (e.g. saved section choice).
 * No-op when the course isn't in that quarter.
 */
export const updateCourseInQuarter = (
  schedule,
  yearIndex,
  term,
  courseId,
  patch
) => {
  if (!courseId || !patch || typeof patch !== "object") return schedule;
  const next = cloneSchedule(schedule);
  const slots = next[yearIndex]?.[term];
  if (!slots) return schedule;
  const idx = slots.findIndex((c) => c && c.course_id === courseId);
  if (idx === -1) return schedule;
  slots[idx] = { ...slots[idx], ...patch };
  return next;
};

/**
 * Snapshot of a TSS section package the student picked for a planned course.
 * Stored on the course object so planner auto-save / Supabase keep it.
 */
export const enrollmentFromPackage = (pkg) => {
  if (!pkg) return null;
  const meetings = (pkg.meetings || []).map((m) => ({
    sectionId: m.sectionId || null,
    component: m.component || null,
    days: Array.isArray(m.days) ? [...m.days] : [],
    start: m.start || null,
    end: m.end || null,
    instructor: m.instructor || null,
    location: m.location || null,
    // A section can meet at more than one time (BENG 133 is M 11:00 plus
    // TuTh 9:30). The flat fields above hold only the first, so carry the full
    // list too — otherwise a plan restored while the feed is down draws an
    // incomplete week and misses conflicts against the dropped meetings.
    ...(Array.isArray(m.meetings) && m.meetings.length > 1
      ? {
          meetings: m.meetings.map((n) => ({
            days: Array.isArray(n.days) ? [...n.days] : [],
            start: n.start || null,
            end: n.end || null,
            location: n.location || null,
          })),
        }
      : {}),
  }));
  return {
    packageId: pkg.id,
    instructors: [...(pkg.instructors || [])],
    primarySectionId: pkg.primary?.sectionId || null,
    primaryComponent: pkg.primary?.component || null,
    meetings,
    selectedAt: Date.now(),
  };
};

/**
 * Atomically write enrollment snapshots onto courses in one quarter.
 * `updates` is [{ courseId, enrollment }, ...]. Missing courses are skipped.
 */
export const applyEnrollmentsToQuarter = (
  schedule,
  yearIndex,
  term,
  updates
) => {
  if (!Array.isArray(updates) || !updates.length) return schedule;
  let next = schedule;
  for (const row of updates) {
    const courseId = row?.courseId || row?.course_id;
    const enrollment = row?.enrollment;
    if (!courseId || !enrollment) continue;
    next = updateCourseInQuarter(next, yearIndex, term, courseId, {
      enrollment,
    });
  }
  return next;
};
