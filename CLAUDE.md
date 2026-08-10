# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Architecture

AIVac is a course planning application with three main components:

1. **Python FastAPI Backend** (`/app/`) - RAG-based chat assistant using LangGraph, OpenAI, and Pinecone for course recommendations
2. **Express.js API Server** (`/mern/server/`) - Handles course search, chat routing, audit upload, and Sheets export. Auth and saved planner state live in Supabase, not here.
3. **React Frontend** (`/mern/client/`) - Vite + React app with drag-and-drop course planner interface

### Frontend Structure
- **MainLayout**: Core layout with three-page navigation (planner, storage, quarter view)
- **CoursePlannerContainer**: Manages drag-and-drop 4-year course schedule state (4 years × 3 terms)
- **RightSidebar**: Course search and AI chat assistant
- **Auth + persistence (Supabase)**: Google-only sign-in via Supabase Auth (`AuthContext` wraps `supabase.auth`); saved plans in the `planner_states` table (JSONB, row-level security — schema in `/supabase/setup.sql`). Client needs `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in `mern/client/.env` (see `.env.example`); without them the app runs signed-out with localStorage persistence only. MainLayout auto-saves `{schedule, parsedCourseData}` debounced to localStorage always and to Supabase when signed in; on login the account's saved plan wins. A fresh audit upload bumps `auditUploadKey` so only real uploads rebuild the grid (restores don't).
- **CourseStorage (Storage tab)**: named snapshots of the planner grid. Saving happens in the planner (`planner/SavePlanControl.jsx`, the toolbar above Year 1); the Storage tab is the library — load/rename/overwrite/delete. Stored in the `saved_plans` table when signed in (many rows per user, RLS) and in `localStorage["tp_saved_plans"]` when signed out; the routing lives in `utils/savedPlans.js`. Loading a snapshot flows through MainLayout's `restoredPlan`, the same path as a session restore.
- **LeftSidebar**: Navigation and course progress tracking
- Course data stored in JSON files in `/src/jsons/` (multiple user profiles)

### Backend Structure
- FastAPI app provides `/chat` endpoint. When the frontend sends audit/schedule context (or Pinecone isn't configured), it routes to the planner agent; otherwise the Pinecone RAG chat.
- **Planner agent** (`app/planner_agent.py`): an LLM tool loop (capped at 8 model calls) over four tools — `SearchCourses` (ranked keyword/filter search over the full catalog, for discovery), `LookupCourses` (catalog data for specific codes), `CheckPlan` (deterministic validation returned to the model), `ProposeSchedule` (final commit, rejected while error-level issues remain). The system prompt pre-seeds catalog entries for every course mentioned in the audit/message/grid plus their transitive prereq closure (BFS, capped at 120), each with structured prereq groups and `unlocks`. `check_coverage` mirrors the client's `auditProgress.js` requirement projection (NEEDS/Available parsing, structured `subrequirements` preferred) so CheckPlan warns the model — and the student — when a plan leaves an audit requirement short; keep the two implementations in sync. Validation severity: errors (nonexistent course, duplicate, past term, already completed per graded audit line) block placement; warnings (offerings mismatch, unsatisfied prereq) place but surface to the student. Every accepted proposal is re-validated server-side in `_accept` — the agent is never trusted to have checked. Tests: `cd app && python3 -m pytest tests/`.
- **Catalog + prereqs** (`app/catalog.py`): loads `mern/server/controllers/v5.json` (with cross-listing alias resolution, so "DSC 80" finds "DSC 80/80R") and `prereq_graph.json` — the CNF prereq graph built by `mern/server/scripts/build-prereq-graph.mjs`; keep `aliases_for` in sync with `scripts/lib/course-ids.mjs`.
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

- Cypress E2E tests configured in `/mern/client/cypress/`
- Run tests with: `npx cypress open` (from client directory)