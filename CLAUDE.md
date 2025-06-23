# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Architecture

AIVac is a course planning application with three main components:

1. **Python FastAPI Backend** (`/app/`) - RAG-based chat assistant using LangGraph, OpenAI, and Pinecone for course recommendations
2. **Express.js API Server** (`/mern/server/`) - Handles course search and chat routing, originally designed for MongoDB but currently simplified
3. **React Frontend** (`/mern/client/`) - Vite + React app with drag-and-drop course planner interface

### Frontend Structure
- **MainLayout**: Core layout with three-page navigation (planner, storage, quarter view)
- **CoursePlannerContainer**: Manages drag-and-drop 4-year course schedule state (4 years × 3 terms)
- **RightSidebar**: Course search and AI chat assistant
- **LeftSidebar**: Navigation and course progress tracking
- Course data stored in JSON files in `/src/jsons/` (multiple user profiles)

### Backend Structure
- FastAPI app provides `/chat` endpoint that routes to LangGraph agent
- Express server provides course search API and chat proxy
- RAG system uses Pinecone vector store with OpenAI embeddings for course recommendations

## Development Commands

### Frontend (React + Vite)
```bash
cd mern/client
npm install
npm run dev      # Start development server
npm run build    # Build for production
npm run lint     # Run ESLint
```

### Express Server
```bash
cd mern/server
npm install
npm run start    # Start server (production)
# No dev script - use 'node server.js' for development
```

### Python FastAPI Backend
```bash
cd app
pip install --upgrade -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

## Configuration Notes

- Express server expects `config.env` file with MongoDB connection (currently not used)
- Python backend requires OpenAI API key and Pinecone credentials in environment
- Frontend uses hardcoded course data from JSON files instead of database

## Testing

- Cypress E2E tests configured in `/mern/client/cypress/`
- Run tests with: `npx cypress open` (from client directory)