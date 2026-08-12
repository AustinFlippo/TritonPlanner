from fastapi import FastAPI, UploadFile, File, Query
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv
from pathlib import Path

# Import the new RAG system
from rag_pipeline import create_rag_system
from planner_agent import plan_chat
from planner_metrics import summarize_metrics

# Load environment variables from root .env file
root_env_path = Path(__file__).parent.parent / '.env'
load_dotenv(root_env_path)

# Fallback to local .env if root doesn't exist
if not root_env_path.exists():
    load_dotenv()


app = FastAPI()

# No cookie/session auth on this API (Supabase tokens ride in the body from
# the Express proxy), so credentials stay off — browsers reject the
# wildcard-plus-credentials combination anyway.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize RAG system (will be created on first use)
rag_system = None

def get_rag_system():
    """Lazy initialization of RAG system to handle startup errors gracefully."""
    global rag_system
    if rag_system is None:
        try:
            rag_system = create_rag_system(
                pinecone_api_key=os.getenv("PINECONE_API_KEY"),
                pinecone_index_name=os.getenv("PINECONE_INDEX_NAME", "openaicourses"),
                llm_provider=os.getenv("LLM_PROVIDER", "openai"),
                llm_model=os.getenv("LLM_MODEL", "gpt-5.6-terra")
            )
        except Exception as e:
            return None
    return rag_system

class ChatTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    thread_id: str
    # Optional planner context sent by the frontend: parsed degree audit
    # sections and the current 4-year grid. When present, the planner-aware
    # agent (local catalog, no Pinecone) handles the message instead of RAG.
    audit_sections: list | None = None
    schedule: list | None = None
    # Live / published TSS seat snapshot for the enrollment quarter (compact).
    seat_availability: dict | None = None
    # Enrollable section packages for the enrollment quarter (from the browser).
    section_options: dict | None = None
    # Which app tab the student is on (planner / quarter / …) plus enrollment
    # quarter coordinates, so the agent can interpret "my schedule" correctly.
    ui_context: dict | None = None
    # Two-digit fall year that year_index 0 of the grid means, from the audit's
    # Catalog Year. Without it the agent falls back to the calendar anchor and
    # would disagree with the client about which row is which year.
    base_year: int | None = None
    # Prior turns for this exact saved plan. The API stays stateless; the
    # frontend owns one transcript per plan and sends it with each request.
    history: list[ChatTurn] | None = None


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
    """
    Main chat endpoint using the RAG pipeline.
    
    Special commands:
    - "schedule": Returns dummy schedule data
    - Other queries: Processed through RAG pipeline
    """
    
    # Planner-aware path: uses the local-catalog planning agent (only needs
    # OPENAI_API_KEY). Used when the frontend sends audit/schedule context,
    # and as the fallback whenever the Pinecone RAG system isn't configured.
    if (
        request.audit_sections is not None
        or request.schedule is not None
        or get_rag_system() is None
    ):
        try:
            result = await plan_chat(
                request.message,
                request.audit_sections or [],
                request.schedule or [],
                history=[
                    turn.model_dump()
                    for turn in (request.history or [])
                ],
                seat_availability=request.seat_availability,
                section_options=request.section_options,
                ui_context=request.ui_context,
                base_year=request.base_year,
            )
            # agent_loop is loop-cost telemetry (rounds / tools / exit). Kept
            # top-level so it never lands in the chat bubble the student sees.
            loop = result.get("agent_loop")
            if result.get("seat_lookup") is not None:
                payload = {"seat_lookup": result["seat_lookup"]}
                if loop is not None:
                    payload["agent_loop"] = loop
                return payload
            if result.get("section_options_request") is not None:
                payload = {
                    "section_options_request": result["section_options_request"]
                }
                if loop is not None:
                    payload["agent_loop"] = loop
                return payload
            message = {"type": "ai", "content": result["content"]}
            for key in (
                "proposed_schedule",
                "placements",
                "warnings",
                "proposed_sections",
            ):
                if result.get(key) is not None:
                    message[key] = result[key]
            payload = {"messages": [message]}
            if loop is not None:
                payload["agent_loop"] = loop
            return payload
        except Exception:
            import traceback
            traceback.print_exc()
            hint = ("" if os.getenv("OPENAI_API_KEY")
                    else " (OPENAI_API_KEY is not set for the FastAPI server.)")
            return {
                "messages": [{
                    "type": "ai",
                    "content": "Sorry — the planning assistant hit an error. "
                               "Please try again; the server log has the "
                               f"details.{hint}"
                }]
            }


    # Process query through RAG pipeline
    try:
        rag = get_rag_system()
        if rag is None:
            return {
                "messages": [{
                    "type": "ai",
                    "content": "Sorry, the AI system is not properly configured. Please check the server logs and environment variables."
                }]
            }
        
        result = await rag.query(request.message)
        
        # Format response
        response_content = result["answer"]
        
        # Add sources if available (optional - for debugging)
        if result.get("sources") and len(result["sources"]) > 0:
            sources_text = "\n\nSources consulted:\n" + "\n".join([
                f"• {source['course_id']}: {source['course_name']}" 
                for source in result["sources"][:3]  # Show top 3 sources
            ])
            # Uncomment to include sources in response:
            # response_content += sources_text
        
        return {
            "messages": [{
                "type": "ai",
                "content": response_content,
                "sources": result.get("sources", []),
                "processing_time": result.get("processing_time", 0)
            }]
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        
        return {
            "messages": [{
                "type": "ai", 
                "content": "Sorry, I'm experiencing technical difficulties. Please try again in a moment."
            }]
        }


@app.post("/upload-degree-audit")
async def upload_degree_audit(pdf: UploadFile = File(...)):
    """Upload and parse degree audit PDF."""
    if not pdf.filename.endswith('.pdf'):
        return {"error": "Only PDF files are allowed"}
    
    # TODO: Implement PDF parsing functionality
    # For now, return a placeholder response
    return {
        "error": "PDF parsing functionality is not yet implemented", 
        "filename": pdf.filename,
        "size": pdf.size if hasattr(pdf, 'size') else "unknown"
    }


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"message": "UCSD Course Advisory API", "status": "running"}


@app.get("/health")
async def health_check():
    """Detailed health check for all components."""
    health_status = {
        "api": "healthy",
        "rag_system": "unknown",
        "environment": {}
    }
    
    # Check environment variables
    required_env_vars = ["OPENAI_API_KEY", "PINECONE_API_KEY"]
    for var in required_env_vars:
        health_status["environment"][var] = "set" if os.getenv(var) else "missing"
    
    # Test RAG system
    try:
        rag = get_rag_system()
        health_status["rag_system"] = "healthy" if rag else "failed"
    except Exception as e:
        health_status["rag_system"] = f"error: {str(e)}"
    
    return health_status


@app.get("/planner-metrics")
async def planner_metrics(limit: int | None = Query(
    default=None, ge=1, le=100000,
    description="Only aggregate the most recent N turns",
)):
    """Average model rounds / tool calls for the planner agent loop.

    Backed by app/data/planner_loop_metrics.jsonl (no student message text).
    """
    return summarize_metrics(limit=limit)
    