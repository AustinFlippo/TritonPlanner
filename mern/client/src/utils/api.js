import { supabase } from "./supabase";

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5050";

// Saved planner state lives in Supabase Postgres (planner_states table,
// row-level security scopes every query to the signed-in user)
export const api = {
  loadPlannerState: async () => {
    const { data, error } = await supabase
      .from("planner_states")
      .select("data, updated_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { data: data?.data ?? null, updatedAt: data?.updated_at ?? null };
  },

  savePlannerState: async (userId, state) => {
    const { error } = await supabase.from("planner_states").upsert({
      user_id: userId,
      data: state,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  },
};
