from agent import graph
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    thread_id: str


# Dummy schedule data
DUMMY_SCHEDULE = {
    "WI25": ["MATH 20C", "DSC 30", "CCE 1"],
    "SP25": ["DSC 40A", "DSC 80", "CCE 2"],
    "FA25": ["DSC 40B", "MATH 181A", "CCE 3"],
    "WI26": ["DSC 100", "DSC 102", "CCE 120"],
    "SP26": ["DSC 106", "MATH 189", "DSC 140A"],
    "FA26": ["DSC 140B", "DSC 148", "PHIL 150"],
    "WI27": ["DSC 180A", "PHIL 160", "TDGE 11"],
    "SP27": ["DSC 180B", "PHIL 170", "MUS 1A"],
    "FA27": ["ANTH 101", "PHIL 180", "MUS 4"]
}


@app.post("/chat")
async def chat(request: ChatRequest):
    print(request.message)
    if request.message.lower().strip() == "schedule":
        return {
            "messages": [{
                "type": "ai",
                "content": "Here's a recommended course schedule for your data science major:",
                "schedule": DUMMY_SCHEDULE
            }]
        }
    else:
        
        config = {"configurable": {"thread_id": request.thread_id}}
        result = await graph.ainvoke(
            {"messages": [{"role": "user", "content": request.message}]})
        return result
    