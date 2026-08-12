// Named snapshots of the planner grid, shown on the Storage page.
//
// Signed in  -> Supabase `saved_plans` table (many rows per user, RLS-scoped)
// Signed out -> localStorage, so the feature still works before sign-in
//
// This is separate from `planner_states`, which holds the single *live* plan
// that auto-saves as the user edits. Each named plan owns its full 4-year
// grid, including the upcoming enrollment quarter — Quarter View is a lens
// on that slot of the active plan, not a shared global quarter.

import { supabase } from "./supabase";
import {
  gridBaseYear,
  readStampedGrid,
  stampGrid,
} from "./auditCoursePlanner";
import { hasUnknownCredits, parseCredits } from "./courseCredits";
import { SAVED_PLANS_KEY } from "./plannerStateStore";

const LOCAL_KEY = SAVED_PLANS_KEY;
const TERMS = ["fall", "winter", "spring"];

// New rows wrap the grid as { baseYear, grid } inside the existing `schedule`
// JSONB column, so recording the base year needs no schema change and rows
// written before this still read back fine. See stampGrid.
const packSchedule = stampGrid;
const unpackSchedule = readStampedGrid;

const newId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const fromRow = (row) => {
  const { grid, baseYear } = unpackSchedule(row.schedule);
  return {
    id: row.id,
    name: row.name,
    schedule: grid,
    baseYear,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// Local rows predate baseYear too; normalize so callers see one shape.
const fromLocal = (plan) => ({ ...plan, baseYear: plan?.baseYear ?? null });

const byNewest = (a, b) => (a.updatedAt < b.updatedAt ? 1 : -1);

const readLocal = () => {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed to read saved plans:", err);
    return [];
  }
};

const writeLocal = (plans) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(plans));
  } catch (err) {
    console.error("Failed to write saved plans:", err);
    throw new Error("Couldn't save on this device — storage may be full.");
  }
};

// Remote whenever there's a signed-in user and a configured client
const isRemote = (user) => Boolean(user && supabase);

/**
 * Course / unit summary for a snapshot.
 *
 * `units` counts only courses whose unit value the catalog actually supplies.
 * `unknownUnits` counts the rest separately instead of folding them in as 0 —
 * "12 units" plus a visible "2 unknown" is honest, whereas `Number(x) || 0`
 * turned an audit-vouched course's null (and a sequence's "4-4-4") into a
 * confident zero and understated every total built on it.
 */
export const planStats = (schedule) => {
  let courses = 0;
  let units = 0;
  let unknownUnits = 0;
  (schedule || []).forEach((year) => {
    TERMS.forEach((term) => {
      (year?.[term] || []).forEach((course) => {
        if (!course) return;
        courses += 1;
        if (hasUnknownCredits(course)) unknownUnits += 1;
        else units += parseCredits(course.credits);
      });
    });
  });
  return { courses, units, unknownUnits };
};

export const listSavedPlans = async (user) => {
  if (isRemote(user)) {
    const { data, error } = await supabase
      .from("saved_plans")
      .select("id, name, schedule, created_at, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(fromRow);
  }
  return readLocal().map(fromLocal).sort(byNewest);
};

export const createSavedPlan = async (user, name, schedule) => {
  const trimmed = name.trim();
  if (isRemote(user)) {
    const { data, error } = await supabase
      .from("saved_plans")
      .insert({ user_id: user.id, name: trimmed, schedule: packSchedule(schedule) })
      .select("id, name, schedule, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return fromRow(data);
  }

  const now = new Date().toISOString();
  const plan = {
    id: newId(),
    name: trimmed,
    schedule,
    baseYear: gridBaseYear(),
    createdAt: now,
    updatedAt: now,
  };
  writeLocal([plan, ...readLocal()]);
  return plan;
};

// Patch is { name } and/or { schedule }
export const updateSavedPlan = async (user, id, patch) => {
  const now = new Date().toISOString();
  const changes = { updated_at: now };
  if (patch.name !== undefined) changes.name = patch.name.trim();
  // Re-stamp baseYear with the grid: an overwrite is a fresh snapshot.
  if (patch.schedule !== undefined) changes.schedule = packSchedule(patch.schedule);

  if (isRemote(user)) {
    const { data, error } = await supabase
      .from("saved_plans")
      .update(changes)
      .eq("id", id)
      .select("id, name, schedule, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return fromRow(data);
  }

  const plans = readLocal();
  const index = plans.findIndex((p) => p.id === id);
  if (index === -1) throw new Error("That saved plan no longer exists.");
  const updated = {
    ...plans[index],
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.schedule !== undefined
      ? { schedule: patch.schedule, baseYear: gridBaseYear() }
      : {}),
    updatedAt: now,
  };
  plans[index] = updated;
  writeLocal(plans);
  return fromLocal(updated);
};

export const deleteSavedPlan = async (user, id) => {
  if (isRemote(user)) {
    const { error } = await supabase.from("saved_plans").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return;
  }
  writeLocal(readLocal().filter((p) => p.id !== id));
};
