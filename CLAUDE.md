# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Architecture

AIVac is a course planning application with three main components:

1. **Python FastAPI Backend** (`/app/`) - RAG-based chat assistant using LangGraph, OpenAI, and Pinecone for course recommendations
2. **Express.js API Server** (`/mern/server/`) - Handles course search, chat routing, the upcoming-term schedule feed, and Sheets export. Auth and saved planner state live in Supabase, not here. There is **no** audit-upload endpoint: the degree audit is parsed entirely in the browser by `SidebarAuditTracker.jsx`, and the unused server-side copy (`parseHtmlAuditSections.js` + `routes/upload.js`) was deleted.
3. **React Frontend** (`/mern/client/`) - Vite + React app with drag-and-drop course planner interface

### Frontend Structure
- **MainLayout**: Core layout with three-page navigation (planner, storage, quarter view)
- **CoursePlannerContainer**: Manages drag-and-drop 4-year course schedule state (4 years × 3 terms)
- **RightSidebar**: Course search and AI chat assistant
- **Auth + persistence (Supabase)**: Google-only sign-in via Supabase Auth (`AuthContext` wraps `supabase.auth`); saved plans in the `planner_states` table (JSONB, row-level security — schema in `/supabase/setup.sql`). Client needs `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in `mern/client/.env` (see `.env.example`); without them the app runs signed-out with localStorage persistence only. MainLayout writes `{schedule, parsedCourseData}` to localStorage synchronously on every edit (so starting OAuth can't lose the latest change) and to Supabase on an 800ms debounce when signed in. Every local write is stamped with the `ownerId` that made it, and `utils/plannerStateStore.js` owns the reconciliation: a blob belonging to a *different* account is never applied and never uploaded, an anonymous blob is only adopted when the account has no plan of its own, and logout clears the device-local keys. That replaced a rule where whatever sat in localStorage was pushed onto the signing-in account — on a shared machine the second person to sign in inherited the first person's plan *and* their degree audit. A fresh audit upload bumps `auditUploadKey` so only real uploads rebuild the grid (restores don't).
- **CourseStorage (Storage tab)**: named snapshots of the planner grid. Saving happens in the planner (`planner/SavePlanControl.jsx`, the toolbar above Year 1); the Storage tab is the library — load/rename/overwrite/delete. Stored in the `saved_plans` table when signed in (many rows per user, RLS) and in `localStorage["tp_saved_plans"]` when signed out; the routing lives in `utils/savedPlans.js`. Loading a snapshot flows through MainLayout's `restoredPlan`, the same path as a session restore.
- **LeftSidebar**: Navigation and course progress tracking
- Course data stored in JSON files in `/src/jsons/` (multiple user profiles)

### Backend Structure
- FastAPI app provides `/chat` endpoint. When the frontend sends audit/schedule context (or Pinecone isn't configured), it routes to the planner agent; otherwise the Pinecone RAG chat.
- **Planner agent** (`app/planner_agent.py`): an LLM tool loop (capped at 12 model round-trips; one round may batch several tool calls) over catalog/section tools — `SearchCourses`, `LookupCourses`, `LookupLiveSections`, `LoadSectionOptions`, `CheckSectionSelection`, `ProposeSectionSelection`, `CheckPlan`, `ProposeSchedule`. The system prompt pre-seeds catalog entries for every course mentioned in the audit/message/grid plus their transitive prereq closure (BFS, capped at 120), each with structured prereq groups and `unlocks`. `check_coverage` mirrors the client's `auditProgress.js` requirement projection (NEEDS/Available parsing, structured `subrequirements` preferred) so CheckPlan warns the model — and the student — when a plan leaves an audit requirement short; keep the two implementations in sync. Validation severity: errors (nonexistent course, duplicate, past term, already completed per graded audit line) block placement; warnings (offerings mismatch, unsatisfied prereq) place but surface to the student. Every accepted proposal is re-validated server-side in `_accept` — the agent is never trusted to have checked. Each turn appends loop cost to `app/data/planner_loop_metrics.jsonl` and returns top-level `agent_loop` on `/chat`; aggregates at `GET /planner-metrics` (`avg_llm_rounds`, cap-hit rate, histogram). Tests: `cd app && python3 -m pytest tests/`.
- **Catalog + prereqs** (`app/catalog.py`): loads `mern/server/controllers/v5.json` (with cross-listing alias resolution, so "DSC 80" finds "DSC 80/80R") and `prereq_graph.json` — the CNF prereq graph built by `mern/server/scripts/build-prereq-graph.mjs`; keep `aliases_for` in sync with `scripts/lib/course-ids.mjs`. `v5.json` is assembled by `scripts/build-catalog.mjs` from the General Catalog scrape; courses UCSD teaches but hasn't published there (CCE 110/120) are hand-written in `scripts/data/catalog-supplement.json` and folded in, each entry ignored automatically once the real catalog listing appears.
- **Upcoming term (who actually teaches next quarter)**: `scripts/scrape-upcoming-term.mjs` reads UCSD's own Class Planner API at `classplanner.apps.ucsd.edu/api/v1` — **public and unauthenticated**, serving the live term's courses, instructors, sections, meeting times and seat counts (`/planner/terms`, then POST `/catalog/courses/search` with `offset`/`limit`, max 48/page). This is the only source for the upcoming quarter: catalog.ucsd.edu never names instructors and legacy act.ucsd.edu ends at SU26 (`subject-list.json?selectedTerm=FA26` returns `[]`). It does **not** expose anything student-specific, so the booking-bridge SSO constraint still holds for enrollment — what it removes is the assumption that read-only schedule data needs a student session. Output: `scripts/data/upcoming-term.json`, whose `courses` map (`"CSE 100": [section, ...]`) deliberately mirrors the Supabase `term_sections` shape so existing consumers need no changes. Express serves it at **`GET /next-quarter`** ([routes/nextQuarter.js](mern/server/routes/nextQuarter.js)), filling in `units` from `v5.json` since Class Planner carries no unit count. The client (in `utils/nextQuarterOfferings.js`) reads this endpoint as its source of truth, with a single dormant fallback — the last admin-published Supabase row — kept for the day UCSD gates Class Planner; the extension is no longer part of the schedule read path at all (fully migrated Aug 11 2026 after verifying Class Planner tracks TSS live — a seat taken between a TSS capture and a Class Planner read showed up on Class Planner first). The snapshot re-scrapes itself on a schedule: `lib/refreshScheduler.js` spawns the scraper every `intervalHours` (persisted in `scripts/data/refresh-config.json`, default 24h, 0 = manual-only) and hot-reloads the route's copy. Admins control it from Admin → Section data (`ScheduleFeedCard`) via `GET /next-quarter/refresh-status` (public) plus admin-gated `POST /next-quarter/refresh` and `PUT /next-quarter/refresh-config`. "Admin" is the existing Supabase `app_admins` row: `lib/adminAuth.js` verifies the client's Bearer token against `/auth/v1/user` then reads the caller's own `app_admins` row (RLS-safe, no service key), resolving SUPABASE_URL/ANON_KEY from env or the client's `.env`. Seat counts have **two clocks that must not be conflated**: `source_refreshed_at` is UCSD's catalog rebuild (sits frozen for a day+), `scraped_at` is when our snapshot was taken — and seats follow *neither*, drifting continuously upstream (measured 22% of sections in ~21h while `last_full_refresh_at` never moved). So the snapshot's seat numbers are indicative only (`seatsIndicative: true` on the response); **`GET /next-quarter/seats?courses=CSE 100,BILD 1`** proxies a targeted `course_key` query to Class Planner for current counts (30s server cache, ≤24 courses/request, falls back to snapshot numbers with `stale: true` if UCSD is unreachable). The client's `syncLiveSeats` (and the quarter view's `refreshLiveSections`) hit this proxy first for everyone; the extension's TSS session is consulted only if the proxy fails (`overlayLiveSeats` patches seat fields onto snapshot sections by `sectionRef` without touching times/instructors — deliberately not `mergeSectionMaps`, which swaps whole lists). Extension scrapes are no longer merged over the shared context's sections. The one place TSS remains authoritative is the act of booking itself — the extension's remaining job.
- **Professor ratings**: `v5.json`'s `professors` field is a join of two scrapes, both re-runnable. `scripts/scrape-professors-rmp.mjs` pulls all ~4,000 UCSD RateMyProfessors pages from RMP's own GraphQL endpoint (re-run any time ratings drift). `scripts/scrape-instructors.mjs` harvests who actually taught each course from the legacy Schedule of Classes — same dying source and same urgency as `scrape-offerings.mjs`, since nothing else publicly maps courses to instructors. `build-catalog.mjs` joins them via `scripts/lib/professor-names.mjs`, which matches on surname plus a compatible given name (exact, short-form, or nickname) and never on surname alone. Two rules there are load-bearing, both with real examples in the file's header: an unrated RMP page loses to a rated short-form match (`Porter, Leonard Emerson` must resolve to *Leo* Porter's 45 ratings, not the empty `Leonard Porter` stub), and an instructor with no page yields `null` rather than a surname guess (`Weng, Olivia` must not pick up Lily Weng's ratings). Courses not taught in the harvested window keep their previous professors instead of dropping to empty. Precedence per course is upcoming term → historical join → previous v5, recorded on each course as `professors_source` (a term code like `"FA26"` when it is next quarter's confirmed staff, `"historic"` otherwise). `CourseDetails.jsx` reads that field to title the section "Professors (FA26)" or to warn that the instructor is inferred from past offerings and may differ — keep the two in sync. Upcoming-term instructors with no RMP page are still listed by name via `toV5Unrated` (`profile_link: null`, which `ProfessorInfo.jsx` hides), since dropping them would imply nobody teaches the course.
- Express server provides course search API and chat proxy
- RAG system uses Pinecone vector store with OpenAI embeddings for course recommendations

## Development Commands

### Frontend (React + Vite)
```bash
cd mern/client
npm install
npm run dev      # Start development server
npm run build    # Build for production
npm run lint     # Run ESLint
```

### Express Server
```bash
cd mern/server
npm install
npm run start    # Start server (production)
# No dev script - use 'node server.js' for development
```

### Python FastAPI Backend
```bash
cd app
pip install --upgrade -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

## Configuration Notes

- Express server expects `config.env` file with MongoDB connection (currently not used)
- Python backend requires OpenAI API key and Pinecone credentials in environment
- Frontend uses hardcoded course data from JSON files instead of database

## Testing

- Planner agent + audit requirements: `cd app && python3 -m pytest tests/`
- Client utils: `cd mern/client && node --test src/utils/*.test.mjs`
- Server catalog/recommendations: `cd mern/server && node --test controllers/*.test.mjs`
  (must run from `mern/server` — the controller resolves `v5.json` relative to cwd)
- Cypress E2E tests configured in `/mern/client/cypress/`
- Run tests with: `npx cypress open` (from client directory)