import express from "express";
import { searchCourses } from "../controllers/searchController.js";

const router = express.Router();
router.post("/", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Query is required" });

    const results = await searchCourses(query);
    res.json({ results });
  } catch (err) {
    console.error("❌ Search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
