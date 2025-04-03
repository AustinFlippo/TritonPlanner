import express from "express";
import cors from "cors";
//import records from "./routes/record.js";
import chat from "./routes/chat.js";
import searchRouter from "./routes/search.js";

// import { connectToServer, getDb } from "./connect.js";

// import posts from "./routes/planner.js";

const PORT = process.env.PORT || 5050;
const app = express();

app.use(cors());
app.use(express.json());

//app.use("/record", records);

app.use("/chat", chat);
app.use("/search-courses", searchRouter);
// app.use(posts);

// start the Express server
app.listen(PORT, () => {
  // connectToServer();
  console.log(`Server listening on port ${PORT}`);
});
