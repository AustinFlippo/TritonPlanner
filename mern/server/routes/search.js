import express from "express";
import {
  searchCourses,
  listDepartments,
  courseGraph,
  recommendCourses,
  offeringsFor,
} from "../controllers/searchController.js";

const router = express.Router();

// Body: { query?: string, filters?: { levels, depts, quarters } }
// Empty query + filters = browse mode.
router.post("/", async (req, res) => {
  try {
    // vouchedCodes: course codes the caller's own degree audit names. Ones the
    // catalog cannot resolve are searchable as unverified rather than being
    // invisible — see unverifiedEntry in the controller.
    const { query = "", filters = {}, vouchedCodes = [] } = req.body;
    if (!query.trim() && !Object.values(filters).some((v) => v?.length)) {
      return res.json({ results: [], total: 0 });
    }
    const { results, total } = searchCourses(
      query,
      filters,
      Array.isArray(vouchedCodes) ? vouchedCodes : []
    );
    res.json({ results, total });
  } catch (err) {
    console.error("❌ Search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

// Department list with course counts. ?levels=lower,upper filters the counts.
router.get("/departments", (req, res) => {
  try {
    const levels = (req.query.levels || "").split(",").filter(Boolean);
    res.json({ departments: listDepartments({ levels }) });
  } catch (err) {
    console.error("❌ Departments failed:", err);
    res.status(500).json({ error: "Departments failed" });
  }
});

// Resolve degree-audit course tokens to catalog courses for recommendations.
// Body: { codes, taken, exclude? } — taken = completed + planned (prereqs);
// exclude defaults to taken. Pass completed-only as exclude to keep planned
// courses visible in requirement search.
// A whole audit's worth of requirement codes, with room to spare. The old cap
// of 500 was both too low and applied to the TAIL of a flat list built by
// concatenating every requirement's options in order, so overflow did not thin
// the list evenly — it deleted the last requirements' options outright, and the
// sidebar drops a requirement with no courses from "Recommended for you"
// without saying why. If it ever does bind, the response says so.
const MAX_CODES = 3000;
const MAX_TRANSCRIPT = 1000;

router.post("/recommendations", (req, res) => {
  try {
    const { codes = [], taken = [], exclude } = req.body;
    if (!Array.isArray(codes) || codes.length === 0) {
      return res.json({ results: [] });
    }
    const truncated = codes.length > MAX_CODES;
    if (truncated) {
      console.warn(
        `⚠️ Recommendations: ${codes.length} codes exceeds the ${MAX_CODES} cap — ` +
          `${codes.length - MAX_CODES} dropped from the end of the list`
      );
    }
    const results = recommendCourses(
      codes.slice(0, MAX_CODES),
      taken.slice(0, MAX_TRANSCRIPT),
      Array.isArray(exclude) ? exclude.slice(0, MAX_TRANSCRIPT) : null
    );
    res.json({ results, truncated, dropped: Math.max(0, codes.length - MAX_CODES) });
  } catch (err) {
    console.error("❌ Recommendations failed:", err);
    res.status(500).json({ error: "Recommendations failed" });
  }
});

// Batch offerings lookup for the planner grid's "may not be offered" marks.
// Body: { codes: string[] } -> { [code]: { known, offerings } }
router.post("/offerings", (req, res) => {
  try {
    const { codes = [] } = req.body;
    if (!Array.isArray(codes)) return res.status(400).json({ error: "codes must be an array" });
    res.json({ offerings: offeringsFor(codes.slice(0, 200)) });
  } catch (err) {
    console.error("❌ Offerings failed:", err);
    res.status(500).json({ error: "Offerings failed" });
  }
});

// Prereq graph for one course. Course ids may contain "/", so the id rides
// in the query string: /search-courses/graph?course_id=CSE%20100
router.get("/graph", (req, res) => {
  try {
    const courseId = req.query.course_id;
    if (!courseId) return res.status(400).json({ error: "course_id is required" });
    const graph = courseGraph(courseId);
    if (!graph) return res.status(404).json({ error: "Course not found" });
    res.json(graph);
  } catch (err) {
    console.error("❌ Graph lookup failed:", err);
    res.status(500).json({ error: "Graph lookup failed" });
  }
});

export default router;
