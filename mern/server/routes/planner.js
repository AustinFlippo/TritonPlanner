import express from "express";
import { connectToServer, getDb } from "./connect.js";

const database = getDb();

const collection = db.collection("planned_courses");

let postRoutes = express.Router();
