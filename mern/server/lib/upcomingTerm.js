// The live upcoming-term snapshot (scripts/scrape-upcoming-term.mjs), read
// off disk for anyone on the server who needs to know what UCSD is actually
// teaching next quarter — not just the /next-quarter route.
//
// The search controller uses it to treat a course that is on the live
// schedule but absent from the General Catalog (DSC 152 in SP26) as a real,
// findable course rather than an "unverified" stub: Class Planner confirms it
// exists, names it, and says who teaches it. What it does NOT carry is a unit
// count or prerequisites, so those stay unknown.
//
// Re-reads when the file's mtime changes, so a scheduler refresh (which
// rewrites the file in place) is picked up without a restart.
import fs from "fs";
import path from "path";

const upcomingPath = path.resolve("./scripts/data/upcoming-term.json");

let cache = { mtime: null, data: null };

/** Parsed snapshot ({ termCode, term, year, courses }) or null when absent. */
export function loadUpcomingTerm() {
  let mtime = null;
  try {
    mtime = fs.statSync(upcomingPath).mtimeMs;
  } catch {
    cache = { mtime: null, data: null };
    return null;
  }
  if (cache.mtime === mtime) return cache.data;
  let data = null;
  try {
    const raw = JSON.parse(fs.readFileSync(upcomingPath, "utf-8"));
    const courses = raw?.courses;
    const termCode = raw?.term_code || raw?.termCode;
    if (courses && typeof courses === "object" && termCode) {
      data = {
        termCode: String(termCode).toUpperCase(),
        term: raw.term || null,
        year: raw.year != null ? String(raw.year) : null,
        courses,
      };
    }
  } catch {
    data = null;
  }
  cache = { mtime, data };
  return data;
}

const tidyName = (s) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * One row per course on the live schedule:
 *   { course_id, course_name, instructors: string[], termCode }
 * course_name is the first non-empty Class Planner title; instructors are
 * de-duplicated, in first-seen order, with TBA-style placeholders dropped.
 */
export function liveCourseSummaries(snapshot = loadUpcomingTerm()) {
  if (!snapshot) return [];
  const out = [];
  for (const [courseId, sections] of Object.entries(snapshot.courses)) {
    let name = "";
    const instructors = [];
    for (const s of sections || []) {
      if (!name && s?.courseName) name = tidyName(s.courseName);
      const who = tidyName(s?.instructor);
      if (who && !/^(staff|tba|to be announced)$/i.test(who) && !instructors.includes(who)) {
        instructors.push(who);
      }
    }
    out.push({
      course_id: tidyName(courseId).toUpperCase(),
      course_name: name,
      instructors,
      termCode: snapshot.termCode,
    });
  }
  return out;
}
