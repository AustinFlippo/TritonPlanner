import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Null when the env vars aren't set yet — the app still works signed-out
// (localStorage persistence only) and the sign-in button explains what's missing
export const supabase = url && anonKey ? createClient(url, anonKey) : null;

export const supabaseConfigured = Boolean(supabase);
