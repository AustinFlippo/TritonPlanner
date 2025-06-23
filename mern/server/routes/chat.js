import express from "express";
import fetch from "node-fetch";

const router = express.Router();

// Proxy endpoint for chat
router.post("/", async (req, res) => {
  try {
    const response = await fetch("http://localhost:8000/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      throw new Error(`FastAPI responded with status: ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error proxying chat request:", error);
    res.status(500).json({ error: "Failed to process chat request" });
  }
});

export default router;
