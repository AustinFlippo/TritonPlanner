import express from "express";
import cors from "cors";
import chat from "./routes/chat.js";
import searchRouter from "./routes/search.js";
import uploadRouter from "./routes/upload.js";
import exportRouter from "./routes/export.js";
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from root .env file
const rootEnvPath = path.join(process.cwd(), '../../.env');
dotenv.config({ path: rootEnvPath });

// Fallback to local config.env if root .env doesn't exist
dotenv.config({ path: './config.env' });


const PORT = process.env.EXPRESS_PORT || process.env.PORT || 5050;
const app = express();

app.use(cors());
app.use(express.json());
app.use("/chat", chat);
app.use("/search-courses", searchRouter);
app.use("/upload-degree-audit", uploadRouter);
app.use("/api/export", exportRouter);


// start the Express server
app.listen(PORT, () => {
});
