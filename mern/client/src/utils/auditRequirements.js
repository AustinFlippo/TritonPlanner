// Degree-audit requirement semantics — the single spec both the sidebar and
// the planner agent implement.
//
// PORTED TO app/audit_requirements.py. The two are kept honest by
// shared/audit-requirement-cases.json, which both test suites load: any
// disagreement fails a test rather than silently giving a student a wrong
// answer. Change one side, change the other, and add a case.
//
// ---------------------------------------------------------------------------
// The model
//
// A subrequirement is a NEEDS amount plus a list of OR-groups (slots). The
// audit writes them like
//
//   NEEDS: 7 Courses
//   [MATH 189] OR [DSC 152], [DSC 100], [DSC 102], [DSC 106],
//   [DSC 140A] OR [CSE 150A]  [DSC 140B] OR [CSE 151A]  [DSC 148] OR [CSE 158]
//
// Seven slots, four offering a choice — and NEEDS is also 7. That equality is
// the tell: when the slot count equals the required course count, every slot
// must be filled ("all"). When it doesn't — Arts lists 81 slots and needs 1 —
// it is a pick-any-N pool ("any").
//
// Getting this wrong in the "all" direction marks a student complete while
// they are missing required courses, so the distinction is load-bearing.

import { parseCredits } from "./courseCredits.js";

/** "all" = every group must be satisfied; "any" = take needAmount from the pool. */
export const requirementMode = (groups, needType, needAmount) => {
  if (needType !== "courses") return "any"; // unit requirements are always pools
  const n = Number(needAmount);
  if (!Number.isFinite(n) || n <= 0) return "any";
  return Array.isArray(groups) && groups.length === n ? "all" : "any";
};

const normalizeCode = (value = "") =>
  String(value)
    .toUpperCase()
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^([A-Z]{2,6})\s*(\d)/, "$1 $2")
    .trim();

/**
 * Maximum bipartite matching between courses and groups.
 *
 * Greedy assignment under-counts when a course appears in several groups: with
 * groups [[A],[A,B]] and courses [A,B], greedy can bind A to the first group,
 * then fail B against it and report 1 of 2 satisfied. Kuhn's algorithm finds
 * the true maximum (2). Sizes here are tiny — at most a handful of groups — so
 * the cost is irrelevant next to being right.
 *
 * @param {string[][]} groups    OR-groups of course codes
 * @param {string[]}   courseIds course codes the student has/plans
 * @param {(courseId: string, code: string) => boolean} matches
 * @returns {{count: number, satisfiedGroups: number[], usedCourses: string[]}}
 */
export const matchGroups = (groups, courseIds, matches) => {
  const groupToCourse = new Array(groups.length).fill(-1);

  const tryAssign = (courseIndex, seen) => {
    for (let g = 0; g < groups.length; g++) {
      if (seen.has(g)) continue;
      const eligible = groups[g].some((code) => matches(courseIds[courseIndex], code));
      if (!eligible) continue;
      seen.add(g);
      if (groupToCourse[g] === -1 || tryAssign(groupToCourse[g], seen)) {
        groupToCourse[g] = courseIndex;
        return true;
      }
    }
    return false;
  };

  let count = 0;
  for (let c = 0; c < courseIds.length; c++) {
    if (tryAssign(c, new Set())) count++;
  }

  const satisfiedGroups = [];
  const usedCourses = [];
  groupToCourse.forEach((courseIndex, g) => {
    if (courseIndex !== -1) {
      satisfiedGroups.push(g);
      usedCourses.push(courseIds[courseIndex]);
    }
  });
  return { count, satisfiedGroups, usedCourses };
};

/**
 * Evaluate one subrequirement against a set of courses.
 *
 * @param {object} requirement {needType, needAmount, groups, mode?}
 * @param {Array}  courses     [{course_id, credits}]
 * @param {(courseId: string, code: string) => boolean} matches
 *        code equality including cross-listing aliases; supplied by the caller
 *        so this module stays free of catalog knowledge
 * @returns {{satisfied, progress, needed, mode, openGroups, matchedCourses}}
 *        openGroups are the unfilled slots ("all" mode) — what the student
 *        still has to choose from, which a flat count can never tell them
 */
export const evaluateSubrequirement = (requirement, courses, matches) => {
  const groups = Array.isArray(requirement.groups) ? requirement.groups : [];
  const needType = requirement.needType === "units" ? "units" : "courses";
  const needed = Number(requirement.needAmount) || (needType === "units" ? 0 : 1);
  const mode = requirement.mode || requirementMode(groups, needType, needed);
  const courseIds = courses.map((c) => c.course_id);

  if (needType === "units") {
    // Pool: any listed course counts toward the unit total.
    const matched = courses.filter((c) =>
      groups.some((group) => group.some((code) => matches(c.course_id, code)))
    );
    // parseCredits, not `Number(c.credits) || 0`: a dash-joined sequence
    // ("4-4-4") is NaN to Number and scored 0 here while the list-less branch
    // in auditProgress scored it 4. One course, two different unit counts
    // depending on which branch happened to evaluate it.
    const progress = matched.reduce((sum, c) => sum + parseCredits(c.credits), 0);
    return {
      satisfied: progress >= needed,
      progress,
      needed,
      mode: "any",
      openGroups: [],
      matchedCourses: matched,
    };
  }

  const { count, satisfiedGroups, usedCourses } = matchGroups(groups, courseIds, matches);
  const matchedCourses = courses.filter((c) => usedCourses.includes(c.course_id));

  if (mode === "all") {
    const openGroups = groups.filter((_, i) => !satisfiedGroups.includes(i));
    return {
      satisfied: openGroups.length === 0 && groups.length > 0,
      progress: count,
      needed: groups.length,
      mode,
      openGroups,
      matchedCourses,
    };
  }

  const progress = Math.min(count, needed);
  return {
    satisfied: progress >= needed,
    progress,
    needed,
    mode,
    openGroups: [],
    matchedCourses: matchedCourses.slice(0, needed),
  };
};

/**
 * Assign courses to EVERY course-type row of ONE audit section at once.
 *
 * Exclusivity is per section: a course fills at most one slot anywhere in the
 * section (see _scope_comment in shared/audit-requirement-cases.json). Deciding
 * that row by row — the first row takes whatever it can, later rows get the
 * leftovers — reports a satisfiable plan as short. With
 *
 *   Electives  NEEDS 1 of [DSC 100, DSC 102, DSC 106]
 *   Core       NEEDS 1 of [DSC 100]
 *
 * a student who has planned DSC 100 and DSC 102 was told "Core: still needed:
 * DSC 100" — a course already on their grid — purely because Electives was
 * listed first and swallowed DSC 100.
 *
 * So the matching runs over course -> (row, slot) across the whole section at
 * once. Slots are one per OR-group in "all" mode (every group must be filled)
 * and `needAmount` interchangeable pool slots in "any" mode (take N from the
 * pool). Maximum bipartite matching (Kuhn's) then finds an assignment that
 * fills as many slots as any assignment can.
 *
 * Stated so nobody assumes more than is here: this maximises FILLED SLOTS, not
 * fully-satisfied rows, and those can differ when rows tie for the same course.
 * Ties break toward the earlier row, which is the old document-order bias, so
 * nothing that used to be reported satisfied stops being reported satisfied.
 *
 * Unit rows are not handled here — they are pools scored by credits, not slots.
 *
 * @param {Array}  requirements course-type rows, each {needAmount, groups, mode}
 * @param {Array}  courses      [{course_id, credits}]
 * @param {(courseId: string, code: string) => boolean} matches
 * @returns {Array} one result per row, same order:
 *          {satisfied, progress, needed, mode, openGroups, matchedCourses}
 */
export const assignSectionCourses = (requirements, courses, matches) => {
  const shapeOf = (requirement) => {
    const groups = Array.isArray(requirement.groups) ? requirement.groups : [];
    const needed = Number(requirement.needAmount) || 1;
    return {
      groups,
      needed,
      mode: requirement.mode || requirementMode(groups, "courses", needed),
    };
  };

  const slots = [];
  requirements.forEach((requirement, rowIndex) => {
    const { groups, needed, mode } = shapeOf(requirement);
    if (mode === "all") {
      groups.forEach((codes, groupIndex) =>
        slots.push({ rowIndex, groupIndex, codes })
      );
      return;
    }
    // Pool row: N interchangeable slots over the flattened option list. Duped
    // codes collapse so "[DSC 100] [DSC 100] [DSC 102], NEEDS 2" can't be
    // filled twice by one DSC 100.
    const pool = [...new Set(groups.flat())];
    for (let i = 0; i < needed; i++) {
      slots.push({ rowIndex, groupIndex: -1, codes: pool });
    }
  });

  const slotToCourse = new Array(slots.length).fill(-1);
  const eligible = (courseIndex, slotIndex) =>
    slots[slotIndex].codes.some((code) =>
      matches(courses[courseIndex].course_id, code)
    );

  const tryAssign = (courseIndex, seen) => {
    for (let s = 0; s < slots.length; s++) {
      if (seen.has(s) || !eligible(courseIndex, s)) continue;
      seen.add(s);
      if (slotToCourse[s] === -1 || tryAssign(slotToCourse[s], seen)) {
        slotToCourse[s] = courseIndex;
        return true;
      }
    }
    return false;
  };

  for (let c = 0; c < courses.length; c++) tryAssign(c, new Set());

  const perRow = requirements.map(() => ({
    matchedCourses: [],
    filledGroups: new Set(),
  }));
  slots.forEach((slot, slotIndex) => {
    const courseIndex = slotToCourse[slotIndex];
    if (courseIndex === -1) return;
    perRow[slot.rowIndex].matchedCourses.push(courses[courseIndex]);
    if (slot.groupIndex >= 0) {
      perRow[slot.rowIndex].filledGroups.add(slot.groupIndex);
    }
  });

  return requirements.map((requirement, rowIndex) => {
    const { groups, needed, mode } = shapeOf(requirement);
    const { matchedCourses, filledGroups } = perRow[rowIndex];
    if (mode === "all") {
      const openGroups = groups.filter((_, i) => !filledGroups.has(i));
      return {
        satisfied: openGroups.length === 0 && groups.length > 0,
        progress: matchedCourses.length,
        needed: groups.length,
        mode,
        openGroups,
        matchedCourses,
      };
    }
    return {
      satisfied: matchedCourses.length >= needed,
      progress: Math.min(matchedCourses.length, needed),
      needed,
      mode,
      openGroups: [],
      matchedCourses,
    };
  });
};

export { normalizeCode };
