// Express-side admin check, reusing the app's one and only admin concept: a
// row in Supabase `app_admins` (see supabase/term_sections.sql).
//
// The client sends the signed-in user's Supabase access token as a Bearer
// header. This verifies it in two steps, both with the user's OWN token —
// no service-role key on the server:
//   1. /auth/v1/user      -> is the token a live session? whose?
//   2. /rest/v1/app_admins -> does that user have an admin row? (RLS lets a
//      user read exactly their own row, so a non-admin simply gets [].)
//
// Config resolution: SUPABASE_URL / SUPABASE_ANON_KEY from the server env,
// falling back to parsing the client's .env for the VITE_ values — same
// project, same publishable key, one less thing to duplicate.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

function fromClientEnv(name) {
  try {
    const text = fs.readFileSync(path.join(here, "..", "..", "client", ".env"), "utf-8");
    const m = text.match(new RegExp(`^${name}=(.+)$`, "m"));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

const SUPABASE_URL =
  process.env.SUPABASE_URL || fromClientEnv("VITE_SUPABASE_URL");
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || fromClientEnv("VITE_SUPABASE_ANON_KEY");

export const adminAuthConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

async function isAdminToken(token) {
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers });
  if (!userRes.ok) return false;
  const user = await userRes.json();
  if (!user?.id) return false;

  const adminRes = await fetch(
    `${SUPABASE_URL}/rest/v1/app_admins?select=user_id&user_id=eq.${user.id}`,
    { headers },
  );
  if (!adminRes.ok) return false;
  const rows = await adminRes.json();
  return Array.isArray(rows) && rows.length > 0;
}

/** Express middleware: 401 without a valid session, 403 without an admin row. */
export async function requireAdmin(req, res, next) {
  if (!adminAuthConfigured) {
    return res.status(503).json({
      error:
        "Admin auth is not configured on this server (needs SUPABASE_URL + SUPABASE_ANON_KEY, or the client .env).",
    });
  }
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    return res.status(401).json({ error: "Sign in required." });
  }
  try {
    if (!(await isAdminToken(token))) {
      return res.status(403).json({ error: "Your account isn't an admin." });
    }
  } catch (err) {
    return res.status(502).json({ error: `Could not verify admin: ${err.message}` });
  }
  next();
}
