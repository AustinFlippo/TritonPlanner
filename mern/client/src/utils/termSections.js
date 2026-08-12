// The shared course schedule: meeting times, instructors and rooms for a whole
// term, refreshed by an admin and read by everyone.
//
// Why this exists: TSS is behind SSO + Duo, so a student can only read it with
// their own signed-in browser plus the extension. But the schedule is identical
// for everyone, so making each student fetch it is both wasteful and a barrier.
// One admin publishes it here; every planner reads it with no extension and no
// TSS login — the table is readable while signed out.
//
// Seat counts are NOT authoritative here. They move by the minute during
// enrollment, so a cached number misleads. Whatever was captured at publish time
// is kept for reference, and `refreshedAt` is the honest age of it; live counts
// come from the student's own session.

import { supabase } from "./supabase";

const rowId = (year, term) => `${year}-${String(term).toLowerCase()}`;

/**
 * Read the published schedule for one term.
 *
 * Returns null when nothing has been published yet, or when Supabase isn't
 * configured — callers treat both as "no shared data", not as an error.
 */
export async function fetchPublishedTerm(year, term) {
  if (!supabase || !year || !term) return null;
  const { data, error } = await supabase
    .from("term_sections")
    .select("id, year, term, courses, course_count, section_count, truncated, refreshed_at")
    .eq("id", rowId(year, term))
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    year: data.year,
    term: data.term,
    courses: data.courses || {},
    courseCount: data.course_count,
    sectionCount: data.section_count,
    truncated: data.truncated,
    refreshedAt: data.refreshed_at ? new Date(data.refreshed_at).getTime() : null,
  };
}

/** Metadata for every published term, newest first. Used by the admin page. */
export async function listPublishedTerms() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("term_sections")
    .select("id, year, term, course_count, section_count, truncated, refreshed_at")
    .order("refreshed_at", { ascending: false });

  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    year: row.year,
    term: row.term,
    courseCount: row.course_count,
    sectionCount: row.section_count,
    truncated: row.truncated,
    refreshedAt: row.refreshed_at ? new Date(row.refreshed_at).getTime() : null,
  }));
}

/**
 * Publish a term, replacing whatever was there.
 *
 * Upsert rather than insert: a term is refreshed repeatedly as departments
 * adjust rooms and add sections, and keeping one row per term means readers
 * never have to work out which copy is current.
 *
 * Blocked by row-level security unless the caller is in `app_admins`, so a
 * signed-in student cannot overwrite the schedule for everyone.
 */
export async function publishTerm({ year, term, courses, truncated = false }) {
  if (!supabase) return { ok: false, reason: "Supabase is not configured" };

  const courseCount = Object.keys(courses || {}).length;
  const sectionCount = Object.values(courses || {}).reduce(
    (total, list) => total + (list?.length || 0),
    0
  );
  if (!courseCount) return { ok: false, reason: "nothing to publish" };

  // Read what's there before overwriting it, so the report can say what changed
  // rather than just how big the new copy is. "1,847 courses" looks identical
  // whether the refresh worked or silently returned the same data twice; "+12
  // courses, 340 seat counts changed" does not.
  const previous = await fetchPublishedTerm(year, term);
  const before = previous?.courses || {};
  const seatKey = (s) => `${s.courseId}|${s.sectionId}|${s.component}`;
  const previousSeats = new Map();
  for (const list of Object.values(before)) {
    for (const section of list || []) previousSeats.set(seatKey(section), section.seatsAvailable);
  }

  let withSeats = 0;
  let open = 0;
  let full = 0;
  let seatsChanged = 0;
  for (const list of Object.values(courses)) {
    for (const section of list || []) {
      if (!Number.isFinite(section.seatsAvailable)) continue;
      withSeats += 1;
      if (section.seatsAvailable > 0) open += 1;
      else full += 1;
      const was = previousSeats.get(seatKey(section));
      if (Number.isFinite(was) && was !== section.seatsAvailable) seatsChanged += 1;
    }
  }

  const newCourses = Object.keys(courses).filter((id) => !(id in before)).length;
  const goneCourses = Object.keys(before).filter((id) => !(id in courses)).length;

  const { data: session } = await supabase.auth.getUser();
  const { error } = await supabase.from("term_sections").upsert(
    {
      id: rowId(year, term),
      year: String(year),
      term: String(term).toLowerCase(),
      courses,
      course_count: courseCount,
      section_count: sectionCount,
      truncated,
      refreshed_at: new Date().toISOString(),
      refreshed_by: session?.user?.id || null,
    },
    { onConflict: "id" }
  );

  if (error) {
    // RLS rejects non-admins with a policy violation; say which it is rather
    // than showing a raw Postgres error.
    const isPolicy = /row-level security|policy/i.test(error.message || "");
    return {
      ok: false,
      reason: isPolicy
        ? "Your account isn't an admin, so it can't publish the schedule."
        : error.message,
    };
  }
  return {
    ok: true,
    courseCount,
    sectionCount,
    // What actually changed, not just how big the result is.
    firstPublish: !previous,
    newCourses,
    goneCourses,
    withSeats,
    withoutSeats: sectionCount - withSeats,
    open,
    full,
    seatsChanged,
    previousRefreshedAt: previous?.refreshedAt ?? null,
  };
}

/** Is the signed-in user allowed to publish? */
export async function isAdmin() {
  if (!supabase) return false;
  const { data: session } = await supabase.auth.getUser();
  if (!session?.user) return false;
  const { data, error } = await supabase
    .from("app_admins")
    .select("user_id")
    .eq("user_id", session.user.id)
    .maybeSingle();
  return Boolean(!error && data);
}
