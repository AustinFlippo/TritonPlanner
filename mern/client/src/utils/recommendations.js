// Turns parsed degree-audit sections into recommendation inputs.
//
// Audit sections (from SidebarAuditTracker / auditParser) look like:
//   { title, status, items: [
//       "CSE 100 - ADV DATA STRUCTURES (FA23, A)",          // taken
//       "NEEDS: 2 Courses | Available: DSC 100, DSC 102",   // unmet
//       "NEEDS: 16.00 Units",
//       "Available: MATH 189, COGS 108",
//   ]}

const COURSE_LINE_RE = /^([A-Z]{2,6}\s?\d+[A-Z]{0,3})\s+-\s/;
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
    unmet.push({
      title: section.title,
      needs,
      codes: [...new Set(codes.filter(Boolean))],
    });
  }
  return unmet;
}

/**
 * Every course the student has taken, is taking, or has placed in the
 * planner grid — the set recommendations should exclude and that counts
 * toward prerequisite satisfaction.
 */
export function extractTakenCourses(sections = [], schedule = null) {
  const taken = new Set();
  for (const section of sections) {
    for (const item of section.items || []) {
      const m = item.match(COURSE_LINE_RE);
      if (m) taken.add(m[1].replace(/\s+/g, " ").trim());
    }
  }
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
