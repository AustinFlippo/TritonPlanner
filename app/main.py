from fastapi import FastAPI, UploadFile, File
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv
from pathlib import Path

# Import the new RAG system
from rag_pipeline import create_rag_system

# Load environment variables from root .env file
root_env_path = Path(__file__).parent.parent / '.env'
load_dotenv(root_env_path)

# Fallback to local .env if root doesn't exist
if not root_env_path.exists():
    load_dotenv()


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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
                llm_model=os.getenv("LLM_MODEL", "gpt-4o-mini-2024-07-18")
            )
        except Exception as e:
            return None
    return rag_system

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
    """
    Main chat endpoint using the RAG pipeline.
    
    Special commands:
    - "schedule": Returns dummy schedule data
    - Other queries: Processed through RAG pipeline
    """
    
    # Handle special schedule command
    if request.message.lower().strip() == "schedule":
        return {
            "messages": [{
                "type": "ai",
                "content": "Here's a recommended course schedule for your data science major:",
                "schedule": DUMMY_SCHEDULE
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
    