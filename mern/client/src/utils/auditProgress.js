import { aliasesFor } from "./courseIds.js";

const TERMS = ["fall", "winter", "spring"];
const NEEDS_RE =
  /NEEDS:\s*([\d.]+)\s*(?:(?:more\s+)?(Courses?|Units?))/i;
const AVAILABLE_RE = /Available:\s*(.+)$/i;

const normalizeCode = (value = "") =>
  String(value)
    .toUpperCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^([A-Z]{2,6})\s*(\d)/, "$1 $2")
    .trim();

// Catalog cross-listings use ids like "DSC 80/80R" or "AAS/ANSC 185". Treat
// every alias as a valid audit token without changing the course's display ID.
const codeVariants = (value) => {
  const code = normalizeCode(value);
  const variants = new Set();
  for (const alias of aliasesFor(code)) variants.add(normalizeCode(alias));
  return variants;
};

const parseAvailableCodes = (text = "") => {
  const match = text.match(AVAILABLE_RE);
  if (!match) return [];
  let lastSubject = "";
  return match[1]
    .split(/\s*(?:,|;|\bor\b)\s*/i)
    .map((raw) => {
      const code = normalizeCode(raw);
      const full = code.match(/^([A-Z]{2,6})\s+(.+)$/);
      if (full) {
        lastSubject = full[1];
        return code;
      }
      // Degree-audit lists often abbreviate "DSC 100, 102, 106".
      return lastSubject && /^\d/.test(code) ? `${lastSubject} ${code}` : code;
    })
    .filter(Boolean);
};

const legacySubrequirements = (section) => {
  const requirements = [];
  for (const item of section.items || []) {
    if (typeof item !== "string") continue;
    const needs = item.match(NEEDS_RE);
    const availableCodes = parseAvailableCodes(item);

    if (needs) {
      requirements.push({
        status: "not_fulfilled",
        needType: needs?.[2]?.toLowerCase().startsWith("unit")
          ? "units"
          : "courses",
        needAmount: needs ? Number(needs[1]) : 1,
        availableCodes,
      });
      continue;
    }

    if (availableCodes.length) {
      // Older saved audits put NEEDS and Available in separate adjacent items.
      const previous = requirements[requirements.length - 1];
      if (previous && previous.availableCodes.length === 0) {
        previous.availableCodes = availableCodes;
      } else {
        requirements.push({
          status: "not_fulfilled",
          needType: "courses",
          needAmount: 1,
          availableCodes,
        });
      }
    }
  }
  return requirements;
};

const requirementsFor = (section) =>
  section.subrequirements?.length
    ? section.subrequirements
    : legacySubrequirements(section);

const coursesByBestStatus = (schedule = []) => {
  const byCode = new Map();
  const rank = { completed: 3, current: 2, planned: 1 };
  for (const year of schedule || []) {
    for (const term of TERMS) {
      for (const course of year?.[term] || []) {
        if (!course?.course_id) continue;
        const key = normalizeCode(course.course_id);
        const normalizedStatus =
          course.status === "completed"
            ? "completed"
            : course.status === "current" || course.status === "in_progress"
              ? "current"
              : "planned";
        const normalized = { ...course, status: normalizedStatus };
        const existing = byCode.get(key);
        if (
          !existing ||
          rank[normalized.status] > rank[existing.status]
        ) {
          byCode.set(key, normalized);
        }
      }
    }
  }
  return [...byCode.values()];
};

const plannedCourses = (schedule = []) =>
  coursesByBestStatus(schedule).filter((course) => course.status === "planned");

const currentCourses = (schedule = []) =>
  coursesByBestStatus(schedule).filter((course) => course.status === "current");

const courseMatches = (course, availableCodes) => {
  const allowed = new Set(
    availableCodes.flatMap((code) => [...codeVariants(code)])
  );
  return [...codeVariants(course.course_id)].some((code) => allowed.has(code));
};

// UCSD numbering: 1-99 lower-division, 100-199 upper, 200+ grad.
const levelOf = (courseId) => {
  const m = String(courseId || "").match(/(\d+)/);
  if (!m) return "upper";
  const n = parseInt(m[1], 10);
  if (n < 100) return "lower";
  if (n < 200) return "upper";
  return "grad";
};

// "48 Upper Division Unit Requirement" enumerates no course list — which
// courses qualify is implied by the title. Mirrored in app/planner_agent.py.
const levelFromTitle = (title = "") => {
  if (/upper[\s-]*div/i.test(title)) return "upper";
  if (/lower[\s-]*div/i.test(title)) return "lower";
  return null;
};

export const evaluateRequirement = (section, schedule) => {
  const planned = plannedCourses(schedule);
  const requirements = requirementsFor(section);
  const matched = new Map();
  const assignedCourseIds = new Set();
  let hasProjectableRule = false;

  const requirementResults = requirements.map((requirement) => {
    if (requirement.status === "fulfilled") {
      return { ...requirement, projected: true, matchedCourses: [] };
    }

    const availableCodes = requirement.availableCodes || [];
    if (!availableCodes.length) {
      if (requirement.needType !== "units") {
        return { ...requirement, projected: false, matchedCourses: [] };
      }
      // List-less unit requirement: any planned course at the level the
      // title implies counts. Deliberately NOT excluded by assignedCourseIds
      // and not added to it — in a real audit, a course credits both its
      // named requirement and e.g. the 48-upper-division-unit total.
      hasProjectableRule = true;
      const level = levelFromTitle(section.title);
      const needed = Number(requirement.needAmount) || 1;
      const matches = planned.filter(
        (course) => !level || levelOf(course.course_id) === level
      );
      const progress = matches.reduce(
        (sum, course) => sum + (Number(course.credits) || 0),
        0
      );
      matches.forEach((course) => matched.set(course.course_id, course));
      return {
        ...requirement,
        projected: progress >= needed,
        progress,
        matchedCourses: matches,
      };
    }
    hasProjectableRule = true;

    // A single planned course cannot fill two NEEDS rows in one category.
    const candidates = planned.filter(
      (course) =>
        !assignedCourseIds.has(normalizeCode(course.course_id)) &&
        courseMatches(course, availableCodes)
    );
    const needed = Number(requirement.needAmount) || 1;
    const matches = [];
    let progress = 0;
    for (const course of candidates) {
      if (progress >= needed) break;
      matches.push(course);
      progress +=
        requirement.needType === "units"
          ? Number(course.credits) || 0
          : 1;
    }
    matches.forEach((course) =>
      assignedCourseIds.add(normalizeCode(course.course_id))
    );
    matches.forEach((course) => matched.set(course.course_id, course));

    return {
      ...requirement,
      projected: progress >= needed,
      progress,
      matchedCourses: matches,
    };
  });

  const verified = section.status === "fulfilled";
  const projected =
    verified ||
    (hasProjectableRule &&
      requirementResults.length > 0 &&
      requirementResults.every((requirement) => requirement.projected));

  return {
    verified,
    projected,
    matchedCourses: [...matched.values()],
    requirementResults,
  };
};

export const calculateAuditProgress = (
  sections = [],
  schedule = [],
  metadata = {}
) => {
  const sectionProgress = sections.map((section) =>
    evaluateRequirement(section, schedule)
  );
  const total = sections.length;
  const verified = sectionProgress.filter((item) => item.verified).length;
  const projected = sectionProgress.filter((item) => item.projected).length;
  const planned = plannedCourses(schedule);
  const current = currentCourses(schedule);
  const earnedUnits = Number(metadata.unitsCompleted) || 0;
  const currentUnits = current.reduce(
    (sum, course) => sum + (Number(course.credits) || 0),
    0
  );
  const plannedUnits = planned.reduce(
    (sum, course) => sum + (Number(course.credits) || 0),
    0
  );
  const openCourseSlots = sectionProgress.reduce(
    (total, section) =>
      total +
      section.requirementResults.reduce(
        (sum, requirement) =>
          requirement.status !== "fulfilled" &&
          requirement.needType === "courses" &&
          requirement.availableCodes?.length
            ? sum + (Number(requirement.needAmount) || 1)
            : sum,
        0
      ),
    0
  );
  const coveredCourseSlots = sectionProgress.reduce(
    (total, section) =>
      total +
      section.requirementResults.reduce(
        (sum, requirement) =>
          requirement.status !== "fulfilled" &&
          requirement.needType === "courses" &&
          requirement.availableCodes?.length
            ? sum +
              Math.min(
                Number(requirement.needAmount) || 1,
                Number(requirement.progress) || 0
              )
            : sum,
        0
      ),
    0
  );
  const projectedCategoryCredit = sectionProgress.reduce((sum, section) => {
    if (section.verified) return sum + 1;

    const courseRequirements = section.requirementResults.filter(
      (requirement) =>
        requirement.status !== "fulfilled" &&
        requirement.needType === "courses" &&
        requirement.availableCodes?.length
    );
    if (!courseRequirements.length) return sum;

    const needed = courseRequirements.reduce(
      (total, requirement) =>
        total + (Number(requirement.needAmount) || 1),
      0
    );
    const covered = courseRequirements.reduce(
      (total, requirement) =>
        total +
        Math.min(
          Number(requirement.needAmount) || 1,
          Number(requirement.progress) || 0
        ),
      0
    );
    return sum + covered / needed;
  }, 0);

  return {
    total,
    verified,
    projected,
    verifiedPercent: total ? Math.round((verified / total) * 100) : 0,
    projectedPercent: total ? Math.round((projected / total) * 100) : 0,
    newlyProjected: Math.max(0, projected - verified),
    sectionProgress,
    earnedUnits,
    currentUnits,
    plannedUnits,
    projectedUnits: earnedUnits + currentUnits + plannedUnits,
    openCourseSlots,
    coveredCourseSlots,
    courseSlotPercent: openCourseSlots
      ? Math.round((coveredCourseSlots / openCourseSlots) * 100)
      : null,
    withPlanPercent: total
      ? Math.max(
          Math.round((verified / total) * 100),
          Math.round((projectedCategoryCredit / total) * 100)
        )
      : 0,
  };
};
