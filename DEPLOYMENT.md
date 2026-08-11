# Deploying TritonPlanner

Three deployable pieces plus Supabase:

| Piece | Where | Root directory |
|---|---|---|
| React client | Vercel | `mern/client` |
| Express API | Render (Web Service, Node) | `mern/server` |
| FastAPI planner/RAG | Render (Web Service, Docker) | `app` |
| Auth + saved plans | Supabase | — |

Deploy in this order: **Supabase → FastAPI → Express → Vercel**. Each step needs
the URL of the one before it.

---

## 1. Supabase

1. Apply the schema. In the SQL editor, run **`supabase/setup.sql`** first
   (`planner_states`, `saved_plans`, `quarter_plans`, all with row-level
   security), then **`supabase/term_sections.sql`** (`term_sections`,
   `app_admins`).
2. Enable **Google** under Authentication → Providers.
3. Authentication → URL Configuration:
   - **Site URL** → your Vercel production URL
   - **Redirect URLs** → add `https://<your-app>.vercel.app/**`

   The repo's `supabase/config.toml` only lists `http://localhost:5173`. If you
   skip this, Google sign-in fails in production with a redirect error and
   nothing in your own logs explains why. This is the single most commonly
   missed step.
4. Copy the **Project URL** and **anon public key** from Settings → API.
5. To make yourself an admin (needed for the Admin → Section data controls),
   insert your auth user id into `app_admins`.

The anon key is public by design — it is safe in the client bundle. Row-level
security is what protects the data. Never ship the **service role** key.

---

## 2. FastAPI planner (Render, Docker)

New Web Service → your repo → Runtime **Docker**, Root Directory `app`.
`app/Dockerfile` binds `${PORT:-8000}`, so Render's assigned port works with no
extra configuration.

Environment variables:

| Variable | Required | Notes |
|---|---|---|
| `OPENAI_API_KEY` | yes | planner agent + embeddings |
| `PINECONE_API_KEY` | only for RAG chat | omit and `/chat` uses the planner agent |
| `PINECONE_INDEX_NAME` | only for RAG chat | e.g. `course-embeddings` |
| `ANTHROPIC_API_KEY` | no | only if using Claude models |
| `PLANNER_MODEL` | no | defaults in code |
| `LLM_MODEL` | no | defaults in code |
| `PLANNER_METRICS_DISABLED` | no | set `1` to stop writing the loop-metrics JSONL |

Verify: `GET https://<fastapi>.onrender.com/health` returns `"api": "healthy"`.
`rag_system: failed` with `PINECONE_API_KEY: missing` is expected and fine when
you are not using Pinecone — the planner agent path is unaffected.

Note the container's filesystem is ephemeral. `app/data/planner_loop_metrics.jsonl`
resets on every deploy; that file is telemetry only.

---

## 3. Express API (Render, Node)

New Web Service → Root Directory `mern/server`, Build `npm install`,
Start `node server.js`. Render sets `PORT` and `server.js` honours it.

The server resolves its data files (`controllers/v5.json`,
`scripts/data/upcoming-term.json`) relative to the **working directory**, so it
must be started from `mern/server`. Setting the Root Directory as above does
that. If you instead run `node mern/server/server.js` from the repo root,
`/next-quarter` returns 503 and course search comes back empty.

| Variable | Required | Notes |
|---|---|---|
| `FASTAPI_URL` | yes | the FastAPI URL from step 2, no trailing slash |
| `SUPABASE_URL` | for admin controls | same project URL as the client |
| `SUPABASE_ANON_KEY` | for admin controls | same anon key as the client |
| `OPENAI_API_KEY` | yes | used by the search/recommendation path |
| `CORS_ORIGINS` | recommended | comma-separated browser origins, e.g. `https://your-app.vercel.app` |
| `GOOGLE_SERVICE_ACCOUNT_PATH` | only for Sheets export | see below |

Leave `CORS_ORIGINS` unset and any origin is allowed, which keeps local
development and Vercel preview deployments working. Set it in production: the
catalog data is public, but `/chat` spends OpenAI credits. Requests with no
`Origin` header (curl, health checks, server-to-server) are always allowed —
CORS is a browser control, not an auth boundary.

**Do not set `EXPRESS_PORT` on Render.** It takes precedence over `PORT`, so
setting it makes Render's health check fail.

**Google Sheets export.** Add the service-account JSON as a Render *Secret
File*, then set `GOOGLE_SERVICE_ACCOUNT_PATH` to the absolute path Render gives
it (typically `/etc/secrets/<filename>.json`). Absolute paths are supported.
Skip both if you are not using the export feature.

Verify:
- `GET /next-quarter` → 200 with `courseCount` around 2,100
- `GET /next-quarter/seats?courses=CSE 100` → 200 with live seat counts
- `GET /next-quarter/refresh-status` → 200

### Section-data refresh

`lib/refreshScheduler.js` re-runs the Class Planner scrape every
`intervalHours` (default 24, `0` = manual only) and rewrites
`scripts/data/upcoming-term.json`. Render's disk is ephemeral, so those writes
are lost on redeploy — which is fine, because the committed snapshot ships with
the code and the scheduler runs a catch-up scrape on boot when it is stale.

Admins control cadence from **Admin → Section data**.

---

## 4. React client (Vercel)

New Project → **leave Root Directory at the repository root.** Do *not* set it
to `mern/client`.

The committed `vercel.json` drives the build:

```json
"buildCommand": "cd mern/client && npm install && npm run build",
"outputDirectory": "mern/client/dist"
```

This matters. Four client files import `../../../../booking-bridge/core/*.js`,
which reaches outside `mern/client`:

- `context/NextQuarterOfferingsContext.jsx`
- `components/QuarterlyView.jsx`
- `components/AdminSectionData.jsx`
- `utils/sectionPackages.js`

Pointing the Root Directory at `mern/client` can exclude `booking-bridge/` from
the build context, and the build then fails on unresolved imports. Building
from the repo root keeps the sibling package available. A local
`npm run build` inside `mern/client` succeeds either way — the sibling is on
disk — so it does **not** prove the deploy will work.

Only one route exists (`/`), so no SPA rewrite rule is needed.

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_URL` | yes | the Express URL from step 3, no trailing slash |
| `VITE_SUPABASE_URL` | yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | yes | Supabase anon public key |

**These are read at build time, not runtime.** Changing one in the Vercel
dashboard does nothing until you redeploy. If the app loads but every course
list is empty, `VITE_API_URL` was missing or wrong when the bundle was built —
a production bundle built without it falls back to `http://localhost:5050`, so
every request goes to the visitor's own machine. The bundle now logs an
explicit console error in that case instead of failing silently.

Without the two Supabase variables the app still runs — signed out, with
localStorage persistence only.

---

## 5. Post-deploy checks

1. App loads, header shows **Sign in with Google**.
2. Course search returns results (proves `VITE_API_URL` reached Express).
3. The search panel reads "Shared schedule · Fall 2026 · ~2,100 courses"
   (proves `/next-quarter` works).
4. Sign in with Google completes and returns to the app (proves the Supabase
   redirect allowlist).
5. Ask the assistant "What are the prerequisites for CSE 100?" (proves
   Express → FastAPI).
6. Build a plan, reload, confirm it persists.
7. Confirm responses are compressed:
   `curl -s -o /dev/null -H "Accept-Encoding: gzip" -D - https://<express>/next-quarter | grep -i content-encoding`
   should print `content-encoding: gzip`. Without it that endpoint ships ~3.5 MB
   instead of ~220 KB.

---

## Rebuilding course data

Only needed when refreshing catalog data; the built artifacts are committed.
Run from `mern/server`, in order:

```bash
node scripts/scrape-catalog.mjs        # General Catalog -> data/catalog-scrape.json
node scripts/scrape-offerings.mjs      # legacy Schedule of Classes (dying source)
node scripts/scrape-instructors.mjs    # who taught what (same dying source)
node scripts/scrape-professors-rmp.mjs # RateMyProfessors pages
node scripts/build-catalog.mjs         # -> controllers/v5.json
node scripts/build-prereq-graph.mjs    # -> controllers/prereq_graph.json
node scripts/build-cross-listing-aliases.mjs
node scripts/scrape-upcoming-term.mjs  # -> data/upcoming-term.json
```

`scripts/data/offerings-history.json` and `instructors-history.json` are
**irreplaceable** — the legacy Schedule of Classes has no terms past SU26. They
are committed deliberately. Never delete them.
