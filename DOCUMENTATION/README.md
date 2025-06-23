# 📚 AIVac Academic Planner - Complete Documentation

## Overview
This documentation folder contains comprehensive technical documentation for all major components of the AIVac academic planning application. Each document provides detailed implementation details, file locations, and architectural insights.

## Application Architecture

### High-Level System Design
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             AIVac Academic Planner                          │
└─────────────────────────────────────────────────────────────────────────────┘
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   React Frontend│  │ Express Server  │  │  FastAPI + RAG  │  │ Google Services │
│   (Port 5173)   │  │  (Port 5050)    │  │   (Port 8000)   │  │  (External)     │
└─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘
        │                       │                       │                       │
        ├── Audit Parsing       ├── Course Search      ├── AI Chat Assistant  ├── Sheets Export
        ├── 4-Year Planner      ├── Chat Proxy         ├── Pinecone Vector DB ├── Drive Permissions
        ├── Drag & Drop UI      └── Google API Routes  └── OpenAI/Anthropic   └── Authentication
        └── Local State Mgmt
```

## Documentation Files

### 🔹 1. [DegreeAuditParser](./1_DegreeAuditParser.md)
**HTML Upload and Parsing Logic**
- **Primary File**: `/mern/client/src/components/audit/SidebarAuditTracker.jsx`
- **Utilities**: `/mern/client/src/utils/auditParser.js`
- **Purpose**: Converts HTML degree audit files into structured JavaScript objects
- **Key Features**: 
  - HTML parsing using DOMParser
  - Section identification (Completed, In Progress, Requirements)
  - Grade-based fulfillment status
  - Summer course filtering
  - Units calculation from EARNED section

### 🔹 2. [LeftSidebarAuditView](./2_LeftSidebarAuditView.md) 
**Sidebar UI Display of Parsed Audit**
- **Primary File**: `/mern/client/src/components/audit/AuditAccordionSection.jsx`
- **Container**: `/mern/client/src/components/LeftSidebar.jsx`
- **Purpose**: Visual representation of audit data with collapsible sections
- **Key Features**:
  - Color-coded status indicators (green/yellow/red)
  - Collapsible dropdown sections
  - Progress tracking with unit counts
  - Duplicate course handling (allowed in sidebar)
  - Scrollable interface

### 🔹 3. [FourYearPlannerGrid](./3_FourYearPlannerGrid.md)
**Main Planner Grid Display**
- **Primary File**: `/mern/client/src/components/planner/CoursePlannerContainer.jsx`
- **Display**: `/mern/client/src/components/planner/CoursePlanner.jsx`
- **Purpose**: Interactive 4×3 grid for course scheduling over four academic years
- **Key Features**:
  - Drag-and-drop course placement
  - Dynamic slot expansion
  - Duplicate prevention system
  - Unit calculations per term/year
  - Audit data auto-population

### 🔹 4. [LocalStorageSync](./4_LocalStorageSync.md) ⚠️ REMOVED
**Persistence Across Page Reloads**
- **Status**: Feature was implemented and then completely removed
- **Purpose**: Browser-based persistence of schedule data
- **Previous Features**: Auto-save, clear storage, reload handling
- **Current State**: No persistence - schedule resets on page reload

### 🔹 5. [GoogleSheetsExporter](./5_GoogleSheetsExporter.md)
**Export Schedule to Google Sheets API** 
- **Backend Route**: `/mern/server/routes/export.js`
- **Frontend Button**: Located below 4th year in planner grid
- **Purpose**: Creates formatted Google Sheets from current schedule
- **Key Features**:
  - Service account authentication
  - CSV template formatting
  - Auto-styling (bold headers, column sizing)
  - Public sharing permissions
  - Error handling and user feedback

### 🔹 6. [ChatWithLLM](./6_ChatWithLLM.md)
**FastAPI + Pinecone Integration**
- **Frontend**: `/mern/client/src/components/right-sidebar/RightSidebar.jsx`
- **Backend**: `/app/main.py` and `/app/rag_pipeline.py`
- **Purpose**: AI-powered course advisory using RAG architecture
- **Key Features**:
  - Vector similarity search with Pinecone
  - OpenAI/Anthropic LLM integration
  - Course recommendations
  - Real-time chat interface
  - Context-aware responses

### 🔹 7. [ClearScheduleButton](./7_ClearScheduleButton.md) ⚠️ REMOVED
**UI Reset Logic**
- **Status**: Feature was implemented and then completely removed
- **Purpose**: Reset entire planner to empty state
- **Previous Features**: Confirmation dialog, storage cleanup
- **Current State**: No clear button - manual refresh required

## File Structure Reference

### Frontend Components (`/mern/client/src/`)
```
components/
├── audit/
│   ├── SidebarAuditTracker.jsx      # Main audit parser & display
│   ├── AuditAccordionSection.jsx    # Individual requirement sections
│   └── AuditSectionBlock.jsx        # Legacy component
├── planner/
│   ├── CoursePlannerContainer.jsx   # Main planner logic
│   ├── CoursePlanner.jsx            # Grid display component
│   ├── YearBlock.jsx                # Year container
│   ├── TermBlock.jsx                # Term container
│   └── CourseCard.jsx               # Individual course display
├── right-sidebar/
│   ├── RightSidebar.jsx             # Chat & search container
│   ├── CourseSearch.jsx             # Course search functionality
│   ├── CourseDetails.jsx            # Course information display
│   └── CourseItem.jsx               # Search result items
├── LeftSidebar.jsx                  # Audit display container
└── MainLayout.jsx                   # App layout manager

utils/
├── auditParser.js                   # Client-side audit parsing
└── auditCoursePlanner.js            # Audit to planner conversion
```

### Backend Services (`/mern/server/` and `/app/`)
```
mern/server/
├── routes/
│   ├── export.js                    # Google Sheets export
│   ├── chat.js                      # Chat proxy to FastAPI
│   ├── search.js                    # Course search endpoint
│   └── upload.js                    # File upload handling
├── controllers/
│   └── searchController.js          # Course search logic
├── academic-planner-463804-202e89b2e5e4.json  # Google service account
├── academic_planner_template.csv    # Export template
└── server.js                        # Express app configuration

app/
├── main.py                          # FastAPI application
├── rag_pipeline.py                  # RAG system implementation
├── agent.py                         # LLM agent logic
├── requirements.txt                 # Python dependencies
└── .env                             # Environment variables
```

## Data Flow Diagrams

### Audit Processing Flow
```
HTML File Upload → DOMParser → Section Extraction → Status Detection → 
UI Display (Sidebar) + Schedule Population (Planner Grid)
```

### Chat System Flow  
```
User Message → React Frontend → Express Proxy → FastAPI → 
Pinecone Vector Search → LLM Generation → Response Chain
```

### Export Flow
```
Schedule State → Frontend Export Handler → Express Route → 
Google Sheets API → Formatted Spreadsheet → Public URL
```

## Development Setup

### Prerequisites
- **Node.js** (v16+) for React/Express
- **Python** (3.9+) for FastAPI
- **Google Cloud Account** for Sheets API
- **Pinecone Account** for vector database
- **OpenAI/Anthropic API Keys** for LLM access

### Quick Start Commands
```bash
# Frontend (React + Vite)
cd mern/client
npm install && npm run dev

# Backend (Express)  
cd mern/server
npm install && npm run start

# AI Backend (FastAPI)
cd app
pip install -r requirements.txt
python start_server.py
```

### Environment Configuration
Required environment variables in `/app/.env`:
```env
OPENAI_API_KEY=sk-your-key
PINECONE_API_KEY=pcsk-your-key
PINECONE_INDEX_NAME=course-embeddings
```

## Component Interactions

### State Management Flow
1. **MainLayout** holds global `parsedCourseData` state
2. **LeftSidebar** updates audit data via `onAuditDataUpdate` callback
3. **CoursePlannerContainer** receives audit data and populates schedule
4. **RightSidebar** operates independently for search/chat

### Data Transformation Chain
```
HTML Audit → Parsed Sections → Course Objects → Schedule Grid → Export Data
```

### API Endpoints
- **Chat**: `POST /chat` (Express) → `POST /chat` (FastAPI)
- **Search**: `POST /search-courses` (Express)
- **Export**: `POST /api/export/google-sheets` (Express)
- **Upload**: `POST /upload-degree-audit` (Express)

## Key Design Decisions

### Architecture Choices
- **Client-Side Parsing**: HTML parsing in browser vs. server
- **Three-Tier Design**: React → Express → FastAPI for modularity
- **Vector Database**: Pinecone for semantic course search
- **Service Account Auth**: Google API access without user OAuth

### UI/UX Decisions  
- **Drag-and-Drop**: Intuitive course placement
- **Color Coding**: Visual status indicators across components
- **Responsive Layout**: Fixed sidebar with flexible main content
- **Real-time Feedback**: Loading states and error handling

### Data Management
- **No Global State Library**: Props and callbacks for simplicity
- **Stateless Backend**: RESTful API design
- **Local Processing**: Client-side audit parsing for privacy
- **Duplicate Prevention**: Smart course placement logic

## Future Enhancement Opportunities

### Potential Features
- **Local Storage**: Re-implement schedule persistence
- **User Accounts**: Server-side data storage
- **Mobile Optimization**: Touch-friendly drag-and-drop
- **Advanced AI**: Course prerequisite validation
- **Collaboration**: Shared planning sessions

### Technical Improvements
- **Performance**: Virtual scrolling for large course lists
- **Accessibility**: Enhanced screen reader support
- **Testing**: Comprehensive test coverage
- **Documentation**: API documentation with OpenAPI
- **Monitoring**: Error tracking and analytics

## Troubleshooting Guide

### Common Issues
1. **Chat not working**: Check FastAPI server and API keys
2. **Export failing**: Verify Google service account permissions
3. **Audit parsing errors**: Check HTML file format
4. **Drag-and-drop issues**: Ensure browser supports HTML5 drag API
5. **Search not returning results**: Check course data JSON files

### Debug Commands
```bash
# Check server status
curl http://localhost:5050/health
curl http://localhost:8000/health

# Test chat endpoint
curl -X POST http://localhost:5050/chat -H "Content-Type: application/json" -d '{"message":"test"}'

# Test export
curl -X POST http://localhost:5050/api/export/google-sheets -H "Content-Type: application/json" -d '{"schedule":[],"yearLabels":[]}'
```

## Contributing Guidelines

### Code Organization
- **Component files**: One component per file with clear naming
- **Utility functions**: Separate files for reusable logic
- **Styling**: Tailwind CSS with semantic class names
- **Error handling**: Consistent error patterns across components

### Documentation Standards
- **File headers**: Purpose and key functionality overview
- **Function comments**: Parameter types and return values
- **Code examples**: Working code snippets in documentation
- **File paths**: Always include full paths for reference

---

*This documentation was generated to provide comprehensive technical reference for the AIVac Academic Planner application. Each component document contains detailed implementation specifics, architectural decisions, and file location references for developer understanding and maintenance.*