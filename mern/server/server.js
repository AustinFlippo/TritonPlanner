import express from "express";
import compression from "compression";
import cors from "cors";
import chat from "./routes/chat.js";
import searchRouter from "./routes/search.js";
import exportRouter from "./routes/export.js";
import nextQuarterRouter from "./routes/nextQuarter.js";
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from root .env file
const rootEnvPath = path.join(process.cwd(), '../../.env');
dotenv.config({ path: rootEnvPath });

// Fallback to local config.env if root .env doesn't exist
dotenv.config({ path: './config.env' });


const PORT = process.env.EXPRESS_PORT || process.env.PORT || 5050;
const app = express();

// The term snapshot is a multi-megabyte JSON served on first paint; gzip takes
// it from ~3.5 MB to a few hundred KB. Must come before the routes.
app.use(compression());

// Allowed browser origins, comma-separated (e.g.
// "https://tritonplanner.vercel.app,https://tritonplanner.com").
// Unset = allow any origin, which keeps local development and preview
// deployments working. Set it in production: the catalog data here is public,
// but /chat spends OpenAI credits and the admin routes accept a bearer token,
// so an allowlist is worth having. Requests without an Origin header (curl,
// server-to-server, health checks) are always allowed — CORS is a browser
// control, not an auth boundary.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors(
    ALLOWED_ORIGINS.length
      ? {
          origin(origin, cb) {
            // Withhold the header rather than throwing: throwing turns a
            // disallowed origin into a 500 with a stack trace in the logs,
            // when the correct outcome is simply that the browser blocks the
            // response.
            cb(null, !origin || ALLOWED_ORIGINS.includes(origin));
          },
        }
      : undefined
  )
);
app.use(express.json());
app.use("/chat", chat);
app.use("/search-courses", searchRouter);
// No degree-audit upload route: the audit is parsed in the browser, by
// SidebarAuditTracker. The server copy (routes/upload.js +
// parseHtmlAuditSections.js) had no callers anywhere and was broken three
// ways — line splits on a literal "\\n", a status check that read
// "Requirement not complete" as FULFILLED, and a title heuristic that accepted
// any 15-100 character string — while writing uploads to disk and returning
// stack traces to the caller. Deleted 2026-08-11.
app.use("/api/export", exportRouter);
app.use("/next-quarter", nextQuarterRouter);


// start the Express server
app.listen(PORT, () => {
});
