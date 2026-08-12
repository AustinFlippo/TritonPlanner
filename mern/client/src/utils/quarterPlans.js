// Enrollment-quarter snapshots: the courses + section picks for one term.
//
// These are slices of the live (or named) 4-year plan — not a second parallel
// schedule. Saving captures whatever is in that quarter right now, including
// `enrollment` (package id, professors, meeting times). Loading writes that
// slice back into the matching quarter of the live grid and leaves the other
// eleven quarters alone.
//
// Signed in  -> Supabase `quarter_plans` (RLS-scoped)
// Signed out -> localStorage

import { supabase } from "./supabase";

const LOCAL_KEY = "tp_quarter_plans";

const newId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const fromRow = (row) => ({
  id: row.id,
  name: row.name,
  academicYear: row.academic_year,
  term: row.term,
  yearIndex: row.year_index,
  courses: Array.isArray(row.courses) ? row.courses : [],
  parentPlanId: row.parent_plan_id || null,
  parentPlanName: row.parent_plan_name || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const byNewest = (a, b) => (a.updatedAt < b.updatedAt ? 1 : -1);

const readLocal = () => {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed to read quarter plans:", err);
    return [];
  }
};

const writeLocal = (plans) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(plans));
  } catch (err) {
    console.error("Failed to write quarter plans:", err);
    throw new Error("Couldn't save on this device — storage may be full.");
  }
};

const isRemote = (user) => Boolean(user && supabase);

/** Courses currently sitting in one quarter of the 4-year grid. */
export const coursesInQuarter = (schedule, yearIndex, term) =>
  (schedule?.[yearIndex]?.[term] || []).filter(
    (c) => c && typeof c === "object" && c.course_id
  );

export const quarterPlanStats = (courses) => {
  const list = (courses || []).filter(Boolean);
  const withSections = list.filter((c) => c.enrollment?.packageId).length;
  const units = list.reduce((sum, c) => sum + (Number(c.credits) || 0), 0);
  return { courses: list.length, units, withSections };
};

export const defaultQuarterPlanName = (termLabel) =>
  `${termLabel || "Quarter"} enrollment`;

/**
 * Snapshot payload for one quarter — deep enough that section picks survive
 * without needing TSS at load time for the labels the student already chose.
 */
export const snapshotQuarter = (schedule, yearIndex, term) =>
  coursesInQuarter(schedule, yearIndex, term).map((course) => ({
    course_id: course.course_id,
    course_name: course.course_name || null,
    credits: Number(course.credits) || 0,
    status: course.status || "planned",
    enrollment: course.enrollment
      ? {
          packageId: course.enrollment.packageId,
          instructors: [...(course.enrollment.instructors || [])],
          primarySectionId: course.enrollment.primarySectionId || null,
          primaryComponent: course.enrollment.primaryComponent || null,
          meetings: (course.enrollment.meetings || []).map((m) => ({
            sectionId: m.sectionId || null,
            component: m.component || null,
            days: Array.isArray(m.days) ? [...m.days] : [],
            start: m.start || null,
            end: m.end || null,
            instructor: m.instructor || null,
            location: m.location || null,
          })),
          selectedAt: course.enrollment.selectedAt || null,
        }
      : null,
  }));

export const listQuarterPlans = async (user, { academicYear, term } = {}) => {
  if (isRemote(user)) {
    let query = supabase
      .from("quarter_plans")
      .select(
        "id, name, academic_year, term, year_index, courses, parent_plan_id, parent_plan_name, created_at, updated_at"
      )
      .order("updated_at", { ascending: false });
    if (academicYear) query = query.eq("academic_year", String(academicYear));
    if (term) query = query.eq("term", term);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data || []).map(fromRow);
  }

  return readLocal()
    .filter((p) => {
      if (academicYear && String(p.academicYear) !== String(academicYear)) {
        return false;
      }
      if (term && p.term !== term) return false;
      return true;
    })
    .sort(byNewest);
};

export const createQuarterPlan = async (user, payload) => {
  const name = String(payload.name || "").trim();
  if (!name) throw new Error("Name this quarter plan.");
  const courses = payload.courses || [];
  if (!courses.length) throw new Error("Add courses to this quarter first.");

  if (isRemote(user)) {
    const { data, error } = await supabase
      .from("quarter_plans")
      .insert({
        user_id: user.id,
        name,
        academic_year: String(payload.academicYear),
        term: payload.term,
        year_index: payload.yearIndex,
        courses,
        parent_plan_id: payload.parentPlanId || null,
        parent_plan_name: payload.parentPlanName || null,
      })
      .select(
        "id, name, academic_year, term, year_index, courses, parent_plan_id, parent_plan_name, created_at, updated_at"
      )
      .single();
    if (error) throw new Error(error.message);
    return fromRow(data);
  }

  const now = new Date().toISOString();
  const plan = {
    id: newId(),
    name,
    academicYear: String(payload.academicYear),
    term: payload.term,
    yearIndex: payload.yearIndex,
    courses,
    parentPlanId: payload.parentPlanId || null,
    parentPlanName: payload.parentPlanName || null,
    createdAt: now,
    updatedAt: now,
  };
  writeLocal([plan, ...readLocal()]);
  return plan;
};

export const updateQuarterPlan = async (user, id, patch) => {
  const now = new Date().toISOString();

  if (isRemote(user)) {
    const changes = { updated_at: now };
    if (patch.name !== undefined) changes.name = patch.name.trim();
    if (patch.courses !== undefined) changes.courses = patch.courses;
    if (patch.parentPlanId !== undefined) {
      changes.parent_plan_id = patch.parentPlanId;
    }
    if (patch.parentPlanName !== undefined) {
      changes.parent_plan_name = patch.parentPlanName;
    }
    const { data, error } = await supabase
      .from("quarter_plans")
      .update(changes)
      .eq("id", id)
      .select(
        "id, name, academic_year, term, year_index, courses, parent_plan_id, parent_plan_name, created_at, updated_at"
      )
      .single();
    if (error) throw new Error(error.message);
    return fromRow(data);
  }

  const plans = readLocal();
  const index = plans.findIndex((p) => p.id === id);
  if (index === -1) throw new Error("That quarter plan no longer exists.");
  const updated = {
    ...plans[index],
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.courses !== undefined ? { courses: patch.courses } : {}),
    ...(patch.parentPlanId !== undefined
      ? { parentPlanId: patch.parentPlanId }
      : {}),
    ...(patch.parentPlanName !== undefined
      ? { parentPlanName: patch.parentPlanName }
      : {}),
    updatedAt: now,
  };
  plans[index] = updated;
  writeLocal(plans);
  return updated;
};

export const deleteQuarterPlan = async (user, id) => {
  if (isRemote(user)) {
    const { error } = await supabase.from("quarter_plans").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return;
  }
  writeLocal(readLocal().filter((p) => p.id !== id));
};
