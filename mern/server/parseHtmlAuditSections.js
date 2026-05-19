import * as cheerio from 'cheerio';
import fs from 'fs';

export function parseHtmlAudit(htmlFilePath) {
  try {
    const htmlContent = fs.readFileSync(htmlFilePath, 'utf8');
    const $ = cheerio.load(htmlContent);

    const sections = [];
    const seenCourses = new Set();
    const completedCourses = [];
    const inProgressCourses = [];

    $('#auditRequirements .requirement').each((_i, reqEl) => {
      const $req = $(reqEl);
      const status = getReqStatus($req);

      const rawTitle = $req.find('.reqTitle').first().text().trim();
      const rawHeader = $req.find('.reqHeader').first().text().trim();
      const title = cleanText(rawTitle || rawHeader);

      if (!title) return;

      const subrequirements = [];

      $req.find('.auditSubrequirements > .subrequirement').each((_j, subEl) => {
        const $sub = $(subEl);
        const subTitle = cleanText($sub.find('.subreqTitle').first().text().trim());
        const subStatus = getSubStatus($sub);

        const courses = [];
        $sub.find('.completedCourses tr.takenCourse').each((_k, courseEl) => {
          const $course = $(courseEl);
          const isInProgress = $course.hasClass('ip');
          const term = $course.find('.term').text().trim();
          const courseId = normalizeCourseId($course.find('.course').text().trim());
          const credits = parseFloat($course.find('.credit').text().trim()) || 0;
          const grade = $course.find('.grade').text().trim();
          const description = $course.find('.descLine').text().trim();

          if (!courseId) return;

          courses.push({ term, courseId, credits, grade, description, isInProgress });

          // Deduplicate for the flat lists
          const key = `${term}-${courseId}`;
          if (!seenCourses.has(key)) {
            seenCourses.add(key);
            if (isInProgress) {
              inProgressCourses.push({ term, courseId, credits, grade, description });
            } else {
              completedCourses.push({ term, courseId, credits, grade, description });
            }
          }
        });

        subrequirements.push({ title: subTitle, status: subStatus, courses });
      });

      // Flat items list for backward compatibility
      const items = subrequirements.flatMap(sub =>
        sub.courses.map(c =>
          `${c.term} ${c.courseId} ${c.grade}${c.isInProgress ? ' (WIP)' : ''}`
        )
      );

      sections.push({ title, status, subrequirements, items });
    });

    return {
      sections,
      completed_courses: completedCourses,
      current_courses: inProgressCourses,
      metadata: {
        totalSections: sections.length,
        fulfilledSections: sections.filter(s => s.status === 'fulfilled').length,
        inProgressSections: sections.filter(s => s.status === 'in_progress').length,
        notFulfilledSections: sections.filter(s => s.status === 'not_fulfilled').length,
        completedCourseCount: completedCourses.length,
        inProgressCourseCount: inProgressCourses.length,
        parseTimestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error('[ERROR] HTML parsing failed:', error);
    return {
      sections: [],
      completed_courses: [],
      current_courses: [],
      metadata: { error: error.message, parseTimestamp: new Date().toISOString() },
    };
  }
}

function getReqStatus($req) {
  if ($req.hasClass('Status_OK')) return 'fulfilled';
  if ($req.hasClass('Status_NO')) return 'not_fulfilled';
  if ($req.hasClass('Status_IP')) return 'in_progress';
  return 'none';
}

function getSubStatus($sub) {
  const $status = $sub.find('.subreqPretext .status').first();
  if ($status.hasClass('Status_OK')) return 'fulfilled';
  if ($status.hasClass('Status_NO')) return 'not_fulfilled';
  if ($status.hasClass('Status_IP')) return 'in_progress';
  return 'none';
}

function normalizeCourseId(raw) {
  // Collapse whitespace first, then insert a space between department letters
  // and course number if one is missing (e.g. "COGS150" -> "COGS 150")
  return raw.replace(/\s+/g, ' ').trim().replace(/([A-Za-z])(\d)/, '$1 $2');
}

function cleanText(str) {
  return str.replace(/\s+/g, ' ').replace(/\n/g, ' ').trim();
}
