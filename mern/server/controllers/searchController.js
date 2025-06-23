
import fs from "fs";
import path from "path";

// Load and parse course data JSON (v5 = v4 data + v3 credits)
const courseDataPath = path.resolve("./controllers/v5.json");

let allCourses = [];
try {
  allCourses = JSON.parse(fs.readFileSync(courseDataPath, "utf-8"));
} catch (err) {
  console.error("❌ Failed to load course data:", err);
}

function normalizeCourseID(query) {
  return query.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}
export function searchCourses(query) {
  const normalized = normalizeCourseID(query);
  const queryLower = query.toLowerCase();

  if (!queryLower) return [];

  // Exact match by normalized course ID
  const exactMatch = allCourses.find(
    course => course.normalized_course_id?.toLowerCase() === normalized
  );

  // Courses that start with the normalized string (including the exact match again)
  const prefixMatches = allCourses.filter(course =>
    course.normalized_course_id?.toLowerCase().startsWith(normalized)
  );

  // Course name partial matches
  const nameMatches = allCourses.filter(course =>
    course.course_name?.toLowerCase().includes(queryLower)
  );

  // Combine all, with exactMatch at the beginning (if found)
  const combined = [
    ...(exactMatch ? [exactMatch] : []),
    ...prefixMatches,
    ...nameMatches,
  ];

  // Deduplicate by course_id
  const unique = Array.from(new Map(combined.map(c => [c.course_id, c])).values());

  return unique;
}
