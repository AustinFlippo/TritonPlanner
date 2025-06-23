// Utility functions for mapping audit courses to the four-year planner

/**
 * Parse term string and convert to planner coordinates
 * @param {string} termString - Term string like "FA24", "SP25", "WI25"
 * @returns {object|null} - { yearIndex, quarter } or null if invalid
 */
export function parseTermToCoordinates(termString, debug = false) {
  if (debug) {
    console.log(`🔍 Parsing term coordinates for: "${termString}"`);
  }
  
  if (!termString || typeof termString !== 'string' || termString.length < 3) {
    if (debug) console.log(`❌ Invalid term string: too short or not a string`);
    return null;
  }
  
  // Extract season and year from term string (e.g., "FA24" -> "FA" and "24")
  const seasonCode = termString.substring(0, 2).toUpperCase();
  const yearSuffix = termString.substring(2);
  
  if (debug) {
    console.log(`   Season code: "${seasonCode}", Year suffix: "${yearSuffix}"`);
  }
  
  // Skip summer courses entirely - terms starting with "S" followed by numbers
  // This includes SU, S1, S2, SM, S325, S123, etc. but NOT SP (Spring)
  if (seasonCode === 'SU' || 
      seasonCode === 'SM' ||
      (seasonCode.startsWith('S') && seasonCode !== 'SP' && /\d/.test(termString.substring(1)))) {
    if (debug) console.log(`🚫 Filtering out summer session: ${termString} (seasonCode: ${seasonCode})`);
    return null;
  }
  
  // Map season codes to quarter names
  const seasonMap = {
    'FA': 'fall',
    'WI': 'winter', 
    'SP': 'spring'
  };
  
  const quarter = seasonMap[seasonCode];
  if (!quarter) {
    if (debug) console.log(`❌ Unknown season code: "${seasonCode}"`);
    return null;
  }
  
  if (debug) {
    console.log(`   Mapped to quarter: ${quarter}`);
  }
  
  // Calculate year index based on year suffix
  // Assuming 2024-2025 is year 0, 2025-2026 is year 1, etc.
  const baseYear = 24; // 2024
  const termYear = parseInt(yearSuffix);
  
  if (isNaN(termYear)) {
    if (debug) console.log(`❌ Could not parse year from: "${yearSuffix}"`);
    return null;
  }
  
  if (debug) {
    console.log(`   Parsed year: ${termYear}, Base year: ${baseYear}`);
  }
  
  let yearIndex;
  if (quarter === 'fall') {
    // Fall terms belong to the academic year that starts in that calendar year
    yearIndex = termYear - baseYear;
  } else {
    // Winter/Spring terms belong to the academic year that started the previous fall
    yearIndex = termYear - baseYear - 1;
  }
  
  // Ensure year index is within bounds (0-3 for 4-year plan)
  if (yearIndex < 0 || yearIndex > 3) {
    if (debug) console.log(`❌ Year index out of bounds: ${yearIndex} (must be 0-3)`);
    return null;
  }
  
  const result = { yearIndex, quarter };
  if (debug) {
    console.log(`✅ Term parsed successfully: ${termString} -> ${JSON.stringify(result)}`);
  }
  
  return result;
}

/**
 * Extract course information from audit item string
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
  
  // Pattern to match course format: "COURSE_CODE - Course Title (TERM, GRADE)"
  const coursePattern = /^([A-Z]{2,5}\s+\d+[A-Z]*)\s*-\s*(.+?)\s*\(([^,)]+)(?:,\s*([^)]+))?\)$/;
  
  if (debug) {
    console.log(`🔍 Testing pattern against: "${auditItem}"`);
    console.log(`📝 Pattern: ${coursePattern}`);
  }
  
  const match = auditItem.match(coursePattern);
  
  if (!match) {
    if (debug) {
      console.log(`❌ Pattern did not match. Trying alternative patterns...`);
      
      // Try alternative patterns
      const altPattern1 = /^([A-Z]+\s*\d+[A-Z]*)\s*-\s*(.+?)\s*\(([^,)]+)(?:,\s*([^)]+))?\)$/; // Allow more flexible spacing
      const altPattern2 = /^([A-Z]+\d+[A-Z]*)\s*-\s*(.+?)\s*\(([^,)]+)(?:,\s*([^)]+))?\)$/; // No space required between letters and numbers
      
      const altMatch1 = auditItem.match(altPattern1);
      const altMatch2 = auditItem.match(altPattern2);
      
      console.log(`   Alt pattern 1 (flexible space): ${altMatch1 ? 'MATCH' : 'NO MATCH'}`);
      console.log(`   Alt pattern 2 (no space): ${altMatch2 ? 'MATCH' : 'NO MATCH'}`);
      
      if (altMatch1) {
        const [, courseCode, courseTitle, term, grade] = altMatch1;
        console.log(`✅ Using alt pattern 1 result:`, { courseCode, courseTitle, term, grade });
        return {
          course_id: courseCode.trim(),
          course_name: courseTitle.trim(),
          term: term.trim(),
          grade: grade ? grade.trim() : '',
          credits: 4
        };
      }
      
      if (altMatch2) {
        const [, courseCode, courseTitle, term, grade] = altMatch2;
        console.log(`✅ Using alt pattern 2 result:`, { courseCode, courseTitle, term, grade });
        return {
          course_id: courseCode.trim(),
          course_name: courseTitle.trim(),
          term: term.trim(),
          grade: grade ? grade.trim() : '',
          credits: 4
        };
      }
    }
    return null;
  }
  
  const [, courseCode, courseTitle, term, grade] = match;
  
  if (debug) {
    console.log(`✅ Pattern matched successfully:`, { courseCode, courseTitle, term, grade });
  }
  
  return {
    course_id: courseCode.trim(),
    course_name: courseTitle.trim(),
    term: term.trim(),
    grade: grade ? grade.trim() : '',
    credits: 4 // Default credits, could be enhanced to parse from course data
  };
}

/**
 * Convert audit sections to planner course data
 * @param {Array} auditSections - Array of audit sections from parser
 * @returns {Array} - Array of course objects ready for planner
 */
export function convertAuditToPlanner(auditSections) {
  const plannerCourses = [];
  
  auditSections.forEach(section => {
    if (!section.items || !Array.isArray(section.items)) return;
    
    // Check if this is the comprehensive "In Progress" section or "WORK IN PROGRESS" section
    const isInProgressSection = section.title && 
      (section.title.toLowerCase().startsWith('the following courses') || 
       section.title.toLowerCase() === 'in progress' ||
       section.title.toLowerCase().includes('work in progress'));
       
    // Debug: Log when we find a WORK IN PROGRESS section
    if (isInProgressSection) {
      console.log(`\n🔍 ======= WORK IN PROGRESS SECTION DEBUG =======`);
      console.log(`📋 Section: "${section.title}" with ${section.items?.length || 0} items`);
      console.log(`📝 Raw items:`, section.items);
      console.log(`===============================================\n`);
    }
    
    section.items.forEach((item, index) => {
      if (isInProgressSection) {
        console.log(`\n🔍 Processing WIP item ${index + 1}: "${item}"`);
      }
      
      const courseData = parseCourseFromAuditItem(item, isInProgressSection);
      if (!courseData) {
        if (isInProgressSection) {
          console.log(`❌ Could not parse course data from: "${item}"`);
        }
        return;
      }
      
      if (isInProgressSection) {
        console.log(`✅ Parsed course data:`, courseData);
      }
      
      // Skip summer courses (S followed by number in term)
      const coordinates = parseTermToCoordinates(courseData.term, isInProgressSection);
      if (!coordinates) {
        if (isInProgressSection) {
          console.log(`🚫 WIP course filtered out: ${courseData.course_id} (${courseData.term}) - Reason: Could not parse term coordinates`);
        }
        return;
      }
      
      if (isInProgressSection) {
        console.log(`🎯 Term coordinates: ${courseData.course_id} (${courseData.term}) -> Year ${coordinates.yearIndex}, ${coordinates.quarter}`);
      }
      
      // Determine course status based primarily on grade field
      let status = 'planned'; // Default status
      
      // Special handling for "In Progress" or "WORK IN PROGRESS" sections - these are definitely current
      if (isInProgressSection) {
        status = 'current';
      } else if (courseData.grade && courseData.grade.trim() !== '') {
        const grade = courseData.grade.toLowerCase().trim();
        
        // Course is in-progress if grade is "NR", "WIP", or contains "progress"
        if (grade === 'nr' || 
            grade === 'wip' || 
            grade.includes('wip') ||
            grade.includes('progress') || 
            grade.includes('in progress')) {
          status = 'current';
        } else {
          // Course is completed if it has any other non-empty grade (A, B+, C, etc.)
          status = 'completed';
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
        status,
        yearIndex: coordinates.yearIndex,
        quarter: coordinates.quarter
      };
      
      plannerCourses.push(plannerCourse);
      
      // Debug: Log successful course addition
      if (isInProgressSection) {
        console.log(`✅ SUCCESS: Added WIP course to planner: ${courseData.course_id} -> Year ${coordinates.yearIndex}, ${coordinates.quarter} (status: ${status})`);
        console.log(`   Full course object:`, plannerCourse);
      }
    });
    
    // Debug: Summary for WORK IN PROGRESS sections
    if (isInProgressSection) {
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
      const statusPriority = { completed: 3, current: 2, planned: 1 };
      const currentPriority = statusPriority[currentStatus.status] || 0;
      const newPriority = statusPriority[course.status] || 0;
      
      if (newPriority > currentPriority) {
        courseStatusMap.set(course.course_id, course);
        console.log(`Updated ${course.course_id} status from ${currentStatus.status} to ${course.status}`);
      }
    }
  });
  
  // Second pass: add unique courses not already in schedule
  courseStatusMap.forEach((course, courseId) => {
    if (!addedCourses.has(courseId)) {
      uniqueAuditCourses.push(course);
      addedCourses.add(courseId);
    } else {
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
export function processAuditForPlanner(auditSections, currentSchedule) {
  console.log('Processing audit sections for planner:', auditSections);
  
  // Convert audit data to planner courses
  const auditCourses = convertAuditToPlanner(auditSections);
  console.log('Converted audit courses:', auditCourses);
  
  // Populate the schedule with audit courses
  const updatedSchedule = populatePlannerWithAuditCourses(currentSchedule, auditCourses);
  console.log('Updated schedule:', updatedSchedule);
  
  return updatedSchedule;
}