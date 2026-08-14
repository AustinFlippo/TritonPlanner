import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const FASTAPI_URL = (process.env.FASTAPI_URL || "http://localhost:8000").replace(
  /\/$/,
  ""
);
const REMOTE_PLANNER = !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(
  FASTAPI_URL
);
// Free Render services take ~1 minute to spin up after 15 minutes idle.
// Chat is the first request that touches FastAPI (search / next-quarter only
// hit Express), so the opening "plan my remaining requirements" dies unless
// we wait out the cold start.
const RETRY_BUDGET_MS = REMOTE_PLANNER ? 90_000 : 0;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableNetworkError(error) {
  const code = error?.cause?.code || error?.code;
  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "UND_ERR_SOCKET"
  ) {
    return true;
  }
  return /fetch failed|network|econnrefused|econnreset|socket/i.test(
    String(error?.message || "")
  );
}

async function proxyToPlanner(body) {
  const deadline = Date.now() + RETRY_BUDGET_MS;
  let delayMs = 2000;

  for (;;) {
    try {
      const response = await fetch(`${FASTAPI_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        return await response.json();
      }
      const error = new Error(`FastAPI responded with status: ${response.status}`);
      error.status = response.status;
      throw error;
    } catch (error) {
      const retryable =
        RETRYABLE_STATUS.has(error.status) || isRetryableNetworkError(error);
      if (!retryable || Date.now() >= deadline) {
        throw error;
      }
    }
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 2, 15_000);
  }
}

// Proxy endpoint for chat
router.post("/", async (req, res) => {
  try {
    const data = await proxyToPlanner(req.body);
    res.json(data);
  } catch (error) {
    console.error("Error proxying chat request:", error);
    res.status(500).json({ error: "Failed to process chat request" });
  }
});

export default router;
