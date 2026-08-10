// Named snapshots of the planner grid, shown on the Storage page.
//
// Signed in  -> Supabase `saved_plans` table (many rows per user, RLS-scoped)
// Signed out -> localStorage, so the feature still works before sign-in
//
// This is separate from `planner_states`, which holds the single *live* plan
// that auto-saves as the user edits.

import { supabase } from "./supabase";

const LOCAL_KEY = "tp_saved_plans";
const TERMS = ["fall", "winter", "spring"];

const newId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const fromRow = (row) => ({
  id: row.id,
  name: row.name,
  schedule: row.schedule,
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

export const planStats = (schedule) => {
  let courses = 0;
  let units = 0;
  (schedule || []).forEach((year) => {
    TERMS.forEach((term) => {
      (year?.[term] || []).forEach((course) => {
        if (!course) return;
        courses += 1;
        units += Number(course.credits) || 0;
      });
    });
  });
  return { courses, units };
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
  return readLocal().sort(byNewest);
};

export const createSavedPlan = async (user, name, schedule) => {
  const trimmed = name.trim();
  if (isRemote(user)) {
    const { data, error } = await supabase
      .from("saved_plans")
      .insert({ user_id: user.id, name: trimmed, schedule })
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
  if (patch.schedule !== undefined) changes.schedule = patch.schedule;

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
    ...(patch.schedule !== undefined ? { schedule: patch.schedule } : {}),
    updatedAt: now,
  };
  plans[index] = updated;
  writeLocal(plans);
  return updated;
};

export const deleteSavedPlan = async (user, id) => {
  if (isRemote(user)) {
    const { error } = await supabase.from("saved_plans").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return;
  }
  writeLocal(readLocal().filter((p) => p.id !== id));
};
