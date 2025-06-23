# 🚀 Complete Startup Guide
**UCSD Course Advisory Application**

---

## 📋 Quick Start Checklist

- [ ] Set up environment variables
- [ ] Install Python dependencies  
- [ ] Start FastAPI backend
- [ ] Start Express.js server
- [ ] Start React frontend
- [ ] Test the application

---

## ⚙️ Step 1: Environment Setup

### 1.1 Python Backend (.env Configuration)
```bash
cd app/
cp .env.template .env
```

Edit the `.env` file with your actual API keys:
```env
OPENAI_API_KEY=sk-your-actual-openai-key
PINECONE_API_KEY=pcsk-your-actual-pinecone-key
PINECONE_INDEX_NAME=openaicourses
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini-2024-07-18
```

### 1.2 Install Python Dependencies
```bash
cd app/
pip install -r requirements.txt
```

---

## 🐍 Step 2: Start FastAPI Backend (Port 8000)

### Option A: Using the startup script (Recommended)
```bash
cd app/
python start_server.py
```

### Option B: Direct uvicorn command
```bash
cd app/
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### ✅ Verify Backend is Running
- Open: http://localhost:8000 
- Should show: `{"message": "UCSD Course Advisory API", "status": "running"}`
- Health check: http://localhost:8000/health
- API docs: http://localhost:8000/docs

---

## 🔧 Step 3: Start Express.js Server (Port 5050)

### 3.1 Install Node Dependencies
```bash
cd mern/server/
npm install
```

### 3.2 Start Express Server
```bash
cd mern/server/
npm run start
```

### ✅ Verify Express Server
- Should show: `Server running on port 5050`
- Test endpoint: http://localhost:5050/api/search-courses

---

## ⚛️ Step 4: Start React Frontend (Port 5173)

### 4.1 Install React Dependencies
```bash
cd mern/client/
npm install
```

### 4.2 Start React Dev Server
```bash
cd mern/client/
npm run dev
```

### ✅ Verify Frontend
- Open: http://localhost:5173
- Should show the course planner interface

---

## 🧪 Step 5: Test the Complete Application

### 5.1 Test Course Search
1. Go to http://localhost:5173
2. Use the course search on the right sidebar
3. Search for "DSC 100" or "data science"
4. Verify search results appear

### 5.2 Test Chat Feature
1. In the right sidebar, use the chat interface
2. Try these test queries:
   - "What are the prerequisites for DSC 100?"
   - "Tell me about machine learning courses"
   - "schedule" (special command)
3. Verify you get responses without React errors

### 5.3 Test Course Planner
1. Upload a degree audit HTML file in the left sidebar
2. Verify courses appear in the 4-year planner grid
3. Test drag-and-drop functionality

---

## 🔍 Troubleshooting

### Common Issues & Solutions

#### ❌ "ModuleNotFoundError" in Python
```bash
# Solution: Install dependencies
cd app/
pip install -r requirements.txt
```

#### ❌ "Missing API key" errors
```bash
# Solution: Check your .env file
cd app/
cat .env
# Verify OPENAI_API_KEY and PINECONE_API_KEY are set
```

#### ❌ React "Objects are not valid as a React child"
✅ **Fixed!** This should no longer occur with the updated code.

#### ❌ FastAPI won't start
```bash
# Check for port conflicts
lsof -i :8000
# Kill any existing processes on port 8000
kill -9 <PID>
```

#### ❌ Express server won't start
```bash
# Check for port conflicts
lsof -i :5050
# Kill any existing processes
kill -9 <PID>
```

#### ❌ Chat returns "technical difficulties"
1. Check FastAPI logs for errors
2. Verify environment variables are set
3. Test health endpoint: http://localhost:8000/health

---

## 📊 Port Summary

| Service | Port | URL | Purpose |
|---------|------|-----|---------|
| React Frontend | 5173 | http://localhost:5173 | Main UI |
| Express.js API | 5050 | http://localhost:5050 | Course search, chat proxy |
| FastAPI Backend | 8000 | http://localhost:8000 | RAG pipeline, AI chat |

---

## 🔄 Development Workflow

### For Normal Development:
```bash
# Terminal 1: FastAPI backend
cd app/
python start_server.py

# Terminal 2: Express server  
cd mern/server/
npm run start

# Terminal 3: React frontend
cd mern/client/
npm run dev
```

### For Production:
```bash
# Build React app
cd mern/client/
npm run build

# Start production servers
cd mern/server/
npm run start

cd app/
uvicorn main:app --host 0.0.0.0 --port 8000
```

---

## 🎯 Testing Commands

### Test FastAPI Directly:
```bash
curl -X POST "http://localhost:8000/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What are the prerequisites for DSC 100?",
    "thread_id": "test-123"
  }'
```

### Test Express Proxy:
```bash
curl -X POST "http://localhost:5050/api/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Tell me about data science courses",
    "thread_id": "test-456"
  }'
```

---

## 🆘 Getting Help

### Check Logs:
- **FastAPI**: Terminal output where you started the Python server
- **Express**: Terminal output where you started `npm run start`
- **React**: Browser developer console (F12)

### Health Checks:
- FastAPI: http://localhost:8000/health
- Express: http://localhost:5050 (should return HTML)
- React: http://localhost:5173 (should load the app)

### If Chat Still Doesn't Work:
1. Verify all three servers are running
2. Check browser network tab for failed requests  
3. Verify API keys in `.env` file
4. Check FastAPI health endpoint shows "healthy" status

---

## ✅ Success Indicators

When everything is working correctly, you should see:

1. **FastAPI**: `✅ RAG system initialized successfully`
2. **Express**: `Server running on port 5050`
3. **React**: App loads at http://localhost:5173
4. **Chat**: Returns intelligent responses about courses
5. **Search**: Course search returns results
6. **Planner**: Drag-and-drop works, audit upload works

---

**Happy Coding! 🎉**