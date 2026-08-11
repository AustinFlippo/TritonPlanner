// Utility functions for mapping audit courses to the four-year planner

import { parseCredits } from "./courseCredits.js";
import { isWipGrade, isPassingGrade } from "./courseGrades.js";

// Verbose tracing for the audit -> planner conversion. Off by default: these
// logs fired on every upload (they were gated on `isInProgressSection`, which
// is true for the WORK IN PROGRESS section every audit has), printing the
// student's whole transcript to the browser console. Flip to true when working
// on the parser.
const DEBUG_AUDIT = false;

const LAUNCH_BASE_YEAR = 24; // year_index 0 launched as 2024-2025

const normalizeCourseId = (value = "") =>
  String(value)
    .toUpperCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^([A-Z]{2,6})\s*(\d)/, "$1 $2")
    .trim();

/**
 * Units per course, as the AUDIT itself states them.
 *
 * Every taken-course row in a UCSD audit carries an hours column, and the
 * parser keeps it on `subrequirements[].completedCourses[].credits`. That is
 * the authoritative number for a course the student has already taken — it is
 * the credit the registrar actually applied — and it is the only unit count
 * reachable here: this conversion is synchronous and the catalog lives behind
 * an async endpoint.
 *
 * Anything the audit did not state stays unknown (null). It must NOT fall back
 * to a flat 4: that fabricated number was the single invented figure in the
 * whole unit ledger, and it silently mis-stated `currentUnits`, `projectedUnits`
 * and the headline "N units left" for every 2-unit lab, 1-unit seminar and
 * 6-unit course. Downstream already handles null honestly — CourseCard renders
 * "? u" and calculateAuditProgress counts the course under `unknownUnitCourses`
 * so the panel can say the total is a floor rather than quietly understating it.
 */
export function auditCreditsIndex(auditSections) {
  const byCourse = new Map();
  for (const section of auditSections || []) {
    for (const sub of section?.subrequirements || []) {
      for (const course of sub?.completedCourses || []) {
        const id = normalizeCourseId(course?.course_id);
        if (!id || byCourse.has(id)) continue;
        const credits = parseCredits(course?.credits, null);
        if (credits !== null) byCourse.set(id, credits);
      }
    }
  }
  return byCourse;
}

const creditsFrom = (index, courseId) =>
  index?.get(normalizeCourseId(courseId)) ?? null;

/**
 * Two-digit Fall year for year_index 0. Mirrors app/planner_agent.py
 * grid_base_year — keeps the 2024 launch anchor until FA28+, then re-anchors
 * year 0 to the current academic year.
 */
export function gridBaseYear(now = new Date()) {
  const yy = now.getFullYear() % 100;
  const month = now.getMonth() + 1; // 1-12
  const currentFall = month >= 7 ? yy : yy - 1;
  if (currentFall - LAUNCH_BASE_YEAR <= 3) return LAUNCH_BASE_YEAR;
  return currentFall;
}

// A student can't plan a 40-year degree; guards against a garbled catalog year
// turning into hundreds of grid rows.
export const MIN_PLAN_YEARS = 4;
export const MAX_PLAN_YEARS = 8;

/** Two-digit fall year of the academic year currently in progress. */
function currentAcademicYear(now = new Date()) {
  const yy = now.getFullYear() % 100;
  return now.getMonth() + 1 >= 7 ? yy : yy - 1;
}

/**
 * Two-digit fall year from a UCSD audit's "Catalog Year" header value.
 * "Fall 2024" -> 24. Winter/Spring belong to the academic year that started
 * the previous fall, so "Winter 2025" -> 24. Returns null if unparseable.
 */
export function parseCatalogYear(value) {
  const m = String(value || "").match(/(fall|winter|spring|summer)?\s*(\d{4})/i);
  if (!m) return null;
  const year = parseInt(m[2], 10) % 100;
  const season = (m[1] || "fall").toLowerCase();
  return season === "fall" ? year : year - 1;
}

/**
 * The window the planner grid covers: which academic year is Year 1, and how
 * many years to show.
 *
 * Anchored to the student's catalog year (their matriculation catalog, read
 * from the audit header) — NOT to a fixed calendar year, and NOT to their
 * earliest completed term, which is transfer/AP credit dated years before they
 * arrived. Without an audit we fall back to the old calendar anchor.
 *
 * The grid is at least 4 years and grows to cover the year in progress, so a
 * fifth-year student can still see and plan the quarter they're enrolling in.
 */
export function planWindow(catalogYear, now = new Date()) {
  const baseYear =
    typeof catalogYear === "number" && Number.isFinite(catalogYear)
      ? catalogYear
      : gridBaseYear(now);
  const spanToNow = currentAcademicYear(now) - baseYear + 1;
  const yearCount = Math.min(
    MAX_PLAN_YEARS,
    Math.max(MIN_PLAN_YEARS, spanToNow)
  );
  return { baseYear, yearCount };
}

/** ["2024-2025", "2025-2026", ...] for a window. */
export function yearLabelsFor(window) {
  // Tolerate a missing window: callers render during early mounts, and a
  // white-screen is a far worse failure than one render with the default
  // calendar anchor.
  const { baseYear, yearCount } = window || planWindow(null);
  return Array.from(
    { length: yearCount },
    (_, i) => `20${baseYear + i}-20${baseYear + i + 1}`
  );
}

/**
 * Stamp a grid with the academic year its year_index 0 means, for storage.
 *
 * A grid is stored as year_index 0-3, which only means something alongside the
 * base year. gridBaseYear re-anchors at FA28, so without the stamp an old
 * snapshot's "Year 4" would later be reread as a future year and its past
 * placements would come back as plannable.
 *
 * Nothing consumes baseYear yet — this exists so the migration that will need
 * it has something to read.
 */
export function stampGrid(grid, now = new Date()) {
  return { baseYear: gridBaseYear(now), grid };
}

/**
 * Inverse of stampGrid, tolerating grids stored before it existed: those are
 * a bare array and read back with baseYear null ("unknown — assume the launch
 * anchor").
 */
export function readStampedGrid(stored) {
  if (Array.isArray(stored)) return { grid: stored, baseYear: null };
  return { grid: stored?.grid ?? [], baseYear: stored?.baseYear ?? null };
}

/**
 * Classify a term against the plan window without dropping out-of-bounds rows.
 * Returns null for summer / unparseable terms; otherwise
 * { yearIndex, quarter, inWindow }.
 */
function classifyTerm(termString, now = new Date(), window = null) {
  if (!termString || typeof termString !== "string" || termString.length < 3) {
    return null;
  }

  const seasonCode = termString.substring(0, 2).toUpperCase();
  const yearSuffix = termString.substring(2);

  // Skip summer courses entirely - terms starting with "S" followed by numbers
  // This includes SU, S1, S2, SM, S325, S123, etc. but NOT SP (Spring)
  if (
    seasonCode === "SU" ||
    seasonCode === "SM" ||
    (seasonCode.startsWith("S") &&
      seasonCode !== "SP" &&
      /\d/.test(termString.substring(1)))
  ) {
    return null;
  }

  const seasonMap = {
    FA: "fall",
    WI: "winter",
    SP: "spring",
  };

  const quarter = seasonMap[seasonCode];
  if (!quarter) return null;

  const { baseYear, yearCount } = window || planWindow(null, now);
  const termYear = parseInt(yearSuffix, 10);
  if (isNaN(termYear)) return null;

  // Fall belongs to the academic year that starts that calendar year;
  // Winter/Spring belong to the year that started the previous fall.
  const yearIndex =
    quarter === "fall" ? termYear - baseYear : termYear - baseYear - 1;

  return {
    yearIndex,
    quarter,
    inWindow: yearIndex >= 0 && yearIndex < yearCount,
  };
}

/**
 * Parse term string and convert to planner coordinates
 * @param {string} termString - Term string like "FA24", "SP25", "WI25"
 * @param {boolean} debug
 * @param {Date} now
 * @param {object} [window] - { baseYear, yearCount } from planWindow(). Omit to
 *   fall back to the calendar anchor (no audit loaded yet).
 * @returns {object|null} - { yearIndex, quarter } or null if invalid / out of window
 */
export function parseTermToCoordinates(termString, debug = false, now = new Date(), window = null) {
  if (debug) {
    console.log(`🔍 Parsing term coordinates for: "${termString}"`);
  }

  const classified = classifyTerm(termString, now, window);
  if (!classified) {
    if (debug) console.log(`❌ Term rejected (summer, unknown, or unparseable): ${termString}`);
    return null;
  }

  if (!classified.inWindow) {
    if (debug) {
      const { yearCount } = window || planWindow(null, now);
      console.log(
        `❌ Year index out of bounds: ${classified.yearIndex} (must be 0-${yearCount - 1})`
      );
    }
    return null;
  }

  const result = {
    yearIndex: classified.yearIndex,
    quarter: classified.quarter,
  };
  if (debug) {
    console.log(`✅ Term parsed successfully: ${termString} -> ${JSON.stringify(result)}`);
  }
  return result;
}

/**
 * Extract course information from audit item string
 *
 * `credits` comes back null: the item string carries the code, title, term and
 * grade and says nothing about units. Real unit counts are joined on from
 * auditCreditsIndex by the callers that have the whole audit in hand.
 *
 * @param {string} auditItem - Course string like "MATH 20A - Calculus I (FA24, A)"
 * @returns {object|null} - Parsed course data or null if not a course
 */
export function parseCourseFromAuditItem(auditItem, debug = false) {
  if (!auditItem || typeof auditItem !== 'string') {
    if (debug) console.log(`❌ Invalid audit item: ${auditItem}`);
    return null;
  }
  
  // Skip items that are not actual courses (requirements, needs, etc.)
  if (auditItem.includes('NEEDS:') || auditItem.includes('Available:') || auditItem.includes('Requirement')) {
    if (debug) console.log(`❌ Skipping non-course item: ${auditItem}`);
    return null;
  }
  
  // Pattern to match course format: "COURSE_CODE - Course Title (TERM, GRADE)".
  // Space between department and number is optional — audits sometimes emit
  // "MATH183" / "COGS108" without a space.
  const coursePattern =
    /^([A-Z]{2,5}\s*\d+[A-Z]*)\s*-\s*(.+?)\s*\(([^,)]+)(?:,\s*([^)]+))?\)$/;
  
  if (debug) {
    console.log(`🔍 Testing pattern against: "${auditItem}"`);
    console.log(`📝 Pattern: ${coursePattern}`);
  }
  
  const match = auditItem.match(coursePattern);
  
  if (!match) {
    if (debug) console.log(`❌ Pattern did not match: "${auditItem}"`);
    return null;
  }
  
  const [, rawCode, courseTitle, term, grade] = match;
  // Canonicalize "MATH183" → "MATH 183" so the rest of the app sees spaced ids.
  const courseCode = rawCode
    .trim()
    .replace(/^([A-Z]{2,5})\s*(\d)/, "$1 $2");
  
  if (debug) {
    console.log(`✅ Pattern matched successfully:`, { courseCode, courseTitle, term, grade });
  }
  
  return {
    course_id: courseCode,
    course_name: courseTitle.trim(),
    term: term.trim(),
    grade: grade ? grade.trim() : '',
    // Unknown from this string alone. Never 4: see auditCreditsIndex.
    credits: null
  };
}

/**
 * Courses whose FA/WI/SP term falls outside the student's plan window.
 *
 * Almost always transfer/AP credit posted under the term it was earned, years
 * before UCSD matriculation — they still count in the sidebar and for
 * prerequisites, but have no UCSD term to sit on the grid. Summer and
 * unparseable terms are excluded (different reasons, different messaging).
 */
export function outOfWindowAuditCourses(
  auditSections,
  window = null,
  now = new Date()
) {
  if (!Array.isArray(auditSections)) return [];

  const seen = new Set();
  const omitted = [];
  const credits = auditCreditsIndex(auditSections);

  for (const section of auditSections) {
    if (!section?.items || !Array.isArray(section.items)) continue;
    for (const item of section.items) {
      const courseData = parseCourseFromAuditItem(item);
      if (!courseData) continue;

      const classified = classifyTerm(courseData.term, now, window);
      if (!classified || classified.inWindow) continue;
      if (seen.has(courseData.course_id)) continue;

      seen.add(courseData.course_id);
      omitted.push({
        ...courseData,
        credits: creditsFrom(credits, courseData.course_id),
      });
    }
  }

  return omitted;
}

/**
 * Convert audit sections to planner course data
 * @param {Array} auditSections - Array of audit sections from parser
 * @returns {Array} - Array of course objects ready for planner
 */
export function convertAuditToPlanner(auditSections, window = null) {
  const plannerCourses = [];
  // Real unit counts from the audit's own hours column, joined on below.
  const creditsIndex = auditCreditsIndex(auditSections);

  auditSections.forEach(section => {
    if (!section.items || !Array.isArray(section.items)) return;
    
    // Check if this is the comprehensive "In Progress" section or "WORK IN PROGRESS" section
    const isInProgressSection = section.title && 
      (section.title.toLowerCase().startsWith('the following courses') || 
       section.title.toLowerCase() === 'in progress' ||
       section.title.toLowerCase().includes('work in progress'));
       
    // Debug: Log when we find a WORK IN PROGRESS section
    if (DEBUG_AUDIT) {
      console.log(`\n🔍 ======= WORK IN PROGRESS SECTION DEBUG =======`);
      console.log(`📋 Section: "${section.title}" with ${section.items?.length || 0} items`);
      console.log(`📝 Raw items:`, section.items);
      console.log(`===============================================\n`);
    }
    
    section.items.forEach((item, index) => {
      if (DEBUG_AUDIT) {
        console.log(`\n🔍 Processing WIP item ${index + 1}: "${item}"`);
      }
      
      const courseData = parseCourseFromAuditItem(item, DEBUG_AUDIT);
      if (!courseData) {
        if (DEBUG_AUDIT) {
          console.log(`❌ Could not parse course data from: "${item}"`);
        }
        return;
      }
      
      if (DEBUG_AUDIT) {
        console.log(`✅ Parsed course data:`, courseData);
      }
      
      // Skip summer courses (S followed by number in term) and out-of-window
      // transfer/AP rows — those are surfaced separately via outOfWindowAuditCourses.
      const coordinates = parseTermToCoordinates(
        courseData.term, DEBUG_AUDIT, new Date(), window);
      if (!coordinates) {
        if (DEBUG_AUDIT) {
          console.log(`🚫 WIP course filtered out: ${courseData.course_id} (${courseData.term}) - Reason: Could not parse term coordinates`);
        }
        return;
      }
      
      if (DEBUG_AUDIT) {
        console.log(`🎯 Term coordinates: ${courseData.course_id} (${courseData.term}) -> Year ${coordinates.yearIndex}, ${coordinates.quarter}`);
      }
      
      // Determine course status based primarily on grade field
      let status = 'planned'; // Default status
      
      // Special handling for "In Progress" or "WORK IN PROGRESS" sections - these are definitely current
      if (isInProgressSection) {
        status = 'current';
      } else if (courseData.grade && courseData.grade.trim() !== '') {
        if (isWipGrade(courseData.grade)) {
          status = 'current';
        } else if (isPassingGrade(courseData.grade)) {
          status = 'completed';
        } else {
          // F / W / NP / I. This used to fall through to 'completed' because
          // the test was "any grade that isn't work-in-progress", so a failed
          // course showed on the grid as passed and stopped being offered.
          status = 'failed';
        }
      } else {
        // No grade field - determine from section status
        if (section.status === 'in_progress') {
          status = 'current';
        } else if (section.status === 'fulfilled') {
          status = 'completed';
        }
      }
      
      const plannerCourse = {
        ...courseData,
        credits: creditsFrom(creditsIndex, courseData.course_id),
        status,
        yearIndex: coordinates.yearIndex,
        quarter: coordinates.quarter
      };
      
      plannerCourses.push(plannerCourse);
      
      // Debug: Log successful course addition
      if (DEBUG_AUDIT) {
        console.log(`✅ SUCCESS: Added WIP course to planner: ${courseData.course_id} -> Year ${coordinates.yearIndex}, ${coordinates.quarter} (status: ${status})`);
        console.log(`   Full course object:`, plannerCourse);
      }
    });
    
    // Debug: Summary for WORK IN PROGRESS sections
    if (DEBUG_AUDIT) {
      console.log(`\n📊 ======= WIP SECTION SUMMARY =======`);
      console.log(`📋 Section: "${section.title}"`);
      console.log(`📝 Total items processed: ${section.items?.length || 0}`);
      console.log(`✅ Courses added to planner: ${plannerCourses.filter(course => 
        section.items?.some(item => item.includes(course.course_id))
      ).length}`);
      console.log(`=====================================\n`);
    }
  });
  
  return plannerCourses;
}


/**
 * Populate planner schedule with audit courses
 * @param {Array} existingSchedule - Current 4x3 planner schedule
 * @param {Array} auditCourses - Courses from convertAuditToPlanner
 * @returns {Array} - Updated schedule with audit courses
 */
export function populatePlannerWithAuditCourses(existingSchedule, auditCourses) {
  // Create a deep copy of the existing schedule
  const newSchedule = existingSchedule.map(year => ({
    fall: [...year.fall],
    winter: [...year.winter],
    spring: [...year.spring]
  }));
  
  // Track courses we've already added to prevent duplicates
  const addedCourses = new Set();
  
  // First, collect all existing course IDs in the schedule
  for (const year of newSchedule) {
    for (const quarter of ['fall', 'winter', 'spring']) {
      for (const course of year[quarter]) {
        if (course && course.course_id) {
          addedCourses.add(course.course_id);
        }
      }
    }
  }
  
  // Filter out duplicate courses from audit data with special handling for WIP/NR
  const uniqueAuditCourses = [];
  const courseStatusMap = new Map(); // Track course ID -> best status
  
  // First pass: build map of course statuses
  auditCourses.forEach(course => {
    const currentStatus = courseStatusMap.get(course.course_id);
    
    if (!currentStatus) {
      courseStatusMap.set(course.course_id, course);
    } else {
      // Priority: completed > current > planned
      // 'failed' is absent on purpose: it falls to 0 below, so a passing
      // retake always beats the failed attempt for the same course code.
      const statusPriority = { completed: 3, current: 2, planned: 1 };
      const currentPriority = statusPriority[currentStatus.status] || 0;
      const newPriority = statusPriority[course.status] || 0;
      
      if (newPriority > currentPriority) {
        courseStatusMap.set(course.course_id, course);
        if (DEBUG_AUDIT) {
          console.log(`Updated ${course.course_id} status from ${currentStatus.status} to ${course.status}`);
        }
      }
    }
  });
  
  // Second pass: add unique courses not already in schedule
  courseStatusMap.forEach((course, courseId) => {
    if (!addedCourses.has(courseId)) {
      uniqueAuditCourses.push(course);
      addedCourses.add(courseId);
    } else if (DEBUG_AUDIT) {
      console.log(`Skipping duplicate course: ${courseId} (already in planner)`);
    }
  });
  
  // Group unique courses by year and quarter
  const coursesByTerm = {};
  uniqueAuditCourses.forEach(course => {
    const key = `${course.yearIndex}-${course.quarter}`;
    if (!coursesByTerm[key]) {
      coursesByTerm[key] = [];
    }
    coursesByTerm[key].push(course);
  });
  
  // Place courses in the schedule
  Object.entries(coursesByTerm).forEach(([key, courses]) => {
    const [yearIndex, quarter] = key.split('-');
    const yearIdx = parseInt(yearIndex);
    
    if (yearIdx < 0 || yearIdx >= newSchedule.length) return;
    
    const termSlots = newSchedule[yearIdx][quarter];
    
    courses.forEach(course => {
      // Find the first empty slot
      const emptySlotIndex = termSlots.findIndex(slot => slot === null);
      
      if (emptySlotIndex !== -1) {
        // Place in empty slot
        termSlots[emptySlotIndex] = course;
      } else {
        // Add to end of term (expand the term)
        termSlots.push(course);
      }
    });
    
    // Ensure at least one empty slot remains
    if (!termSlots.some(slot => slot === null)) {
      termSlots.push(null);
    }
  });
  
  return newSchedule;
}

/**
 * Main function to process audit data and update planner
 * @param {Array} auditSections - Audit sections from SidebarAuditTracker
 * @param {Array} currentSchedule - Current planner schedule
 * @returns {Array} - Updated schedule with audit courses
 */
export function processAuditForPlanner(auditSections, currentSchedule, window = null) {
  if (DEBUG_AUDIT) console.log('Processing audit sections for planner:', auditSections);

  // Convert audit data to planner courses
  const auditCourses = convertAuditToPlanner(auditSections, window);
  if (DEBUG_AUDIT) console.log('Converted audit courses:', auditCourses);

  // Populate the schedule with audit courses
  const updatedSchedule = populatePlannerWithAuditCourses(currentSchedule, auditCourses);
  if (DEBUG_AUDIT) console.log('Updated schedule:', updatedSchedule);
  
  return updatedSchedule;
}