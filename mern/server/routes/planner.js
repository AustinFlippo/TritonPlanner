import express from "express";
import { connectToServer, getDb } from "../connect.js";
import { ObjectId } from "mongodb";

//const collection = db.collection("planned_courses");
let postRoutes = express.Router();


// get all
// http://localhost:3000/ports
postRoutes.route("/plan").get(async (request, response) => {
    let database = getDb();
    let data = await database.collection("planned_courses").find({}).toArray();
    //check for empty collection
    if (data.length > 0 ){
        response.json(data);
    }
    else{
        throw new Error("Data was not found");
    }
})

// get one
postRoutes.route("/plan/:id").get(async (request, response) => {
    let database = getDb();
    let data = await database.collection("planned_courses").findOne({_id: new ObjectId(request.params.id)}).toArray();
    //check for empty object
    if (Object.keys(data).length > 0 ){
        response.json(data);
    }
    else{
        throw new Error("Data was not found");
    }
})


//add new entry
postRoutes.route("/plan").post(async (request, response) => {
    let database = getDb();
    let mongoObject = {
        course_id: request.body.course_id,
        course_name: request.body.course_name,
        description: request.body.description
    };
    let data = await database.collection("planned_courses").insertOne(mongoObject);
    
    // should return something to frontend (not required, just checking to see if it worked)
    response.json(data);
})


//update entry
postRoutes.route("/plan/:id").put(async (request, response) => {
    let database = getDb();
    let mongoObject = {
        $set: {
            course_id: request.body.course_id,
            course_name: request.body.course_name,
            description: request.body.description
        }
    };
    let data = await database.collection("planned_courses").updateOne({_id: new ObjectId(request.params.id)}, mongoObject);
    
    // should return something to frontend (not required, just checking to see if it worked)
    response.json(data);
})

// delete one
postRoutes.route("/plan/:id").get(async (request, response) => {
    let data = await database.collection("planned_courses").deleteOne({_id: new ObjectId(request.params.id)}).toArray();
    
    response.json(data);
})

export default postRoutes;

/*
async function getPlans(query = {}) {
    const plans = await collection.find(query).toArray();
    return plans;
}
  
async function updatePlan(id, updatedFields) {
    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedFields }
    );
    return result.modifiedCount;
}

async function deletePlan(id) {
    const result = await collection.deleteOne({ _id: new ObjectId(id) });
    return result.deletedCount;
}
*/