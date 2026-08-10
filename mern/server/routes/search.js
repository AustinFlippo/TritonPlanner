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
    const { query = "", filters = {} } = req.body;
    if (!query.trim() && !Object.values(filters).some((v) => v?.length)) {
      return res.json({ results: [], total: 0 });
    }
    const { results, total } = searchCourses(query, filters);
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
// Body: { codes: string[], taken: string[] } — taken = completed + planned.
router.post("/recommendations", (req, res) => {
  try {
    const { codes = [], taken = [] } = req.body;
    if (!Array.isArray(codes) || codes.length === 0) {
      return res.json({ results: [] });
    }
    // Audits can list hundreds of tokens across requirements; cap defensively
    const results = recommendCourses(codes.slice(0, 500), taken.slice(0, 500));
    res.json({ results });
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
