# 🔹 6. ChatWithLLM Documentation

## Overview
The ChatWithLLM system provides an AI-powered course advisory feature using a sophisticated Retrieval-Augmented Generation (RAG) architecture. This system combines React frontend, Express.js middleware, FastAPI backend, Pinecone vector database, and Large Language Models to provide intelligent course recommendations and academic guidance.

## Core Files
- **React Frontend**: `/mern/client/src/components/right-sidebar/RightSidebar.jsx`
- **Express Middleware**: `/mern/server/routes/chat.js`
- **FastAPI Backend**: `/app/main.py`
- **RAG Pipeline**: `/app/rag_pipeline.py`
- **Agent Logic**: `/app/agent.py`
- **Configuration**: `/app/.env` (environment variables)

## Architecture Overview

### Three-Tier System Design
```
┌─────────────────┐    HTTP     ┌─────────────────┐    HTTP     ┌─────────────────┐
│   React Frontend│  ────────>  │ Express Server  │  ────────>  │  FastAPI + RAG  │
│   (Port 5173)   │             │  (Port 5050)    │             │   (Port 8000)   │
└─────────────────┘             └─────────────────┘             └─────────────────┘
                                                                          │
                                                                          │
                                                  ┌───────────────────────┼───────────────────────┐
                                                  │                       │                       │
                                                  ▼                       ▼                       ▼
                                         ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
                                         │  Pinecone Vector│     │  OpenAI/Anthropic│     │ Course Database │
                                         │    Database     │     │      LLMs       │     │   (JSON Files)  │
                                         └─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Frontend Implementation

### RightSidebar.jsx Chat Interface
**Location**: `/mern/client/src/components/right-sidebar/RightSidebar.jsx`

#### Chat State Management
```javascript
const [messages, setMessages] = useState([]);
const [newMessage, setNewMessage] = useState("");
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState(null);
```

#### Message Handling System
**Lines 80-120 in RightSidebar.jsx**
```javascript
const handleSendMessage = async () => {
  if (!newMessage.trim()) return;
  
  const userMessage = newMessage.trim();
  setNewMessage("");
  setIsLoading(true);
  setError(null);

  // Add user message to chat
  const newUserMessage = {
    id: Date.now(),
    type: "user",
    content: userMessage,
    timestamp: new Date()
  };
  setMessages(prev => [...prev, newUserMessage]);

  try {
    // Call Express server chat endpoint
    const response = await fetch("http://localhost:5050/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: userMessage,
        thread_id: `thread-${Date.now()}`, // Unique thread ID
      }),
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    
    // Extract AI response content
    let assistantContent;
    if (data.error) {
      assistantContent = `Error: ${data.error}`;
    } else if (data.messages?.length > 0) {
      const aiMessage = data.messages.filter((msg) => msg.type === "ai").pop();
      assistantContent = aiMessage?.content || "No response";
    } else {
      assistantContent = data.response || "I'm here to help with course planning!";
    }

    // Add AI response to chat
    const assistantMessage = {
      id: Date.now() + 1,
      type: "assistant", 
      content: assistantContent,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, assistantMessage]);

  } catch (error) {
    console.error("❌ Chat error:", error);
    setError("Failed to send message. Please try again.");
  } finally {
    setIsLoading(false);
  }
};
```

#### Chat UI Components
```javascript
{/* Message Display Area */}
<div className="flex-1 overflow-y-auto p-4 space-y-4">
  {messages.map((message) => (
    <div
      key={message.id}
      className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[80%] p-3 rounded-lg ${
          message.type === "user"
            ? "bg-blue-500 text-white"
            : "bg-gray-100 text-gray-800"
        }`}
      >
        {message.content}
      </div>
    </div>
  ))}
  
  {/* Loading Indicator */}
  {isLoading && (
    <div className="flex justify-start">
      <div className="bg-gray-100 p-3 rounded-lg">
        <div className="flex items-center space-x-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
          <span>Thinking...</span>
        </div>
      </div>
    </div>
  )}
</div>

{/* Input Area */}
<div className="border-t p-4">
  <div className="flex space-x-2">
    <input
      type="text"
      value={newMessage}
      onChange={(e) => setNewMessage(e.target.value)}
      onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
      placeholder="Ask about courses, prerequisites, or planning..."
      className="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
    <button
      onClick={handleSendMessage}
      disabled={isLoading || !newMessage.trim()}
      className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50"
    >
      Send
    </button>
  </div>
</div>
```

## Express.js Middleware Layer

### Chat Route Handler
**Location**: `/mern/server/routes/chat.js`

```javascript
import express from "express";
const router = express.Router();

router.post("/", async (req, res) => {
  try {
    console.log("📨 Received chat request:", req.body);
    
    const { message, thread_id } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Forward request to FastAPI backend
    const fastAPIResponse = await fetch("http://localhost:8000/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: message,
        thread_id: thread_id || `thread-${Date.now()}`,
      }),
    });

    if (!fastAPIResponse.ok) {
      const errorText = await fastAPIResponse.text();
      console.error("❌ FastAPI error:", fastAPIResponse.status, errorText);
      return res.status(500).json({ 
        error: "Chat service unavailable",
        details: errorText 
      });
    }

    const data = await fastAPIResponse.json();
    console.log("✅ FastAPI response received");
    
    res.json(data);
    
  } catch (error) {
    console.error("❌ Chat route error:", error);
    res.status(500).json({ 
      error: "Internal server error",
      details: error.message 
    });
  }
});

export default router;
```

### Route Registration
**In `/mern/server/server.js`:**
```javascript
import chat from "./routes/chat.js";
app.use("/chat", chat);
```

## FastAPI Backend Implementation

### Main Application
**Location**: `/app/main.py`

#### Application Setup
```python
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import logging

# Initialize FastAPI app
app = FastAPI(title="UCSD Course Advisory API", version="1.0.0")

# CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5050"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global RAG system instance
rag_system = None
```

#### Chat Request Model
```python
class ChatRequest(BaseModel):
    message: str
    thread_id: str = "default"
    max_tokens: int = 1000
    temperature: float = 0.7
```

#### RAG System Initialization
```python
def get_rag_system():
    """Lazy initialization of RAG system."""
    global rag_system
    if rag_system is None:
        try:
            print("🚀 Initializing RAG system...")
            rag_system = create_rag_system(
                openai_api_key=os.getenv("OPENAI_API_KEY"),
                pinecone_api_key=os.getenv("PINECONE_API_KEY"),
                pinecone_index_name=os.getenv("PINECONE_INDEX_NAME", "course-embeddings"),
                embedding_model="text-embedding-3-small",
                llm_model="gpt-4o-mini"
            )
            print("✅ RAG system initialized successfully")
            return rag_system
        except Exception as e:
            print(f"❌ Failed to initialize RAG system: {e}")
            return None
    return rag_system
```

#### Main Chat Endpoint
```python
@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    """Main chat endpoint using RAG pipeline."""
    try:
        print(f"📨 Received chat request: {request.message[:100]}...")
        
        # Get RAG system instance
        rag = get_rag_system()
        if not rag:
            raise HTTPException(
                status_code=500, 
                detail="Chat service unavailable - RAG system not initialized"
            )
        
        # Process query through RAG pipeline
        start_time = asyncio.get_event_loop().time()
        result = await rag.query(request.message)
        processing_time = asyncio.get_event_loop().time() - start_time
        
        # Format response
        response = {
            "messages": [
                {
                    "type": "ai",
                    "content": result["answer"],
                    "sources": result.get("sources", [])
                }
            ],
            "processing_time": round(processing_time, 3)
        }
        
        print(f"✅ Chat response generated in {processing_time:.3f}s")
        return response
        
    except Exception as e:
        print(f"❌ Chat endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Chat processing failed: {str(e)}")
```

#### Health Check Endpoints
```python
@app.get("/health")
async def health_check():
    """Health check endpoint."""
    rag = get_rag_system()
    
    return {
        "api": "healthy",
        "rag_system": "initialized" if rag else "failed",
        "environment": {
            "openai_key": "configured" if os.getenv("OPENAI_API_KEY") else "missing",
            "pinecone_key": "configured" if os.getenv("PINECONE_API_KEY") else "missing"
        }
    }

@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "UCSD Course Advisory API", "docs": "/docs"}
```

## RAG Pipeline Implementation

### Core RAG Class
**Location**: `/app/rag_pipeline.py`

#### RAG System Configuration
```python
from dataclasses import dataclass
from typing import Optional, List, Dict, Any
import asyncio

@dataclass
class RAGConfig:
    """Configuration for RAG system."""
    openai_api_key: str
    pinecone_api_key: str
    pinecone_index_name: str = "course-embeddings"
    embedding_model: str = "text-embedding-3-small"
    llm_model: str = "gpt-4o-mini"
    llm_provider: str = "openai"  # "openai" or "anthropic"
    max_tokens: int = 1000
    temperature: float = 0.7
    top_k: int = 5

class EnhancedRAGPipeline:
    """Advanced RAG pipeline for course advisory."""
    
    def __init__(self, config: RAGConfig):
        self.config = config
        self.pinecone_client = None
        self.index = None
        self.openai_client = None
        self.anthropic_client = None
        self.embeddings_client = None
```

#### Vector Database Integration
```python
async def initialize_pinecone(self):
    """Initialize Pinecone vector database connection."""
    try:
        from pinecone import Pinecone
        
        self.pinecone_client = Pinecone(api_key=self.config.pinecone_api_key)
        self.index = self.pinecone_client.Index(self.config.pinecone_index_name)
        
        # Test connection
        stats = self.index.describe_index_stats()
        print(f"✅ Connected to Pinecone index: {stats['total_vector_count']} vectors")
        
    except Exception as e:
        print(f"❌ Pinecone initialization failed: {e}")
        raise
```

#### Embedding Generation
```python
async def embed_query(self, query: str) -> List[float]:
    """Generate embeddings for user query."""
    try:
        response = await self.embeddings_client.embeddings.create(
            model=self.config.embedding_model,
            input=query
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"❌ Embedding generation failed: {e}")
        raise
```

#### Vector Similarity Search
```python
async def get_relevant_courses(self, query: str, k: int = 5) -> List[Dict]:
    """Retrieve relevant courses from vector database."""
    try:
        # Generate query embedding
        query_embedding = await self.embed_query(query)
        
        # Search similar vectors
        search_results = self.index.query(
            vector=query_embedding,
            top_k=k,
            include_metadata=True
        )
        
        # Extract course information
        relevant_courses = []
        for match in search_results['matches']:
            course_data = {
                'course_id': match['metadata'].get('course_id', ''),
                'course_name': match['metadata'].get('course_name', ''),
                'description': match['metadata'].get('description', ''),
                'prerequisites': match['metadata'].get('prerequisites', ''),
                'credits': match['metadata'].get('credits', ''),
                'similarity_score': match['score']
            }
            relevant_courses.append(course_data)
        
        print(f"📊 Found {len(relevant_courses)} relevant courses")
        return relevant_courses
        
    except Exception as e:
        print(f"❌ Vector search failed: {e}")
        return []
```

#### Context Formatting
```python
def format_context(self, courses: List[Dict]) -> str:
    """Format retrieved courses for LLM context."""
    if not courses:
        return "No relevant course information found."
    
    context_parts = []
    for course in courses:
        course_info = f"""
Course ID: {course['course_id']}
Course Name: {course['course_name']}
Description: {course['description'][:200]}...
Prerequisites: {course['prerequisites']}
Credits: {course['credits']}
Relevance Score: {course['similarity_score']:.3f}
---"""
        context_parts.append(course_info)
    
    return "\n".join(context_parts)
```

#### LLM Response Generation
```python
async def generate_answer(self, query: str, context: str) -> str:
    """Generate response using LLM with retrieved context."""
    try:
        # Construct prompt with context
        system_prompt = """You are a helpful UCSD academic advisor specializing in computer science and data science courses. 
        Use the provided course information to give specific, actionable advice about course selection, prerequisites, and academic planning.
        
        Be concise but thorough. If asked about specific courses, reference the course IDs and names from the context.
        If the context doesn't contain relevant information, say so clearly."""
        
        user_prompt = f"""Context (relevant courses):
{context}

Student Question: {query}

Please provide helpful academic advice based on the course information above."""

        if self.config.llm_provider == "openai":
            response = await self.openai_client.chat.completions.create(
                model=self.config.llm_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=self.config.max_tokens,
                temperature=self.config.temperature
            )
            return response.choices[0].message.content
            
        elif self.config.llm_provider == "anthropic":
            response = await self.anthropic_client.messages.create(
                model=self.config.llm_model,
                max_tokens=self.config.max_tokens,
                temperature=self.config.temperature,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}]
            )
            return response.content[0].text
            
    except Exception as e:
        print(f"❌ LLM generation failed: {e}")
        return f"I'm sorry, I encountered an error processing your question: {str(e)}"
```

#### Main Query Pipeline
```python
async def query(self, user_query: str, top_k: int = 5) -> Dict[str, Any]:
    """Complete RAG pipeline for user query."""
    try:
        print(f"🔍 Processing query: {user_query[:100]}...")
        
        # Step 1: Retrieve relevant courses
        documents = await self.get_relevant_courses(user_query, k=top_k)
        
        # Step 2: Format context
        context = self.format_context(documents)
        
        # Step 3: Generate answer
        answer = await self.generate_answer(user_query, context)
        
        # Step 4: Prepare sources for frontend
        sources = []
        for doc in documents[:3]:  # Top 3 sources
            sources.append({
                "course_id": doc['course_id'],
                "course_name": doc['course_name'],
                "snippet": doc['description'][:150] + "..." if len(doc['description']) > 150 else doc['description']
            })
        
        return {
            "answer": answer,
            "sources": sources,
            "context_used": len(documents) > 0
        }
        
    except Exception as e:
        print(f"❌ RAG query failed: {e}")
        return {
            "answer": f"I apologize, but I'm unable to process your question right now: {str(e)}",
            "sources": [],
            "context_used": False
        }
```

## Environment Configuration

### Required Environment Variables
**File**: `/app/.env`
```env
# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-key-here

# Anthropic Configuration (optional)
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key

# Pinecone Configuration
PINECONE_API_KEY=pcsk-your-pinecone-key
PINECONE_INDEX_NAME=course-embeddings

# Model Configuration
EMBEDDING_MODEL=text-embedding-3-small
LLM_MODEL=gpt-4o-mini
LLM_PROVIDER=openai

# API Configuration
MAX_TOKENS=1000
TEMPERATURE=0.7
TOP_K_RESULTS=5
```

## Data Flow Example

### Complete Request-Response Cycle
```
1. User types: "What are the prerequisites for DSC 100?"

2. Frontend (RightSidebar.jsx):
   POST http://localhost:5050/chat
   Body: {"message": "What are the prerequisites for DSC 100?", "thread_id": "thread-123"}

3. Express Server (chat.js):
   POST http://localhost:8000/chat  
   Body: {"message": "What are the prerequisites for DSC 100?", "thread_id": "thread-123"}

4. FastAPI (main.py):
   - Calls rag_system.query("What are the prerequisites for DSC 100?")

5. RAG Pipeline (rag_pipeline.py):
   a) Generate embedding for query
   b) Search Pinecone for similar course vectors
   c) Retrieve courses: [DSC 100, DSC 10, MATH 18, ...]
   d) Format context with course information
   e) Send to OpenAI/Anthropic with prompt
   f) Receive LLM response

6. Response chain:
   FastAPI → Express → Frontend
   
7. Frontend displays:
   "DSC 100 (Intro to Data Science) requires DSC 10 or equivalent programming experience, 
   and MATH 18 (Linear Algebra) or MATH 20F. The course introduces..."
```

## Error Handling and Monitoring

### Error Types and Handling
```python
# API Key errors
if not self.config.openai_api_key:
    raise ValueError("OpenAI API key not configured")

# Pinecone connection errors  
try:
    self.index = self.pinecone_client.Index(index_name)
except Exception as e:
    print(f"❌ Pinecone connection failed: {e}")
    raise

# LLM rate limiting
try:
    response = await self.openai_client.chat.completions.create(...)
except openai.RateLimitError:
    return "I'm currently experiencing high demand. Please try again in a moment."

# Network timeouts
except asyncio.TimeoutError:
    return "The request timed out. Please try a shorter question."
```

### Logging and Monitoring
```python
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Request logging
logger.info(f"📨 Chat request: {request.message[:100]}...")

# Performance monitoring
start_time = time.time()
result = await rag.query(request.message)
processing_time = time.time() - start_time
logger.info(f"⏱️ Processed in {processing_time:.3f}s")

# Error logging
except Exception as e:
    logger.error(f"❌ RAG error: {e}", exc_info=True)
```

## Typical Use Cases

### Course Planning Queries
- "What should I take after DSC 20?"
- "Show me data science electives for juniors"
- "What are good courses for machine learning preparation?"

### Prerequisite Questions  
- "What do I need before taking CSE 100?"
- "Can I take DSC 140A without MATH 180A?"
- "What math courses are required for the DS major?"

### Academic Planning
- "Plan my remaining quarters for data science major"
- "What's a typical course load for sophomores?"
- "Should I take CSE or ECE 15 for programming?"

### Integration with Planner
- RAG system aware of user's completed courses (from audit)
- Personalized recommendations based on academic progress
- Warnings about prerequisite violations in schedule