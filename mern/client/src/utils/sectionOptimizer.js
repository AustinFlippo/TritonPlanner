// Build enrollable package options for the chat agent and validate the
// agent's chosen section packages. The agent picks packages from natural-
// language priorities; this module only exposes options and checks hard facts
// (valid ids, term match, time conflicts).

import { enrollmentFromPackage } from "./scheduleOps.js";
import {
  blocksOf,
  blocksOverlap,
  packageMatchesId,
  packagesClash,
  packagesFor,
  sectionsForCourse,
} from "./sectionPackages.js";
import { compactCourseId } from "./seatAvailability.js";

const DAY_LABELS = { M: "Mon", T: "Tue", W: "Wed", R: "Thu", F: "Fri", S: "Sat" };

/** Compact meeting rows safe to send to the planner agent. */
function compactMeeting(m) {
  return {
    sectionId: m.sectionId || null,
    component: m.component || null,
    days: Array.isArray(m.days) ? [...m.days] : [],
    start: m.start || null,
    end: m.end || null,
    // Every weekly slot, when the section has more than one. Without this the
    // agent reasons about (and explains) a schedule the student does not have.
    meetings: Array.isArray(m.meetings) && m.meetings.length > 1
      ? m.meetings.map((slot) => ({
          days: Array.isArray(slot.days) ? [...slot.days] : [],
          start: slot.start || null,
          end: slot.end || null,
          location: slot.location || null,
        }))
      : undefined,
    instructor: m.instructor || null,
    location: m.location || null,
    seatsAvailable: Number.isFinite(m.seatsAvailable) ? m.seatsAvailable : null,
    status: m.status || null,
  };
}

/** Compact package row for the agent (includes blocks for conflict checks). */
export function compactPackage(pkg, { currentlySelected = false } = {}) {
  if (!pkg) return null;
  return {
    packageId: pkg.id,
    currentlySelected: Boolean(currentlySelected),
    status: pkg.status || null,
    // Bundle seats: enrolling needs a seat in every section of the package, so
    // this is the minimum across them, not the lecture's roomier number.
    seatsAvailable: Number.isFinite(pkg.seatsAvailable) ? pkg.seatsAvailable : null,
    seatsTotal: Number.isFinite(pkg.seatsTotal) ? pkg.seatsTotal : null,
    seatsLimitedBy: pkg.seatsLimitedBy
      ? pkg.seatsLimitedBy.component || pkg.seatsLimitedBy.sectionId || null
      : null,
    instructors: [...(pkg.instructors || [])],
    primarySectionId: pkg.primary?.sectionId || null,
    primaryComponent: pkg.primary?.component || null,
    meetings: (pkg.meetings || []).map(compactMeeting),
    blocks: (pkg.blocks || []).map((b) => ({
      day: b.day,
      startMin: b.startMin,
      endMin: b.endMin,
    })),
  };
}

/**
 * Package shown on Quarter View for a course — same rule as WeekSchedule:
 * saved enrollment packageId if it still exists, else the best-ranked default.
 * When the saved id is missing from live TSS but enrollment.meetings remain,
 * synthesize that snapshot so conflict checks still match the UI.
 *
 * @returns {{ pkg: object, source: "saved"|"default"|"snapshot"|"none" }}
 */
export function displayedPackageFor(course, packages = []) {
  const savedId = course?.enrollment?.packageId || null;
  if (savedId) {
    // Alias-aware: packagesFor collapses the several ids UCSD gives one bundle,
    // so a plan saved under a collapsed id must still resolve.
    const match = packages.find((p) => packageMatchesId(p, savedId));
    if (match) return { pkg: match, source: "saved" };
  }

  const meetings = course?.enrollment?.meetings;
  if (savedId && Array.isArray(meetings) && meetings.length) {
    const timed = meetings.filter((m) => m?.days?.length && m.start);
    if (timed.length) {
      return {
        pkg: {
          id: savedId,
          meetings: timed,
          primary: timed.find((m) => /^(LE|SE)$/i.test(m.component || "")) || timed[0],
          status: null,
          seatsAvailable: null,
          seatsTotal: null,
          instructors: [
            ...new Set(
              [
                ...(course.enrollment.instructors || []),
                ...timed.map((m) => m.instructor),
              ].filter(Boolean)
            ),
          ],
          blocks: timed.flatMap(blocksOf),
        },
        source: "snapshot",
      };
    }
  }

  // Mirror WeekSchedule: before a pick, the grid still draws packages[0].
  if (packages.length) return { pkg: packages[0], source: "default" };
  return { pkg: null, source: "none" };
}

/**
 * Build the section-options payload the browser sends after LoadSectionOptions.
 *
 * @param {{
 *   courses: object[],
 *   sectionsByCourse: object,
 *   year: string|number,
 *   term: string,
 *   termLabel?: string,
 *   source?: string|null,
 *   live?: boolean,
 *   refreshedAt?: number|null,
 * }} args
 */
export function buildSectionOptions({
  courses,
  sectionsByCourse,
  year,
  term,
  termLabel = null,
  source = null,
  live = false,
  refreshedAt = null,
} = {}) {
  const courseOptions = [];
  for (const course of courses || []) {
    const courseId = course?.course_id || course?.courseId;
    if (!courseId) continue;
    const { sections, verified } = sectionsForCourse(
      course,
      sectionsByCourse,
      year,
      term
    );
    let packages = verified ? packagesFor(sections) : [];
    const savedId = course.enrollment?.packageId || null;
    const { pkg: displayed, source: selectionSource } = displayedPackageFor(
      course,
      packages
    );

    // Keep a snapshot-only package in the menu so the agent can see / keep it.
    if (
      displayed &&
      selectionSource === "snapshot" &&
      !packages.some((p) => packageMatchesId(p, displayed.id))
    ) {
      packages = [displayed, ...packages];
    }

    const displayedId = displayed?.id || null;
    courseOptions.push({
      courseId,
      courseName: course.course_name || course.courseName || null,
      credits: Number(course.credits) || 0,
      // What Quarter View is actually drawing (saved, snapshot, or default).
      currentPackageId: displayedId,
      savedPackageId: savedId,
      selectionSource,
      offered: packages.length > 0 || Boolean(displayed),
      verified,
      packages: packages.map((pkg) =>
        compactPackage(pkg, { currentlySelected: pkg.id === displayedId })
      ),
    });
  }

  return {
    year: year != null ? String(year) : null,
    term: term || null,
    termLabel: termLabel || null,
    source: source || null,
    live: Boolean(live),
    refreshedAt: refreshedAt || null,
    courses: courseOptions,
  };
}

/** Human-readable conflict pairs for a set of selected packages. */
export function conflictPairsForSelection(selections) {
  const conflicts = [];
  for (let i = 0; i < selections.length; i++) {
    for (let j = i + 1; j < selections.length; j++) {
      const a = selections[i];
      const b = selections[j];
      if (!a?.pkg || !b?.pkg) continue;
      if (!packagesClash(a.pkg, b.pkg)) continue;
      // Find a day label for the message
      let day = null;
      for (const x of a.pkg.blocks || []) {
        for (const y of b.pkg.blocks || []) {
          if (blocksOverlap(x, y)) {
            day = DAY_LABELS[x.day] || x.day;
            break;
          }
        }
        if (day) break;
      }
      conflicts.push(
        `${a.courseId} × ${b.courseId}${day ? ` (${day})` : ""}`
      );
    }
  }
  return conflicts;
}

function packageLookup(optionsByCourse, courseId, packageId) {
  const entry = optionsByCourse.get(compactCourseId(courseId));
  if (!entry) return null;
  return (
    (entry.packages || []).find((p) => p.packageId === packageId) || null
  );
}

/**
 * Validate an agent draft: each course gets at most one known package, and
 * packages do not time-conflict when requireNoConflicts is true (default).
 *
 * @param {object} sectionOptions - from buildSectionOptions
 * @param {{ courseId: string, packageId: string }[]} selections
 * @param {{ requireNoConflicts?: boolean }} opts
 */
export function validateSectionSelection(
  sectionOptions,
  selections,
  { requireNoConflicts = true } = {}
) {
  const issues = [];
  const optionsByCourse = new Map();
  for (const course of sectionOptions?.courses || []) {
    optionsByCourse.set(compactCourseId(course.courseId), course);
  }

  const resolved = [];
  const seenCourses = new Set();

  for (const raw of selections || []) {
    const courseId = String(raw?.courseId || "").trim();
    const packageId = String(raw?.packageId || "").trim();
    if (!courseId || !packageId) {
      issues.push({
        severity: "error",
        message: "Each selection needs courseId and packageId.",
      });
      continue;
    }
    const key = compactCourseId(courseId);
    if (seenCourses.has(key)) {
      issues.push({
        severity: "error",
        message: `${courseId}: multiple packages selected; pick at most one.`,
      });
      continue;
    }
    seenCourses.add(key);

    const courseOpt = optionsByCourse.get(key);
    if (!courseOpt) {
      issues.push({
        severity: "error",
        message: `${courseId}: not in the loaded section options for this term.`,
      });
      continue;
    }
    if (!courseOpt.offered || !(courseOpt.packages || []).length) {
      issues.push({
        severity: "error",
        message: `${courseId}: no enrollable packages with known meeting times.`,
      });
      continue;
    }
    const pkg = packageLookup(optionsByCourse, courseId, packageId);
    if (!pkg) {
      issues.push({
        severity: "error",
        message: `${courseId}: package ${packageId} is not a valid option.`,
      });
      continue;
    }
    // Rebuild a packagesClash-compatible shape
    resolved.push({
      courseId: courseOpt.courseId,
      packageId: pkg.packageId,
      pkg: {
        id: pkg.packageId,
        blocks: pkg.blocks || [],
        meetings: pkg.meetings || [],
        instructors: pkg.instructors || [],
        primary: {
          sectionId: pkg.primarySectionId,
          component: pkg.primaryComponent,
        },
        status: pkg.status,
        seatsAvailable: pkg.seatsAvailable,
        seatsTotal: pkg.seatsTotal,
      },
      compact: pkg,
      courseOpt,
    });
  }

  const conflicts = conflictPairsForSelection(resolved);
  if (requireNoConflicts && conflicts.length) {
    for (const pair of conflicts) {
      issues.push({
        severity: "error",
        message: `Time conflict: ${pair}`,
      });
    }
  } else if (conflicts.length) {
    for (const pair of conflicts) {
      issues.push({
        severity: "warning",
        message: `Time conflict: ${pair}`,
      });
    }
  }

  // Courses in options that were not selected — advisory, not blocking.
  for (const course of sectionOptions?.courses || []) {
    const key = compactCourseId(course.courseId);
    if (seenCourses.has(key)) continue;
    if (!course.offered) continue;
    issues.push({
      severity: "warning",
      message: `${course.courseId}: no package selected (current selection kept if any).`,
    });
  }

  return {
    ok: !issues.some((i) => i.severity === "error"),
    issues,
    conflicts,
    resolved,
  };
}

/**
 * Turn a validated selection into the chat `proposed_sections` payload.
 */
export function buildSectionProposal({
  sectionOptions,
  selections,
  explanation = "",
  requireNoConflicts = true,
} = {}) {
  const validation = validateSectionSelection(sectionOptions, selections, {
    requireNoConflicts,
  });
  if (!validation.ok) {
    return { ok: false, ...validation, proposal: null };
  }

  // Before conflicts: current packages (or first option as display fallback)
  const beforeSelections = [];
  for (const course of sectionOptions?.courses || []) {
    if (!course.offered) continue;
    const current =
      (course.packages || []).find((p) => p.currentlySelected) ||
      (course.packages || [])[0];
    if (!current) continue;
    beforeSelections.push({
      courseId: course.courseId,
      pkg: {
        id: current.packageId,
        blocks: current.blocks || [],
      },
    });
  }
  const beforeConflicts = conflictPairsForSelection(beforeSelections);

  const changes = [];
  const selected = [];
  for (const row of validation.resolved) {
    const enrollment = enrollmentFromPackage(row.pkg);
    const prevId = row.courseOpt.currentPackageId || null;
    const changed = prevId !== row.packageId;
    selected.push({
      courseId: row.courseId,
      courseName: row.courseOpt.courseName,
      packageId: row.packageId,
      previousPackageId: prevId,
      changed,
      status: row.compact.status,
      seatsAvailable: row.compact.seatsAvailable,
      seatsTotal: row.compact.seatsTotal,
      instructors: row.compact.instructors,
      primarySectionId: row.compact.primarySectionId,
      primaryComponent: row.compact.primaryComponent,
      meetings: row.compact.meetings,
      enrollment,
    });
    if (changed) {
      changes.push({
        courseId: row.courseId,
        from: prevId,
        to: row.packageId,
      });
    }
  }

  return {
    ok: true,
    issues: validation.issues,
    conflicts: validation.conflicts,
    proposal: {
      year: sectionOptions?.year || null,
      term: sectionOptions?.term || null,
      termLabel: sectionOptions?.termLabel || null,
      source: sectionOptions?.source || null,
      live: Boolean(sectionOptions?.live),
      refreshedAt: sectionOptions?.refreshedAt || null,
      explanation: explanation || "",
      beforeConflicts,
      afterConflicts: validation.conflicts,
      changes,
      selections: selected,
    },
  };
}

/**
 * Re-check that every package in a proposal still exists in fresh options
 * for the same year/term before applying to the grid.
 */
export function validateProposalStillFresh(proposal, sectionOptions) {
  if (!proposal?.selections?.length) {
    return { ok: false, reason: "Proposal has no section selections." };
  }
  if (
    proposal.year &&
    sectionOptions?.year &&
    String(proposal.year) !== String(sectionOptions.year)
  ) {
    return { ok: false, reason: "Proposal is for a different academic year." };
  }
  if (
    proposal.term &&
    sectionOptions?.term &&
    String(proposal.term).toLowerCase() !== String(sectionOptions.term).toLowerCase()
  ) {
    return { ok: false, reason: "Proposal is for a different term." };
  }

  const check = validateSectionSelection(
    sectionOptions,
    proposal.selections.map((s) => ({
      courseId: s.courseId,
      packageId: s.packageId,
    })),
    { requireNoConflicts: false }
  );
  if (!check.ok) {
    const first = check.issues.find((i) => i.severity === "error");
    return {
      ok: false,
      reason:
        first?.message ||
        "Some packages are no longer available — ask the assistant to refresh.",
    };
  }
  return { ok: true, reason: null };
}
