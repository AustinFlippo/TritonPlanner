// Split chat text into plain spans and course-code mentions so the assistant
// can render catalog-backed chips that drag like Course Search cards.

import { compactCourseId } from "./seatAvailability.js";

const COURSE_RE = /\b([A-Z]{2,6})\s*(\d{1,3}[A-Z]{0,3})\b/gi;

/** Unique normalized course ids mentioned in free text. */
export function extractCourseMentions(text) {
  const ids = [];
  const seen = new Set();
  const src = String(text || "");
  const re = new RegExp(COURSE_RE.source, "gi");
  let m;
  while ((m = re.exec(src))) {
    const id = `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
    const key = compactCourseId(id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }
  return ids;
}

/**
 * Split text into { type: "text"|"course", value } parts.
 * Course values are normalized like "CSE 100".
 */
export function splitCourseMentions(text) {
  const src = String(text ?? "");
  if (!src) return [];
  const parts = [];
  const re = new RegExp(COURSE_RE.source, "gi");
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > last) {
      parts.push({ type: "text", value: src.slice(last, m.index) });
    }
    parts.push({
      type: "course",
      value: `${m[1].toUpperCase()} ${m[2].toUpperCase()}`,
      raw: m[0],
    });
    last = m.index + m[0].length;
  }
  if (last < src.length) {
    parts.push({ type: "text", value: src.slice(last) });
  }
  return parts.length ? parts : [{ type: "text", value: src }];
}

export { compactCourseId };
