import { supabase } from "./supabase";

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5050";

// VITE_* values are inlined at BUILD time. A production bundle built without
// VITE_API_URL silently falls back to localhost, so every request goes to the
// visitor's own machine: course search, the schedule and the assistant all
// return nothing, with no error that points at the cause. Say so loudly —
// this is the single most common way a deploy of this app is broken.
if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
  console.error(
    "[TritonPlanner] VITE_API_URL was not set when this bundle was built, so " +
      "API calls default to http://localhost:5050 and will fail. Set it in " +
      "the hosting provider's environment variables and REDEPLOY — changing " +
      "it without rebuilding has no effect."
  );
}

// Fire-and-forget: wake the FastAPI planner so the first chat turn is not the
// request that pays for a Render cold start.
export function wakePlanner() {
  return fetch(`${API_URL}/planner-wake`).catch(() => {});
}

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
    if (!supabase) throw new Error("Supabase is not configured");
    if (!userId) throw new Error("Missing user id for planner save");
    const { error } = await supabase.from("planner_states").upsert(
      {
        user_id: userId,
        data: state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    if (error) throw new Error(error.message);
  },
};
