// Supabase only honours `redirectTo` when that URL is on the project's
// Redirect URLs allowlist. A miss is rewritten to Site URL (the public site).
//
// Return the origin we started on, with a path so `http://127.0.0.1:5174/`
// matches `http://127.0.0.1:*/**`. Port and host must be whatever the browser
// actually used — Vite often serves 127.0.0.1 and will pick 5174 if 5173 is
// taken; those are different origins from http://localhost:5173.

export const oauthRedirectTo = (loc) => {
  const path = loc.pathname && loc.pathname !== "" ? loc.pathname : "/";
  return `${loc.origin}${path.startsWith("/") ? path : `/${path}`}`;
};
