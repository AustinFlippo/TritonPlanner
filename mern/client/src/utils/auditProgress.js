import { courseIdVariants } from "./courseIds.js";
import { parseCredits, hasUnknownCredits } from "./courseCredits.js";
import { isWipGrade, isPassingGrade } from "./courseGrades.js";
import {
  attributeCourseList,
  looksLikeCourseCode,
} from "./attributeRequirements.js";
import {
  assignSectionCourses,
  evaluateSubrequirement,
  requirementMode,
} from "./auditRequirements.js";

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

// Catalog cross-listings use ids like "DSC 80/80R" or "AAS/ANSC 185". Resolve
// plain aliases ("DSC 80", "DSC 80R", "ANSC 185") through the cross-listing
// map so sidebar matching agrees with the Python agent's _codes_match.
const codeVariants = (value) => courseIdVariants(value);

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

// Prefer explicit status; if it's missing (common on restored / search-dropped
// cards), infer from grade so past audit courses aren't treated as "planned".
const inferStatus = (course) => {
  if (course.status === "failed") return "failed";
  if (course.status === "completed") return "completed";
  if (course.status === "current" || course.status === "in_progress") {
    return "current";
  }
  if (course.status === "planned") return "planned";
  if (course.grade != null && String(course.grade).trim() !== "") {
    if (isWipGrade(course.grade)) return "current";
    // An F/W/NP/I completes nothing. It must not count as "completed" (which
    // would satisfy the requirement the student actually failed) NOR as
    // "planned" (which would project it as filling that requirement) — so it
    // gets its own status and is skipped by both paths.
    return isPassingGrade(course.grade) ? "completed" : "failed";
  }
  return "planned";
};

const coursesByBestStatus = (schedule = []) => {
  const byCode = new Map();
  // A retake sits on the grid alongside the failed attempt; ranking "failed"
  // lowest means the passing attempt wins for the same course code.
  const rank = { completed: 3, current: 2, planned: 1, failed: 0 };
  for (const year of schedule || []) {
    for (const term of TERMS) {
      for (const course of year?.[term] || []) {
        if (!course?.course_id) continue;
        const key = normalizeCode(course.course_id);
        const normalized = { ...course, status: inferStatus(course) };
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

/**
 * Shape a parsed subrequirement for the shared evaluator.
 *
 * Newer audits carry `groups` (OR-slots), used as-is with their stored mode.
 * Audits parsed before that — saved plans, restored sessions — only have a
 * flat `availableCodes`, whose slot structure is unrecoverable; treating each
 * code as its own group with mode "any" reproduces the old pick-any-N
 * behaviour exactly, so restoring an old plan never changes what the student
 * was previously told. Appending extra codes to parsed groups is forbidden:
 * it grows an "all"-mode requirement, making it demand courses the audit
 * never asked of that row.
 */
const groupsFor = (requirement, availableCodes, parsedGroups) => {
  if (parsedGroups?.length) {
    return {
      needType: requirement.needType,
      needAmount: requirement.needAmount,
      groups: parsedGroups,
      mode:
        requirement.mode ||
        requirementMode(
          parsedGroups,
          requirement.needType,
          requirement.needAmount
        ),
    };
  }
  return {
    needType: requirement.needType,
    needAmount: requirement.needAmount,
    groups: availableCodes.map((code) => [code]),
    mode: "any",
  };
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

// "Minimum of 48 upper division units in the major" is scoped to the major,
// but it enumerates no course list of its own — so a level-only filter counted
// any upper-division course at all, and a plan padded with unrelated electives
// projected the requirement satisfied while the major was still short.
const IN_THE_MAJOR_RE = /\bin the major\b/i;

// A code shaped like a real course, which keeps the audit's credit
// placeholders ("AP **3", "IB MU5") from being mistaken for courses.
// Mirrors _COURSE_CODE_RE in app/planner_agent.py.
const COURSE_CODE_RE = /^[A-Z]{2,6}\s*\d/;

/**
 * Every course code the audit names, WHETHER OR NOT the catalog knows it.
 *
 * Deliberately does not resolve anything against the catalog — its whole
 * purpose is the codes that fail to. A degree audit is an authoritative
 * statement that a course exists and counts toward a requirement, and it is
 * routinely ahead of the General Catalog. Passed to the search endpoint as
 * `vouchedCodes` so a student can find a course their own audit offers them.
 *
 * Mirrors _codes_named_by_audit in app/planner_agent.py — keep the two in
 * sync, since they decide the same question on the two sides of the wire.
 */
export const codesNamedByAudit = (sections = []) => {
  const codes = new Set();
  const add = (value) => {
    const code = normalizeCode(value);
    if (code && COURSE_CODE_RE.test(code)) codes.add(code);
  };
  for (const section of sections || []) {
    for (const sub of section?.subrequirements || []) {
      for (const group of sub.groups || []) for (const code of group) add(code);
      for (const code of sub.availableCodes || []) add(code);
      for (const course of sub.completedCourses || []) add(course?.course_id);
    }
    for (const item of section?.items || []) {
      if (typeof item === "string") for (const c of parseAvailableCodes(item)) add(c);
    }
  }
  return codes;
};

/**
 * Every course code the audit itself names inside the major's requirement
 * rows — the audit's own definition of "counts toward the major". Returns null
 * when nothing can be derived (e.g. every major row is already fulfilled, so
 * the parser recorded no course lists), which makes callers fall back to the
 * level-only filter rather than counting nothing.
 * Mirrored by _major_course_codes in app/planner_agent.py.
 */
export const majorCourseCodes = (sections = []) => {
  const codes = new Set();
  for (const section of sections) {
    if (!/\bmajor\b/i.test(section?.title || "")) continue;
    for (const sub of section.subrequirements || []) {
      for (const group of sub.groups || []) {
        for (const code of group) {
          for (const variant of codeVariants(code)) codes.add(variant);
        }
      }
    }
  }
  return codes.size ? codes : null;
};

const countsTowardMajor = (courseId, majorCodes) =>
  [...codeVariants(courseId)].some((variant) => majorCodes.has(variant));

// Cross-listings expand on BOTH sides: the audit may print "DSC 80/80R" while
// the grid holds "DSC 80R", or the reverse.
const codeMatches = (courseId, code) => {
  const allowed = codeVariants(code);
  return [...codeVariants(courseId)].some((variant) => allowed.has(variant));
};

export const evaluateRequirement = (section, schedule, majorCodes = null) => {
  const planned = plannedCourses(schedule);
  const requirements = requirementsFor(section);
  const matched = new Map();

  // --- Pass 1: classify every row --------------------------------------
  //
  // Rows that need courses from the section's shared pool are only *shaped*
  // here; the actual assignment happens once, across all of them together
  // (pass 2), because deciding row by row hands the earliest row a course a
  // later row is the only claimant for.
  const plans = requirements.map((requirement) => {
    // Fulfilled rows are done. In-progress rows are being satisfied right now
    // by courses the student is already enrolled in — the audit will close
    // them when grades post, so they need no planned course and, critically,
    // must not consume one. An in-progress row that fell through to the
    // matcher below picked up a SIBLING row's planned course (Eighth GE's
    // CCE 120) and then reported that sibling short.
    if (
      requirement.status === "fulfilled" ||
      requirement.status === "in_progress"
    ) {
      return { kind: "settled", result: { ...requirement, projected: true, matchedCourses: [] } };
    }

    // A row the parser could not read a NEEDS off — no needType, or a
    // non-positive amount — states no requirement to meet, even when it does
    // carry an options list. Such a row used to fall through, pick up a
    // default "needs 1", fail, and pin its whole category at 0% forever with
    // nothing on screen to explain why. The Python side skips these rows
    // outright; this marks them informational so they neither block the
    // section nor, on their own, project it.
    if (!requirement.needType || !(Number(requirement.needAmount) > 0)) {
      return {
        kind: "settled",
        result: {
          ...requirement,
          projected: true,
          informational: true,
          matchedCourses: [],
        },
      };
    }

    let availableCodes = requirement.availableCodes || [];
    let parsedGroups =
      Array.isArray(requirement.groups) && requirement.groups.length
        ? requirement.groups
        : null;
    // Attribute-based requirements (JTCCER climate, Eighth GE) print NEEDS
    // with no course list — or with junk parsed from a "see this website"
    // note. Substitute the known approved list ONLY in those cases. When the
    // audit names real courses (Eighth GE's own "CCE 3" / "CCE 120" rows),
    // its list is authoritative: widening it would make one row demand the
    // whole approved sequence and swallow courses meant for sibling rows.
    //
    // Gated on the row actually stating a NEEDS: substitution exists to give
    // an UNMET row something to match against. A row without one never gets
    // here — it was settled as informational above.
    const attributeCodes = attributeCourseList(section.title);
    if (attributeCodes && !availableCodes.some(looksLikeCourseCode)) {
      availableCodes = [...attributeCodes];
      parsedGroups = null; // junk groups die with the junk codes
    }
    if (!availableCodes.length && requirement.needType !== "units") {
      return {
        kind: "settled",
        result: { ...requirement, projected: false, matchedCourses: [] },
      };
    }
    if (!availableCodes.length) {
      return { kind: "levelUnits", requirement };
    }
    return {
      kind: requirement.needType === "units" ? "listedUnits" : "listedCourses",
      requirement,
      availableCodes,
      shaped: groupsFor(requirement, availableCodes, parsedGroups),
    };
  });

  // --- Pass 2: one assignment across all course rows of the section -----
  const courseRows = plans.filter((plan) => plan.kind === "listedCourses");
  const assignments = assignSectionCourses(
    courseRows.map((plan) => plan.shaped),
    planned,
    codeMatches
  );
  courseRows.forEach((plan, index) => {
    plan.assignment = assignments[index];
  });

  // Unit rows listing courses are pools scored by credits, not slots, so they
  // can't join the matching. They take what the course rows left, in document
  // order — the specific "NEEDS 2 Courses" rows have first claim on a course
  // over a catch-all "NEEDS 16 Units" elective pool in the same category.
  const assignedCourseIds = new Set();
  for (const plan of courseRows) {
    for (const course of plan.assignment.matchedCourses) {
      assignedCourseIds.add(normalizeCode(course.course_id));
    }
  }

  const requirementResults = plans.map((plan) => {
    if (plan.kind === "settled") return plan.result;

    const { requirement } = plan;

    if (plan.kind === "levelUnits") {
      // List-less unit requirement: any planned course at the level the
      // title implies counts. Deliberately NOT excluded by assignedCourseIds
      // and not added to it — in a real audit, a course credits both its
      // named requirement and e.g. the 48-upper-division-unit total.
      const level = levelFromTitle(section.title);
      const needed = Number(requirement.needAmount) || 1;
      // Rows scoped "in the major" additionally require the course to appear
      // in the audit's own major course lists; without those lists (all major
      // rows fulfilled) fall back to level-only rather than counting nothing.
      const majorOnly =
        majorCodes &&
        IN_THE_MAJOR_RE.test(`${requirement.title || ""} ${section.title || ""}`);
      const matches = planned.filter(
        (course) =>
          (!level || levelOf(course.course_id) === level) &&
          (!majorOnly || countsTowardMajor(course.course_id, majorCodes))
      );
      const progress = matches.reduce(
        (sum, course) => sum + parseCredits(course.credits),
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

    const result =
      plan.kind === "listedCourses"
        ? plan.assignment
        : evaluateSubrequirement(
            plan.shaped,
            planned.filter(
              (course) => !assignedCourseIds.has(normalizeCode(course.course_id))
            ),
            codeMatches
          );

    result.matchedCourses.forEach((course) => {
      assignedCourseIds.add(normalizeCode(course.course_id));
      matched.set(course.course_id, course);
    });

    // Expose the effective Available list (after attribute substitution) so
    // courseSlotPercent / open-slot counts include JTCCER and similar rows
    // whose audit printed no codes.
    return {
      ...requirement,
      availableCodes: plan.availableCodes,
      projected: result.satisfied,
      progress: result.progress,
      needed: result.needed,
      mode: result.mode,
      openGroups: result.openGroups,
      matchedCourses: result.matchedCourses,
    };
  });

  // Older saved audits flattened taken courses onto section.items and never
  // stored completedCourses on the subrequirement. Re-home orphans onto open
  // NEEDS rows whose Available list includes that course (Arts ← MUS 20R).
  // Fulfilled rows have no Available list in those saves, so they keep the
  // flat fallback until the audit is re-parsed.
  const claimedCompleted = new Set();
  for (const requirement of requirementResults) {
    for (const course of requirement.completedCourses || []) {
      const id = course.course_id || course;
      for (const variant of codeVariants(id)) claimedCompleted.add(variant);
    }
  }
  for (const requirement of requirementResults) {
    if ((requirement.completedCourses || []).length) continue;
    const availableCodes = requirement.availableCodes || [];
    if (!availableCodes.length) continue;
    const recovered = [];
    for (const item of section.items || []) {
      if (typeof item !== "string") continue;
      if (item.includes("NEEDS:") || item.includes("Available:")) continue;
      const match = item.match(/^(.+?)\s+-\s+/);
      if (!match) continue;
      const courseId = match[1].trim();
      if (
        [...codeVariants(courseId)].some((variant) =>
          claimedCompleted.has(variant)
        )
      ) {
        continue;
      }
      if (!courseMatches({ course_id: courseId }, availableCodes)) continue;
      recovered.push({
        course_id: courseId,
        display: item,
      });
      for (const variant of codeVariants(courseId)) {
        claimedCompleted.add(variant);
      }
    }
    if (recovered.length) {
      requirement.completedCourses = recovered;
    }
  }

  const verified = section.status === "fulfilled";
  // Rows that state no requirement (the informational ones settled in pass 1)
  // are neither evidence for nor against the section: a category made only of
  // them — an "Elective Courses" dump — must stay out of the percentages
  // entirely, which isTrackableSection then handles.
  //
  // Every other row counts, INCLUDING the ones already fulfilled or in
  // progress. Requiring a still-open rule to exist before a section could
  // project meant an all-in-progress category scored 0%, and adding one
  // unmet row that the plan covered took the same category to 100% — the
  // section-level answer contradicting the row-level one decided just above.
  const decisive = requirementResults.filter(
    (requirement) => !requirement.informational
  );
  const projected =
    verified ||
    (decisive.length > 0 &&
      decisive.every((requirement) => requirement.projected));

  return {
    verified,
    projected,
    matchedCourses: [...matched.values()],
    requirementResults,
  };
};

const hasOpenNeeds = (progress) =>
  (progress?.requirementResults || []).some(
    (requirement) =>
      requirement.status !== "fulfilled" &&
      requirement.needType &&
      Number(requirement.needAmount) > 0
  );

// "Elective Courses" dumps (status unknown, no NEEDS) are informational —
// leftover transfer/AP lines — not a hurdle that should cap the %.
const isTrackableSection = (section, progress) => {
  if (progress.verified || progress.projected) return true;
  if (hasOpenNeeds(progress)) return true;
  if (section.status === "not_fulfilled" || section.status === "in_progress") {
    return true;
  }
  return false;
};

const categoryCredit = (progress) => {
  if (progress.verified || progress.projected) return 1;

  const openRequirements = (progress.requirementResults || []).filter(
    (requirement) =>
      requirement.status !== "fulfilled" &&
      requirement.needType &&
      Number(requirement.needAmount) > 0
  );
  if (!openRequirements.length) return 0;

  // Score each open row as its own 0..1 fraction, then average. Summing raw
  // needAmounts across rows would add course counts to unit counts: the DS
  // major section opens with 7 Courses + 2 Courses + 16 Units, so a single
  // 16-unit elective row would carry 64% of the section's weight purely
  // because units are numerically bigger than courses. Every row is one
  // requirement, so every row gets one vote.
  const fractions = openRequirements.map((requirement) => {
    const needed = Number(requirement.needAmount) || 1;
    const progress = Number(requirement.progress) || 0;
    return needed > 0 ? Math.min(1, progress / needed) : 0;
  });
  return fractions.reduce((a, b) => a + b, 0) / fractions.length;
};

export const calculateAuditProgress = (
  sections = [],
  schedule = [],
  metadata = {}
) => {
  const majorCodes = majorCourseCodes(sections);
  const sectionProgress = sections.map((section) =>
    evaluateRequirement(section, schedule, majorCodes)
  );
  const trackableIndexes = sections
    .map((section, index) =>
      isTrackableSection(section, sectionProgress[index]) ? index : -1
    )
    .filter((index) => index >= 0);
  const total = trackableIndexes.length;
  const verified = trackableIndexes.filter(
    (index) => sectionProgress[index].verified
  ).length;
  const projected = trackableIndexes.filter(
    (index) => sectionProgress[index].projected
  ).length;
  const planned = plannedCourses(schedule);
  const current = currentCourses(schedule);
  const earnedUnits = Number(metadata.unitsCompleted) || 0;
  const currentUnits = current.reduce(
    (sum, course) => sum + parseCredits(course.credits),
    0
  );
  const plannedUnits = planned.reduce(
    (sum, course) => sum + parseCredits(course.credits),
    0
  );
  // Courses the degree audit vouches for that the catalog has never published
  // (DSC 152 was taught in SP26 and offered as a Core alternative while absent
  // from catalog.ucsd.edu). They carry no unit count, so they contribute 0 to
  // every total above. That understates the plan and overstates what is left,
  // and a silently-wrong number is worse than an openly incomplete one — so
  // count them and let the panel say so out loud.
  const unknownUnitCourses = [...planned, ...current].filter(hasUnknownCredits);
  const openCourseSlots = sectionProgress.reduce(
    (totalSlots, section) =>
      totalSlots +
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
    (totalSlots, section) =>
      totalSlots +
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
  // Category credit for the "with plan" bar:
  //  - fulfilled audit categories count as 1
  //  - categories the plan fully covers count as 1 (including list-less
  //    unit requirements like "48 Upper-Division Units")
  //  - otherwise award a fraction from open NEEDS rows (courses or units)
  const projectedCategoryCredit = trackableIndexes.reduce(
    (sum, index) => sum + categoryCredit(sectionProgress[index]),
    0
  );

  return {
    total,
    verified,
    projected,
    verifiedPercent: total ? Math.round((verified / total) * 100) : 0,
    projectedPercent: total ? Math.round((projected / total) * 100) : 0,
    newlyProjected: Math.max(0, projected - verified),
    // Trackable categories the plan still does not satisfy. Units and
    // requirements are independent: a plan can clear the unit total while
    // leaving Arts, Social Sciences and 4 elective units open, so the headline
    // must not read "0 units left" as if the student were done.
    outstandingSections: Math.max(0, total - projected),
    sectionProgress,
    earnedUnits,
    currentUnits,
    plannedUnits,
    projectedUnits: earnedUnits + currentUnits + plannedUnits,
    // How many planned/in-progress courses carry no unit count, so every
    // number above can be presented as a floor rather than a fact.
    unknownUnitCourses: unknownUnitCourses.length,
    // The audit's own total-units requirement, or null when it didn't state
    // one. Never guess 180: it is right for most UCSD degrees and wrong for
    // the students most in need of an accurate count.
    unitsRequired:
      Number(metadata.unitsRequired) > 0 ? Number(metadata.unitsRequired) : null,
    // "38 units left · about 3 quarters" is the number a student actually
    // plans against. A category percentage answers a different question and
    // reads alarmingly low beside it (33% of categories vs 72% of units).
    // null when the audit didn't state a total — never guess 180.
    unitsRemaining: Number(metadata.unitsRequired) > 0
      ? Math.max(
          0,
          Number(metadata.unitsRequired) - earnedUnits - currentUnits - plannedUnits
        )
      : null,
    openCourseSlots,
    coveredCourseSlots,
    courseSlotPercent: openCourseSlots
      ? Math.round((coveredCourseSlots / openCourseSlots) * 100)
      : null,
    // No planned courses ⇒ "with plan" must match audit-completed %.
    // Otherwise past grid courses mislabeled as planned can nudge 30% → 31%.
    withPlanPercent: total
      ? planned.length === 0
        ? Math.round((verified / total) * 100)
        : Math.max(
            Math.round((verified / total) * 100),
            Math.round((projectedCategoryCredit / total) * 100)
          )
      : 0,
  };
};
