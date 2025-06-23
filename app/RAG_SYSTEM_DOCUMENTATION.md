# RAG System Documentation
**UCSD Course Advisory Chat System**  
*Complete Retrieval-Augmented Generation Pipeline*

---

## 📋 Table of Contents
1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Setup Instructions](#setup-instructions)
4. [Component Breakdown](#component-breakdown)
5. [API Endpoints](#api-endpoints)
6. [Environment Variables](#environment-variables)
7. [Testing Guide](#testing-guide)
8. [Troubleshooting](#troubleshooting)
9. [Performance Optimization](#performance-optimization)

---

## 🎯 Overview

The RAG (Retrieval-Augmented Generation) system provides an intelligent chat interface for UCSD course advisory. It combines:

- **Pinecone Vector Database**: Stores course embeddings for semantic search
- **OpenAI/Anthropic LLMs**: Generates contextual responses
- **LangChain**: Orchestrates the retrieval and generation pipeline
- **FastAPI**: Provides REST API endpoints

### Key Features
✅ **Semantic Course Search**: Find relevant courses using natural language  
✅ **Context-Aware Responses**: Answers based on actual course data  
✅ **Multi-LLM Support**: OpenAI GPT or Anthropic Claude  
✅ **Async Processing**: High-performance async/await pipeline  
✅ **Error Handling**: Comprehensive error handling and logging  
✅ **Source Attribution**: Track which courses informed each response  

---

## 🏗️ System Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   React Client  │───→│   FastAPI Server │───→│  RAG Pipeline   │
│                 │    │                  │    │                 │
│ • Chat UI       │    │ • /chat endpoint │    │ • Query embed   │
│ • Send messages │    │ • CORS handling  │    │ • Pinecone search│
│ • Display resp. │    │ • Error handling │    │ • LLM generation│
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
                               ┌─────────────────────────┘
                               ▼
                    ┌─────────────────────┐    ┌─────────────────┐
                    │  Pinecone Vector DB │    │   OpenAI/Claude │
                    │                     │    │                 │
                    │ • Course embeddings │    │ • Text generation│
                    │ • Metadata search   │    │ • Context aware  │
                    │ • Similarity scores │    │ • Temperature ctrl│
                    └─────────────────────┘    └─────────────────┘
```

### Data Flow
1. **User Query** → Frontend sends message to `/chat` endpoint
2. **Query Embedding** → Convert text to vector using OpenAI embeddings
3. **Vector Search** → Query Pinecone for top-K similar course documents
4. **Context Assembly** → Format retrieved documents into structured context
5. **LLM Generation** → Send context + query to LLM for response
6. **Response Delivery** → Return formatted answer to frontend

---

## ⚙️ Setup Instructions

### 1. Prerequisites
```bash
# Python 3.8+
python --version

# Install dependencies
cd app/
pip install -r requirements.txt
```

### 2. Environment Configuration
Create `.env` file in `/app/` directory:

```env
# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-api-key-here

# Anthropic Configuration (Optional)
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key-here

# Pinecone Configuration
PINECONE_API_KEY=pcsk-your-pinecone-api-key-here
PINECONE_INDEX_NAME=openaicourses

# RAG System Configuration
LLM_PROVIDER=openai  # or "anthropic"
LLM_MODEL=gpt-4o-mini-2024-07-18  # or claude-3-haiku-20240307
EMBEDDING_MODEL=text-embedding-3-small

# Server Configuration
HOST=0.0.0.0
PORT=8000
```

### 3. Pinecone Index Setup
Your Pinecone index should contain documents with this structure:

```json
{
  "id": "unique-course-id",
  "values": [0.1, 0.2, ...],  // 1536-dim embedding
  "metadata": {
    "course_id": "DSC 100",
    "course_name": "Introduction to Data Science",
    "credits": "4",
    "prerequisites": "Math 20C or equivalent",
    "text": "This course introduces fundamental concepts...",
    "department": "Data Science",
    "level": "undergraduate"
  }
}
```

### 4. Start the Server
```bash
# Development
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Production
uvicorn main:app --host 0.0.0.0 --port 8000
```

---

## 🔧 Component Breakdown

### Core Classes

#### `PineconeRAG`
The main RAG pipeline class that orchestrates the entire process.

**Key Methods:**
- `embed_query(query)` → Convert text to embedding vector
- `get_relevant_courses(query, k=5)` → Retrieve top-K similar documents
- `format_context(documents)` → Structure context for LLM
- `generate_answer(query, context)` → Generate final response
- `query(user_query)` → Complete end-to-end pipeline

#### `RAGConfig`
Configuration dataclass for customizing RAG behavior.

**Parameters:**
```python
@dataclass
class RAGConfig:
    pinecone_api_key: str
    pinecone_index_name: str
    embedding_model: str = "text-embedding-3-small"
    llm_provider: str = "openai"  # "openai" or "anthropic"
    llm_model: str = "gpt-4o-mini-2024-07-18"
    temperature: float = 0.1
    max_tokens: int = 1500
    top_k: int = 5  # Number of documents to retrieve
    similarity_threshold: float = 0.7
```

### Pipeline Steps

#### Step 1: Query Embedding
```python
async def embed_query(self, query: str) -> List[float]:
    embedding = await self.embeddings.aembed_query(query)
    return embedding
```

#### Step 2: Pinecone Retrieval
```python
async def get_relevant_courses(self, query: str, k: int = 5) -> List[Document]:
    documents = await self.vector_store.asimilarity_search(query, k=k)
    return documents
```

#### Step 3: Context Formatting
```python
def format_context(self, documents: List[Document]) -> str:
    context_parts = []
    for doc in documents:
        course_id = doc.metadata.get('course_id', 'Unknown')
        context_parts.append(f"Course: {course_id}\n{doc.page_content}")
    return "\n\n---\n\n".join(context_parts)
```

#### Step 4: LLM Generation
```python
async def generate_answer(self, query: str, context: str) -> str:
    messages = self.prompt_template.format_messages(
        context=context, question=query
    )
    response = await self.llm.ainvoke(messages)
    return response.content
```

---

## 🌐 API Endpoints

### POST `/chat`
Main chat endpoint for processing user queries.

**Request:**
```json
{
  "message": "What are the prerequisites for DSC 100?",
  "thread_id": "user-session-123"
}
```

**Response:**
```json
{
  "messages": [{
    "type": "ai",
    "content": "DSC 100 (Introduction to Data Science) requires the following prerequisites: Math 20C (Calculus and Analytic Geometry), DSC 10 (Principles of Data Science), and DSC 20 (Programming and Basic Data Structures).",
    "sources": [
      {
        "course_id": "DSC 100",
        "course_name": "Introduction to Data Science",
        "snippet": "Prerequisites: Math 20C, DSC 10, DSC 20..."
      }
    ],
    "processing_time": 1.23
  }]
}
```

**Special Commands:**
- `"schedule"` → Returns dummy course schedule data

### Error Responses
```json
{
  "messages": [{
    "type": "ai",
    "content": "Sorry, I'm experiencing technical difficulties. Please try again in a moment."
  }]
}
```

---

## 🔑 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes* | - | OpenAI API key for embeddings & LLM |
| `ANTHROPIC_API_KEY` | Yes* | - | Anthropic API key (if using Claude) |
| `PINECONE_API_KEY` | Yes | - | Pinecone vector database API key |
| `PINECONE_INDEX_NAME` | No | `openaicourses` | Name of Pinecone index |
| `LLM_PROVIDER` | No | `openai` | LLM provider: "openai" or "anthropic" |
| `LLM_MODEL` | No | `gpt-4o-mini-2024-07-18` | Specific model name |
| `EMBEDDING_MODEL` | No | `text-embedding-3-small` | OpenAI embedding model |

*Either OpenAI or Anthropic API key required depending on `LLM_PROVIDER`

---

## 🧪 Testing Guide

### Manual Testing
```bash
# Start the server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Test with curl
curl -X POST "http://localhost:8000/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What are the prerequisites for DSC 100?",
    "thread_id": "test-123"
  }'
```

### Frontend Testing
1. Start the React frontend: `npm run dev`
2. Navigate to the chat interface
3. Test queries:
   - "What courses should I take for data science?"
   - "Tell me about DSC 100"
   - "What are the math requirements?"
   - "schedule" (special command)

### Automated Testing
```python
# Run the test function
python -c "
import asyncio
from rag_pipeline import test_rag_system
asyncio.run(test_rag_system())
"
```

### Expected Query Types
- **Course Information**: "Tell me about DSC 100"
- **Prerequisites**: "What are the prerequisites for CSE 100?"
- **Degree Planning**: "What courses do I need for data science major?"
- **Course Comparison**: "What's the difference between DSC 80 and CSE 110?"
- **Scheduling**: "What should I take in my first year?"

---

## 🚨 Troubleshooting

### Common Issues

#### 1. "Objects are not valid as a React child" Error
**Problem**: Frontend trying to render objects as text  
**Solution**: ✅ Fixed in `RightSidebar.jsx` - now properly extracts text content

#### 2. "No relevant course information found"
**Causes & Solutions:**
- **Empty Pinecone index**: Verify index has embeddings
- **Wrong index name**: Check `PINECONE_INDEX_NAME` env var
- **API key issues**: Verify Pinecone API key is valid
- **Query too specific**: Try broader terms

#### 3. LLM API Errors
**OpenAI Issues:**
```
Error: Invalid API key
```
**Solution**: Verify `OPENAI_API_KEY` in `.env`

**Anthropic Issues:**
```
Error: Anthropic API error
```
**Solution**: Check `ANTHROPIC_API_KEY` and model name

#### 4. Slow Response Times
**Causes & Solutions:**
- **Large context**: Reduce `top_k` in RAGConfig
- **Complex queries**: Increase timeout in frontend
- **API rate limits**: Implement request throttling

### Debugging Steps

1. **Check Logs**: Look for detailed error messages in terminal
2. **Verify Environment**: Ensure all required env vars are set
3. **Test Components**:
   ```python
   # Test embedding
   embedding = await rag.embed_query("test query")
   print(f"Embedding dimension: {len(embedding)}")
   
   # Test retrieval
   docs = await rag.get_relevant_courses("data science")
   print(f"Retrieved {len(docs)} documents")
   ```

### Log Analysis
Monitor these log messages for issues:
- `"RAG pipeline initialized successfully"` → ✅ System ready
- `"Retrieved X documents for query"` → ✅ Pinecone working
- `"Generated response: X characters"` → ✅ LLM working
- `"Error in retrieve function"` → ❌ Pinecone issue
- `"Failed to generate answer"` → ❌ LLM issue

---

## ⚡ Performance Optimization

### Response Time Optimization

#### 1. Retrieval Optimization
```python
# Reduce number of retrieved documents
config.top_k = 3  # Instead of 5

# Add metadata filtering for faster search
filters = {"department": "Data Science"}
result = await rag.query(query, filters=filters)
```

#### 2. Embedding Caching
```python
# Cache frequent queries (implement in production)
from functools import lru_cache

@lru_cache(maxsize=1000)
def get_cached_embedding(query):
    return embedding_model.embed(query)
```

#### 3. Async Optimization
```python
# Batch multiple queries
tasks = [rag.query(q) for q in queries]
results = await asyncio.gather(*tasks)
```

### Cost Optimization

#### 1. Model Selection
- **Development**: `gpt-4o-mini` (cheaper, faster)
- **Production**: `gpt-4o` (higher quality)
- **Budget Option**: `gpt-3.5-turbo`

#### 2. Context Management
```python
# Limit context size to reduce token usage
def truncate_context(context, max_tokens=2000):
    # Implement token counting and truncation
    return context[:max_tokens]
```

#### 3. Smart Retrieval
```python
# Only retrieve when needed
if is_simple_query(query):
    return simple_response(query)
else:
    return await rag.query(query)
```

### Scaling Considerations

#### 1. Multiple Pinecone Indexes
```python
# Different indexes for different domains
indexes = {
    "courses": "course-index",
    "faculty": "faculty-index", 
    "research": "research-index"
}
```

#### 2. Load Balancing
- Deploy multiple FastAPI instances
- Use nginx for load balancing
- Implement connection pooling for Pinecone

#### 3. Monitoring
```python
# Add metrics collection
import time
from prometheus_client import Counter, Histogram

query_count = Counter('rag_queries_total')
response_time = Histogram('rag_response_seconds')

@response_time.time()
async def monitored_query(query):
    query_count.inc()
    return await rag.query(query)
```

---

## 📊 System Metrics

### Performance Targets
- **Response Time**: < 3 seconds for 95% of queries
- **Accuracy**: > 85% relevant responses
- **Availability**: > 99.5% uptime

### Monitoring Dashboards
Track these key metrics:
- Query volume per hour
- Average response time
- Error rate
- Token usage (cost tracking)
- User satisfaction scores

---

## 🔄 Future Enhancements

### Short Term
- [ ] Add conversation memory/context
- [ ] Implement query preprocessing (spell check, intent detection)
- [ ] Add support for file uploads (syllabi, transcripts)
- [ ] Implement user feedback collection

### Long Term
- [ ] Multi-modal support (images, PDFs)
- [ ] Integration with university systems (student records)
- [ ] Personalized recommendations based on student history
- [ ] Advanced analytics and insights

---

## 📚 Additional Resources

- [Pinecone Documentation](https://docs.pinecone.io/)
- [LangChain RAG Guide](https://python.langchain.com/docs/use_cases/question_answering)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Anthropic Claude API](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)

---

**Last Updated**: January 21, 2025  
**Version**: 1.0  
**Maintainer**: Development Team