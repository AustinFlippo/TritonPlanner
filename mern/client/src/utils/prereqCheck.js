// Planner-grid prerequisite timing: is each OR-group satisfied by a course
// that sits strictly earlier (or, for catalog corequisites, the same quarter)?
//
// Mirrors app/planner_agent.py _prereq_satisfied / _prereq_groups. The server
// CheckPlan path is still the source of truth for the assistant; this is the
// client twin so a card can flag a gap without a chat turn. Keep the two in
// sync: same-term is not enough unless concurrent_allowed names that member,
// failed attempts do not count, and cross-listing aliases match.

import { courseIdVariants, namesSameCourse } from "./courseIds.js";

export const PREREQ_TERMS = ["fall", "winter", "spring"];

export function termSortKey(yearIndex, term) {
  const t = PREREQ_TERMS.indexOf(term);
  return yearIndex * 3 + (t < 0 ? 0 : t);
}

/**
 * variant -> earliest sort key. extraSatisfiedIds (audit completed, AP /
 * transfer) sit at -1, before every grid term. Grid courses then fill in
 * with setdefault semantics so an audit-completed copy of a later card
 * still counts as already done. Failed attempts are skipped.
 */
export function prereqPositions(schedule, extraSatisfiedIds = []) {
  const position = new Map();

  const add = (courseId, key) => {
    if (!courseId) return;
    for (const variant of courseIdVariants(courseId)) {
      if (!position.has(variant) || position.get(variant) > key) {
        position.set(variant, key);
      }
    }
  };

  for (const id of extraSatisfiedIds) add(id, -1);

  if (!Array.isArray(schedule)) return position;
  schedule.forEach((year, yearIndex) => {
    for (const term of PREREQ_TERMS) {
      const key = termSortKey(yearIndex, term);
      for (const course of year?.[term] || []) {
        if (!course?.course_id || course.status === "failed") continue;
        add(course.course_id, key);
      }
    }
  });
  return position;
}

function positionOf(member, position) {
  for (const variant of courseIdVariants(member)) {
    if (position.has(variant)) return position.get(variant);
  }
  return null;
}

function isConcurrent(member, concurrentIds) {
  return (concurrentIds || []).some((id) => namesSameCourse(member, id));
}

/**
 * Unsatisfied OR-groups for `courseId` sitting at (yearIndex, term).
 *
 * Returns null when we cannot tell (no graph / unknown course) — callers
 * stay silent. Returns [] when every group is met, or the course has no
 * course-shaped prerequisites. Otherwise [{ opts, concurrent }].
 */
export function unsatisfiedPrereqGroups(
  courseId,
  yearIndex,
  term,
  graph,
  position
) {
  if (!courseId || !graph?.known) return null;
  const requires = graph.requires || [];
  if (!requires.length) return [];

  const key = termSortKey(yearIndex, term);
  const concurrentIds = graph.concurrent_allowed || [];
  const missing = [];

  for (const group of requires) {
    const members = (group || []).filter(
      (member) => member && !namesSameCourse(member, courseId)
    );
    if (!members.length) continue;

    const ok = members.some((member) => {
      const at = positionOf(member, position);
      if (at == null) return false;
      return at < key || (isConcurrent(member, concurrentIds) && at <= key);
    });
    if (!ok) {
      missing.push({
        opts: members.join(" or "),
        concurrent: members.some((member) =>
          isConcurrent(member, concurrentIds)
        ),
      });
    }
  }
  return missing;
}

export function prereqWarningMessage(courseId, missing) {
  if (!missing?.length) return null;
  const bits = missing.map((group) => {
    const when = group.concurrent
      ? "in the same quarter or earlier"
      : "in an earlier quarter";
    return `${group.opts} ${when}`;
  });
  return `${courseId} needs ${bits.join("; ")}.`;
}

/**
 * Warning object for a planned card, or null. Completed / in-progress
 * courses are history — they are not flagged even if the graph disagrees.
 */
export function prereqWarningFor(course, yearIndex, term, graph, position) {
  if (!course?.course_id) return null;
  if (course.status === "completed" || course.status === "current") return null;
  const missing = unsatisfiedPrereqGroups(
    course.course_id,
    yearIndex,
    term,
    graph,
    position
  );
  if (!missing?.length) return null;
  const hedge =
    graph?.confidence === "partial" ? " Prereq parsing was partial — verify." : "";
  return {
    type: "prereq",
    message: `${prereqWarningMessage(course.course_id, missing)}${hedge}`,
    missing,
  };
}
