# JSON Output System — REMOVED (2026-08-11)

This document described a server-side degree-audit upload pipeline
(`POST /upload-degree-audit`, `mern/server/routes/upload.js`,
`mern/server/parseHtmlAuditSections.js`) that wrote parsed JSON snapshots to
`mern/server/parsed-outputs/` and served them back over
`GET /upload-degree-audit/parsed-files`.

**None of it exists any more.** The route had no callers anywhere in the
repository — the live parser has always been the client-side one in
`mern/client/src/components/audit/SidebarAuditTracker.jsx` — and the server
copy was broken in three separate ways (line splitting on a literal `\n`,
a status check that classified "Requirement not complete" as FULFILLED, and a
title heuristic that accepted any 15–100 character string). It also persisted
uploaded audits to disk and returned `error.stack` to the caller.

The degree audit is now parsed entirely in the browser and is never uploaded
anywhere. If you need to inspect what the parser produced, read
`parsedCourseData` in the client (it is what gets persisted to Supabase /
localStorage alongside the plan).

See `DOCUMENTATION/1_DegreeAuditParser.md` for how parsing actually works.
