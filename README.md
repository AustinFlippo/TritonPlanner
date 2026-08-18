# TritonPlanner

UCSD course planning app: upload a degree audit, build a 4-year schedule, search the catalog, chat with a planner agent, and (optionally) book the upcoming quarter via the Chrome extension.

## Architecture

| Piece | Path | Port | Role |
|---|---|---|---|
| React client | `mern/client/` | 5173 | Planner UI, audit parsing, auth |
| Express API | `mern/server/` | 5050 | Course search, chat proxy, `/next-quarter` feed, Sheets export |
| FastAPI | `app/` | 8000 | Planner agent + optional Pinecone RAG chat |
| Supabase | `supabase/` | — | Google auth, saved plans (`planner_states`, `saved_plans`) |
| Booking bridge | `booking-bridge/` | — | Chrome extension for TSS enrollment |

Degree audits are parsed entirely in the browser. Auth and planner persistence live in Supabase (RLS), not Express. Without Supabase env vars the app still runs signed-out with localStorage only.

## Local development

Three terminals. Node ≥ 20.

### 1. FastAPI (port 8000)

```bash
cd app
cp ../.env.template .env   # fill OPENAI_API_KEY at minimum
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
# or: python start_server.py
```

Pinecone keys are optional — without them `/chat` uses the planner agent path.

### 2. Express (port 5050)

```bash
cd mern/server
npm install
npm run start              # node server.js — there is no `dev` script
```

Must be started from `mern/server` so catalog and upcoming-term paths resolve. Optional: `FASTAPI_URL`, `CORS_ORIGINS`, Google service-account path for Sheets export. Admin section-data controls also need `SUPABASE_URL` / `SUPABASE_ANON_KEY` (or the matching `VITE_*` values in `mern/client/.env`).

### 3. React (port 5173)

```bash
cd mern/client
cp .env.example .env       # optional: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Open http://localhost:5173.

| Check | URL |
|---|---|
| App | http://localhost:5173 |
| Express | http://localhost:5050 |
| FastAPI health | http://localhost:8000/health |
| FastAPI docs | http://localhost:8000/docs |

## Configuration

- **Root** [`.env.template`](.env.template) — OpenAI / Pinecone / LLM models for FastAPI (copy into `app/.env`).
- **Client** [`mern/client/.env.example`](mern/client/.env.example) — Supabase URL + anon key.
- **Schema** — run [`supabase/setup.sql`](supabase/setup.sql), then [`supabase/term_sections.sql`](supabase/term_sections.sql). Enable Google under Auth → Providers; keep **both** `http://localhost:5173` and the public site on the redirect allowlist (see [`DEPLOYMENT.md`](DEPLOYMENT.md)).

MongoDB / `config.env` are legacy and unused.

## Testing

```bash
cd app && python3 -m pytest tests/
cd mern/client && node --test src/utils/*.test.mjs
cd mern/server && node --test controllers/*.test.mjs   # cwd must be mern/server
```

Cypress E2E: `cd mern/client && npx cypress open`.

## More docs

- [`DEPLOYMENT.md`](DEPLOYMENT.md) — Render + Supabase production setup
- [`DOCUMENTATION/`](DOCUMENTATION/) — component-level notes
- [`booking-bridge/README.md`](booking-bridge/README.md) — TSS booking extension
- [`CLAUDE.md`](CLAUDE.md) — deep architecture for contributors / agents
