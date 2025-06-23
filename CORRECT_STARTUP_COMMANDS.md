# ✅ Correct Startup Commands
**UCSD Course Advisory Application**

---

## 🚀 **Step-by-Step Startup Guide**

### **1. Set Up Python Environment (One-time setup)**

```bash
# Navigate to the app directory
cd /Users/austinflippo/Documents/GitHub/AIVac/app

# Run the setup script (creates virtual environment and installs dependencies)
./setup_environment.sh

# OR manually:
# python3 -m venv venv
# source venv/bin/activate
# pip install -r requirements.txt
```

### **2. Configure Environment Variables**

```bash
# Copy the template
cp .env.template .env

# Edit with your actual API keys
# You need at minimum:
# OPENAI_API_KEY=sk-your-openai-key
# PINECONE_API_KEY=pcsk-your-pinecone-key
```

### **3. Start the Backend Services**

#### **Terminal 1: FastAPI Backend (Port 8000)**
```bash
cd /Users/austinflippo/Documents/GitHub/AIVac/app

# Activate virtual environment
source venv/bin/activate

# Start the server
python start_server.py
```

**Expected Output:**
```
🚀 Starting UCSD Course Advisory API...
✅ Environment variables are set
✅ Dependencies are installed
✅ RAG system initialized successfully
🌟 Starting server on http://localhost:8000
```

#### **Terminal 2: Express.js Server (Port 5050)**
```bash
cd /Users/austinflippo/Documents/GitHub/AIVac/mern/server

# Install dependencies (if not done already)
npm install

# Start server
npm run start
```

**Expected Output:**
```
Server running on port 5050
```

#### **Terminal 3: React Frontend (Port 5173)**
```bash
cd /Users/austinflippo/Documents/GitHub/AIVac/mern/client

# Install dependencies (if not done already) 
npm install

# Start development server
npm run dev
```

**Expected Output:**
```
  VITE v4.x.x  ready in xxx ms
  ➜  Local:   http://localhost:5173/
```

---

## 🔍 **Verification Steps**

### **1. Test FastAPI Backend**
```bash
# In a new terminal (while server is running):
cd /Users/austinflippo/Documents/GitHub/AIVac/app
source venv/bin/activate
python test_server.py
```

### **2. Manual URL Tests**
- **FastAPI Health**: http://localhost:8000/health
- **FastAPI Docs**: http://localhost:8000/docs  
- **Express Server**: http://localhost:5050
- **React App**: http://localhost:5173

### **3. Test Chat Feature**
1. Go to http://localhost:5173
2. Use the chat interface on the right sidebar
3. Try: "What are the prerequisites for DSC 100?"
4. Should get a response without React errors

---

## 🚨 **Troubleshooting**

### **"ModuleNotFoundError" or Import Errors**
```bash
# Make sure you're in the virtual environment
cd /Users/austinflippo/Documents/GitHub/AIVac/app
source venv/bin/activate
which python  # Should show: ./venv/bin/python

# If still getting errors, reinstall:
pip install -r requirements.txt
```

### **"python-multipart" Error**
```bash
source venv/bin/activate
pip install python-multipart
```

### **"Missing API keys" or RAG Errors**
```bash
# Check your .env file
cat .env

# Make sure these are set:
# OPENAI_API_KEY=sk-...
# PINECONE_API_KEY=pcsk-...
```

### **Port Conflicts**
```bash
# Check what's using each port
lsof -i :8000  # FastAPI
lsof -i :5050  # Express  
lsof -i :5173  # React

# Kill conflicting processes
kill -9 <PID>
```

### **"Cannot connect to server" Errors**
1. Verify FastAPI is running on port 8000
2. Check Express server is running on port 5050  
3. Make sure all three services are running simultaneously

---

## 🎯 **Quick Test Commands**

### **Test FastAPI Directly:**
```bash
curl http://localhost:8000/health
```

### **Test Chat API:**
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "thread_id": "test"}'
```

### **Test Express Proxy:**
```bash
curl -X POST http://localhost:5050/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "thread_id": "test"}'
```

---

## ✅ **Success Indicators**

When everything is working, you should see:

1. **FastAPI Terminal**: `✅ RAG system initialized successfully`
2. **Express Terminal**: `Server running on port 5050`  
3. **React Terminal**: `➜  Local:   http://localhost:5173/`
4. **Browser**: App loads at http://localhost:5173
5. **Chat**: Returns responses without React errors
6. **Health Check**: http://localhost:8000/health shows "healthy" status

---

## 📝 **Environment Summary**

| Component | Directory | Command | Port | URL |
|-----------|-----------|---------|------|-----|
| FastAPI | `/app/` | `source venv/bin/activate && python start_server.py` | 8000 | http://localhost:8000 |
| Express | `/mern/server/` | `npm run start` | 5050 | http://localhost:5050 |
| React | `/mern/client/` | `npm run dev` | 5173 | http://localhost:5173 |

---

**🎉 You're all set! The application should now be running correctly with the proper Python environment.**