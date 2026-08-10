// Pure schedule-grid operations shared by views that edit the plan.
// Slot semantics mirror the planner: each term keeps at least 2 slots and
// always ends with one empty slot ready to receive a drop.

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

export const quarterHasCourse = (schedule, yearIndex, term, courseId) =>
  (schedule?.[yearIndex]?.[term] || []).some(
    (c) => c && c.course_id === courseId
  );

// Remove the course at a slot, trimming excess empty slots
export const removeCourseAt = (schedule, yearIndex, term, courseIndex) => {
  const next = cloneSchedule(schedule);
  next[yearIndex][term][courseIndex] = null;
  next[yearIndex][term] = tidySlots(next[yearIndex][term]);
  return next;
};

// Add a course to a quarter: first empty slot, keeping a trailing empty one
export const insertCourse = (schedule, yearIndex, term, course) => {
  const next = cloneSchedule(schedule);
  const slots = next[yearIndex][term];
  const empty = slots.findIndex((c) => c === null);
  if (empty === -1) slots.push(course);
  else slots[empty] = course;
  if (!slots.some((c) => c === null)) slots.push(null);
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
