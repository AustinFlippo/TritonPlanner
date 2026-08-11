// Turns parsed degree-audit sections into recommendation inputs.
//
// Audit sections (from SidebarAuditTracker / auditParser) look like:
//   { title, status, items: [
//       "CSE 100 - ADV DATA STRUCTURES (FA23, A)",          // taken
//       "NEEDS: 2 Courses | Available: DSC 100, DSC 102",   // unmet
//       "NEEDS: 16.00 Units",
//       "Available: MATH 189, COGS 108",
//   ]}

import {
  attributeCourseList,
  looksLikeCourseCode,
} from "./attributeRequirements.js";
import { isNonPassingGrade } from "./courseGrades.js";

export const AUDIT_REQUIREMENT_DRAG_TYPE =
  "application/x-triton-audit-requirement";

// The gap is 0-3 spaces, not 0-1: a real degree audit renders the course
// column at a fixed width and emits "COGS  9", "DSC  10", "CCE   1". With \s?
// those lines never matched, so extractTakenCourses returned a transcript
// missing most of the student's courses and the recommender happily suggested
// classes they had already passed. Mirrored by _COURSE_CODE_RE in app/catalog.py.
const COURSE_LINE_RE = /^([A-Z]{2,6}[ \t]{0,3}\d+[A-Z]{0,3})\s+-\s/;
const NEEDS_RE = /NEEDS:\s*([^|]+?)\s*(?:\|\s*Available:\s*(.+))?$/;
const AVAILABLE_RE = /^Available:\s*(.+)$/;

/**
 * Requirements still missing courses, with the audit's suggested course
 * tokens. Sections without an "Available" list still appear (codes: [])
 * so the UI can say the requirement is unmet even without suggestions.
 */
export function extractUnmetRequirements(sections = []) {
  const unmet = [];
  for (const section of sections) {
    if (section.status !== "not_fulfilled") continue;

    // One entry PER unmet subrequirement when the audit gives us that
    // structure. Rolling a section up produced headers like "Needs 7 Courses ·
    // 75 options" for a section that actually wants 7 Core courses AND a
    // 2-course senior project AND 16 elective units — the count belonged to
    // one row and the options were three unrelated lists merged together.
    const subs = (section.subrequirements || []).filter(
      (sub) => sub.status !== "fulfilled" && (sub.groups?.length || sub.availableCodes?.length)
    );
    if (subs.length) {
      let emitted = false;
      for (const sub of subs) {
        const subCodes = (sub.groups?.flat() || sub.availableCodes || []).filter(
          looksLikeCourseCode
        );
        if (!subCodes.length) continue;
        const amount = Number(sub.needAmount) || 1;
        const unit = sub.needType === "units" ? "Units" : "Course";
        unmet.push({
          title: sub.title ? `${section.title} — ${sub.title}` : section.title,
          sectionTitle: section.title,
          subTitle: sub.title || null,
          needs: `${amount} ${unit}${unit === "Course" && amount !== 1 ? "s" : ""}`,
          mode: sub.mode || "any",
          codes: [...new Set(subCodes)],
        });
        emitted = true;
      }
      // Only fall through to the section-level parse when no subrequirement
      // yielded anything usable (older audits, attribute-based sections).
      if (emitted) continue;
    }

    let needs = null;
    const codes = [];
    for (const item of section.items || []) {
      const needsMatch = item.match(NEEDS_RE);
      if (needsMatch) {
        needs = needs || needsMatch[1].trim();
        if (needsMatch[2]) {
          codes.push(...needsMatch[2].split(",").map((c) => c.trim()));
        }
        continue;
      }
      const availMatch = item.match(AVAILABLE_RE);
      if (availMatch) {
        codes.push(...availMatch[1].split(",").map((c) => c.trim()));
      }
    }
    // Attribute-based requirements (JTCCER climate, Eighth GE) print no
    // Available list — or junk from a "see this website" note. Substitute
    // the known approved list only then; when the audit names the exact
    // remaining courses (e.g. Eighth GE's "CCE 3"), suggest those, not the
    // whole sequence.
    const attributeCodes = attributeCourseList(section.title);
    const realCodes = codes.filter(looksLikeCourseCode);
    const suggested = realCodes.length ? realCodes : attributeCodes || [];
    unmet.push({
      title: section.title,
      needs,
      codes: [...new Set(suggested)],
    });
  }
  return unmet;
}

/**
 * Courses the student has already finished or is currently taking — the set
 * requirement search / recommendations should hide. Planned grid placements
 * stay visible so dragging "Core" still lists options that are already on
 * the four-year plan.
 */
export function extractCompletedCourses(sections = [], schedule = null) {
  const completed = new Set();
  // Only a passing (or in-progress) grade hides a course from the options
  // list. This used to add every course-shaped line regardless of grade, so a
  // course the student FAILED disappeared from requirement search — removing
  // the one course they most needed to find in order to retake it.
  const addIfNotFailed = (courseId, grade) => {
    if (!courseId) return;
    if (grade !== undefined && isNonPassingGrade(grade)) return;
    completed.add(String(courseId).replace(/\s+/g, " ").trim());
  };
  for (const section of sections) {
    for (const item of section.items || []) {
      const m = item.match(COURSE_LINE_RE);
      if (!m) continue;
      // "CSE 21 - Math for Algorithms (FA23, A-)" — grade last inside the
      // trailing parenthetical. Mirrors _TRAILING_GRADE_RE in planner_agent.py.
      const g = item.match(/\(([^,()]*),\s*([A-Za-z]{1,3}[+-]?)\s*\)\s*$/);
      addIfNotFailed(m[1], g ? g[2] : undefined);
    }
    for (const course of section.completedCourses || []) {
      addIfNotFailed(course?.course_id, course?.grade);
    }
    for (const sub of section.subrequirements || []) {
      for (const course of sub.completedCourses || []) {
        addIfNotFailed(course?.course_id, course?.grade);
      }
    }
  }
  if (Array.isArray(schedule)) {
    for (const year of schedule) {
      for (const term of ["fall", "winter", "spring"]) {
        for (const c of year?.[term] || []) {
          if (
            c?.course_id &&
            (c.status === "completed" || c.status === "current")
          ) {
            completed.add(c.course_id);
          }
        }
      }
    }
  }
  return [...completed];
}

/**
 * Every course the student has taken, is taking, or has placed in the
 * planner grid — counts toward prerequisite satisfaction for ranking.
 */
export function extractTakenCourses(sections = [], schedule = null) {
  const taken = new Set(extractCompletedCourses(sections, schedule));
  if (Array.isArray(schedule)) {
    for (const year of schedule) {
      for (const term of ["fall", "winter", "spring"]) {
        for (const c of year?.[term] || []) {
          if (c?.course_id) taken.add(c.course_id);
        }
      }
    }
  }
  return [...taken];
}

// Put immediately actionable options first while preserving the audit's order
// within each group. Unknown prerequisite data ranks between ready and blocked.
//
// One course, one card. A requirement can name the same course under two codes
// ("DSC 80" and "DSC 80R"), and the server now answers per token — it no
// longer suppresses a course globally, because doing so emptied whole
// requirements — so the last defence against a duplicate card, and a duplicate
// React key, is here.
export function rankRecommendedCourses(courses = []) {
  const rank = (item) =>
    item?.prereqs_met === true ? 0 : item?.prereqs_met === false ? 2 : 1;
  const seen = new Set();
  return courses
    .filter((item) => {
      const id = item?.course?.course_id;
      if (!id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => item);
}
