import express from "express";
import cors from "cors";
import chat from "./routes/chat.js";
import searchRouter from "./routes/search.js";
import dotenv from 'dotenv';
dotenv.config({ path: './config.env' });


const PORT = process.env.PORT || 5050;
const app = express();

app.use(cors());
app.use(express.json());
app.use("/chat", chat);
app.use("/search-courses", searchRouter);


// start the Express server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
