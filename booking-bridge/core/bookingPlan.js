/**
 * Booking plan builder.
 *
 * TritonPlanner plans at the course level across four years. TSS books at the
 * section level for one term. This module bridges that gap: given the grid,
 * a target term, and (optionally) live section data scraped from TSS, it
 * produces an ordered, unit-capped, fallback-aware list of things to book.
 *
 * Pure logic. No DOM, no network, no TSS coupling — so it is testable on its
 * own and reusable by both the React app and the extension.
 */

import { normalizeCourseId, countUnlocks, scarcityScore } from "./catalog.js";

/**
 * Undergraduate unit ceilings, per students.ucsd.edu/academics/enroll.
 * Waitlisted units count against the cap, which is why `pass: 2` planning has
 * to treat a waitlist entry as consuming units just like a booked seat.
 */
export const UNIT_CAPS = {
  undergrad: { 1: 11.5, 2: 19.5, instruction: 22 },
  grad: { 1: 20, 2: 20, instruction: 30 },
};

export function unitCapFor({ level = "undergrad", pass = 1 } = {}) {
  const caps = UNIT_CAPS[level] || UNIT_CAPS.undergrad;
  return caps[pass] ?? caps[1];
}

const TERM_TO_OFFERING = { fall: "FA", winter: "WI", spring: "SP" };

// --- meeting time handling -------------------------------------------------

/** "10:00" / "10:00a" / "2:00p" -> minutes past midnight. */
export function toMinutes(value) {
  if (typeof value === "number") return value;
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{1,2}):?(\d{2})?\s*([ap])?m?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = (match[3] || "").toLowerCase();
  if (meridiem === "p" && hours !== 12) hours += 12;
  if (meridiem === "a" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/** Do two meeting blocks share a day and overlap in time? */
export function meetingsConflict(a, b) {
  if (!a || !b) return false;
  const daysA = a.days || [];
  const daysB = b.days || [];
  if (!daysA.some((day) => daysB.includes(day))) return false;

  const startA = toMinutes(a.start);
  const endA = toMinutes(a.end);
  const startB = toMinutes(b.start);
  const endB = toMinutes(b.end);
  if ([startA, endA, startB, endB].some((v) => v === null)) return false;

  return startA < endB && startB < endA;
}

/** All meeting blocks a section occupies, including its linked components. */
function meetingsOf(section) {
  const blocks = [];
  if (section.days && section.start) blocks.push(section);
  for (const linked of section.linked || []) {
    if (linked.days && linked.start) blocks.push(linked);
  }
  return blocks;
}

export function sectionsConflict(a, b) {
  for (const blockA of meetingsOf(a)) {
    for (const blockB of meetingsOf(b)) {
      if (meetingsConflict(blockA, blockB)) return true;
    }
  }
  return false;
}

// --- section ranking -------------------------------------------------------

const STATUS_RANK = {
  open: 0,
  "waitlist-active": 1,
  "waitlist-inactive": 2,
  full: 3,
  unknown: 1,
};

/**
 * Order candidate sections best-first. Openness dominates — a perfect time
 * slot in a section you cannot get into is worth nothing — then student
 * preferences, then remaining seats as a tiebreak.
 */
export function rankSections(sections, preferences = {}) {
  const earliest = preferences.avoidBefore ? toMinutes(preferences.avoidBefore) : null;
  const latest = preferences.avoidAfter ? toMinutes(preferences.avoidAfter) : null;
  const preferredDays = preferences.preferDays || null;

  const score = (section) => {
    let penalty = STATUS_RANK[section.status || "unknown"] * 100;

    for (const block of meetingsOf(section)) {
      const start = toMinutes(block.start);
      const end = toMinutes(block.end);
      if (earliest !== null && start !== null && start < earliest) penalty += 20;
      if (latest !== null && end !== null && end > latest) penalty += 20;
      if (preferredDays && (block.days || []).some((d) => !preferredDays.includes(d))) {
        penalty += 5;
      }
    }

    if (preferences.preferInstructors && section.instructor) {
      const liked = preferences.preferInstructors.some((name) =>
        section.instructor.toLowerCase().includes(name.toLowerCase())
      );
      if (liked) penalty -= 15;
    }

    // Prefer more breathing room, so a near-full section loses to a roomy one.
    const seatsLeft = seatsRemaining(section);
    if (seatsLeft !== null) penalty -= Math.min(seatsLeft, 30) / 10;

    return penalty;
  };

  return [...sections].sort((a, b) => score(a) - score(b));
}

export function seatsRemaining(section) {
  if (typeof section.seatsTotal !== "number") return null;
  if (typeof section.seatsTaken !== "number") return null;
  return Math.max(0, section.seatsTotal - section.seatsTaken);
}

// --- criticality -----------------------------------------------------------

/**
 * How badly does this course need to be secured in first pass?
 *
 * Scarce seats are the obvious factor, but the one students consistently get
 * wrong is dependency depth: an easy elective feels safe to grab early, while
 * the gateway course that unlocks half of next year is the one that actually
 * cannot slip.
 */
export function scoreCriticality({ courseId, entry, plannedIds, catalog, sections }) {
  const unlocks = countUnlocks(courseId, plannedIds, catalog);
  const scarcity = scarcityScore(entry?.offerings);

  // Seat pressure from live TSS data, 0..1. Without section data this stays 0
  // and ordering falls back to structural signals alone.
  let pressure = 0;
  if (sections && sections.length) {
    const openish = sections.filter((s) => s.status === "open");
    if (openish.length === 0) {
      pressure = 1;
    } else {
      const totals = openish.map(seatsRemaining).filter((n) => n !== null);
      if (totals.length) {
        const best = Math.max(...totals);
        pressure = best <= 5 ? 1 : best <= 20 ? 0.6 : best <= 50 ? 0.3 : 0.1;
      }
    }
  }

  const score = unlocks * 3 + scarcity * 2.5 + pressure * 2;

  const reasons = [];
  if (unlocks > 0) {
    reasons.push(
      `unlocks ${unlocks} later course${unlocks === 1 ? "" : "s"} in your plan`
    );
  }
  if (scarcity >= 1) reasons.push("offered only one quarter per year");
  else if (scarcity >= 0.4) reasons.push("offered only two quarters per year");
  if (pressure >= 1) reasons.push("no open sections right now");
  else if (pressure >= 0.6) reasons.push("very few seats left");
  if (!reasons.length) reasons.push("no downstream dependencies — safe to defer");

  return { score, unlocks, scarcity, pressure, reasons };
}

// --- plan construction -----------------------------------------------------

/**
 * Build the ordered booking plan for one term.
 *
 * @param {object[][]} grid            TritonPlanner schedule (4 years x terms)
 * @param {number}     yearIndex       which year row to book
 * @param {string}     term            "fall" | "winter" | "spring"
 * @param {string}     termCode        TSS term label, e.g. "FA26"
 * @param {Map}        catalog         from indexCatalog()
 * @param {object}     sectionsByCourse course id -> section[] scraped from TSS
 * @param {number}     pass            1 or 2
 * @param {string[]}   alreadyBooked   course ids already booked in TSS
 */
export function buildBookingPlan({
  grid,
  yearIndex,
  term,
  termCode,
  catalog,
  sectionsByCourse = {},
  pass = 1,
  level = "undergrad",
  alreadyBooked = [],
  preferences = {},
}) {
  const warnings = [];
  const unitCap = unitCapFor({ level, pass });

  const cell = grid?.[yearIndex]?.[term] || [];
  const booked = new Set(alreadyBooked.map(normalizeCourseId).filter(Boolean));

  // Every course anywhere in the plan — the dependency graph needs the whole
  // grid, not just this term, to know what a course unlocks downstream.
  const plannedIds = [];
  for (const year of grid || []) {
    for (const termName of Object.keys(year || {})) {
      for (const course of year[termName] || []) {
        const id = normalizeCourseId(course?.course_id);
        if (id) plannedIds.push(id);
      }
    }
  }

  const candidates = [];
  for (const course of cell) {
    const id = normalizeCourseId(course?.course_id);
    if (!id) continue;
    if (booked.has(id)) continue;

    const entry = catalog.get(id);
    if (!entry) {
      warnings.push(`${id} is not in the catalog — units and prerequisites unknown.`);
    }

    const sections = sectionsByCourse[id] || [];
    const criticality = scoreCriticality({
      courseId: id,
      entry,
      plannedIds,
      catalog,
      sections,
    });

    // Flag a course the catalog says isn't normally offered this quarter.
    const offering = TERM_TO_OFFERING[term];
    if (entry?.offerings?.length && offering && !entry.offerings.includes(offering)) {
      warnings.push(
        `${id} is not normally offered in ${term} (catalog lists ${entry.offerings.join("/")}).`
      );
    }

    candidates.push({
      courseId: id,
      title: entry?.title || course.course_name || id,
      units: entry?.units ?? Number(course?.credits) ?? 0,
      variableUnits: entry?.variableUnits || false,
      criticality,
      targets: rankSections(sections, preferences),
      hasSectionData: sections.length > 0,
    });
  }

  candidates.sort((a, b) => b.criticality.score - a.criticality.score);

  // Pack into the unit cap in criticality order, skipping anything that would
  // collide in time with an already-selected section.
  const steps = [];
  const deferred = [];
  let totalUnits = 0;
  const chosen = [];

  for (const candidate of candidates) {
    if (totalUnits + candidate.units > unitCap) {
      deferred.push({
        ...candidate,
        reason: `would exceed the ${unitCap}-unit pass ${pass} cap`,
      });
      continue;
    }

    const primary = candidate.targets[0] || null;
    if (primary && chosen.some((picked) => sectionsConflict(picked, primary))) {
      const alternative = candidate.targets.find(
        (option) => !chosen.some((picked) => sectionsConflict(picked, option))
      );
      if (!alternative) {
        deferred.push({
          ...candidate,
          reason: "every section conflicts with a higher-priority course",
        });
        continue;
      }
      candidate.targets = [
        alternative,
        ...candidate.targets.filter((t) => t !== alternative),
      ];
    }

    if (candidate.targets[0]) chosen.push(candidate.targets[0]);
    totalUnits += candidate.units;
    steps.push({
      rank: steps.length + 1,
      ...candidate,
      gradingOption: preferences.gradingOption || "letter",
    });
  }

  if (!Object.keys(sectionsByCourse).length) {
    warnings.push(
      "No section data loaded. Ordering uses catalog structure only — " +
        "run a Schedule of Classes scrape in TSS to add seat and time awareness."
    );
  }

  return {
    termCode,
    term,
    yearIndex,
    pass,
    level,
    unitCap,
    totalUnits,
    steps,
    deferred,
    warnings,
    generatedAt: null, // stamped by the caller; kept pure here
  };
}
