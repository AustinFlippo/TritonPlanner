import express from "express";
import fetch from "node-fetch";
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables based on NODE_ENV
if (process.env.NODE_ENV === 'production') {
  dotenv.config({ path: path.resolve('../../../.env.production') });
} else {
  dotenv.config({ path: path.resolve('../../../.env.development') });
}

// Fallback to root .env
dotenv.config({ path: path.resolve('../../../.env') });

const router = express.Router();

// Proxy endpoint for chat
router.post("/", async (req, res) => {
  try {
    // Use backend-specific environment variable or fallback
    const FASTAPI_URL = process.env.FASTAPI_URL || 
                       process.env.REACT_APP_FASTAPI_URL || 
                       process.env.ENV_FAST_API_URL; 
    //MARK OPEN
    console.log(`📡 Proxying chat request to: ${FASTAPI_URL}/chat`);
    console.log(`📦 Request body:`, req.body);
    //MARK CLOSED
    const response = await fetch(`${FASTAPI_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
      timeout: 30000 // 30 second timeout
    });

    console.log(`📡 FastAPI response status: ${response.status}`); //MARK OPEN, MARK CLOSED
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ FastAPI error response:`, errorText);
      throw new Error(`FastAPI responded with status: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`✅ FastAPI response:`, data);
    res.json(data);
  } catch (error) {
    console.error("❌ Error proxying chat request:", error);
    
    // Provide more specific error information
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      res.status(503).json({ 
        error: "FastAPI service unavailable",
        details: "Could not connect to the AI service. Please try again later."
      });
    } else if (error.name === 'TimeoutError') {
      res.status(504).json({ 
        error: "Request timeout",
        details: "The AI service took too long to respond. Please try again."
      });
    } else {
      res.status(500).json({ 
        error: "Failed to process chat request",
        details: process.env.NODE_ENV === 'development' ? error.message : "Internal server error"
      });
    }
  }
});

export default router;
