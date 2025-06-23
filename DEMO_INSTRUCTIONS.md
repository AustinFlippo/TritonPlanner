# 🚀 Demo Mode Instructions

## Overview
This implementation includes demo functionality that automatically loads pre-parsed degree audit data to test the four-year planner integration. This allows you to see how the system works before connecting the actual PDF upload functionality.

## 🎯 How to Use Demo Mode

### Option 1: Use Demo Buttons (Recommended)
1. **Start the application**: `npm run dev` in the `mern/client` directory
2. **Navigate to the planner**: Click on the "4-Year Planner" tab
3. **Load sample data**: In the left sidebar, you'll see a yellow "DEMO MODE" section
4. **Click demo buttons**:
   - **"Load Austin's Data"**: Loads Austin's completed/current courses and requirements
   - **"Load Saaz's Data"**: Loads Saaz's course history (using Austin's requirements as template)

### Option 2: Auto-load on Page Load
If you want data to load automatically when the page loads:

1. Open `mern/client/src/components/MainLayout.jsx`
2. In the `useEffect` hook around line 33, uncomment these lines:
   ```javascript
   console.log("🎯 DEMO: Auto-loading Austin's degree audit data...");
   
   const demoData = {
     completed_courses: austinCompletedData.completed_courses || [],
     current_courses: austinCompletedData.current_courses || [],
     requirements: austinRequiredData.requirements || []
   };
   
   setParsedCourseData(demoData);
   ```
3. You'll also need to uncomment the imports at the top of the file

## 📊 What You'll See

### In the Four-Year Planner:
- **Green course cards**: Completed UCSD courses with checkmarks (✓) and grades
- **Yellow course cards**: Current/in-progress courses with progress indicators (⟳)
- **Correct placement**: Courses automatically placed in the right year/quarter based on term codes

### Course Examples:
- `"FA24"` courses → Year 0 (2024-2025), Fall quarter
- `"WI25"` courses → Year 0 (2024-2025), Winter quarter  
- `"SP25"` courses → Year 0 (2024-2025), Spring quarter

### In the Left Sidebar:
- **Completed courses section**: Shows all completed courses with grades and units
- **Requirements section**: Shows remaining degree requirements
- **Unit calculations**: Automatically calculated total units

## 🔄 How to Replace Demo with Real File Upload

When you're ready to connect the actual PDF upload functionality:

### Step 1: Remove Demo UI
In `mern/client/src/components/LeftSidebar.jsx`:
1. **Remove the demo imports** (lines 6-8):
   ```javascript
   // DELETE THESE LINES:
   import austinCompletedData from "../jsons/austinCompleted.json";
   import austinRequiredData from "../jsons/austinRequired.json";
   import saazCompletedData from "../jsons/saazCompleted.json";
   ```

2. **Remove the loadDemoData function** (lines ~97-135)

3. **Remove the demo UI section** (lines ~255-280):
   ```javascript
   // DELETE THIS ENTIRE SECTION:
   {/* DEMO SECTION - Remove this when implementing real file upload */}
   <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
     // ... all the demo buttons ...
   </div>
   ```

### Step 2: The Real Upload is Already Connected!
The real PDF upload functionality is already implemented in the `handleUpload` function (lines ~143-230). It:
- ✅ Sends PDF to `/upload-degree-audit` endpoint
- ✅ Receives parsed JSON response
- ✅ Updates the planner via `onParsedDataUpdate`
- ✅ Shows loading spinner during processing
- ✅ Handles errors with detailed logging

### Step 3: Update Backend (if needed)
Make sure your backend at `mern/server/routes/upload.js` is working and that the Python parser at `mern/parse_logic.py` returns JSON in this format:

```javascript
{
  "completed_courses": [
    {
      "term": "FA24",
      "course": "DSC 10", 
      "title": "Principles of Data Science",
      "units": 4.00,
      "grade": "A",
      "source": "ucsd"
    }
  ],
  "current_courses": [
    {
      "term": "WI25",
      "course": "MATH 18",
      "title": "Linear Algebra", 
      "units": 4.00,
      "source": "ucsd"
    }
  ],
  "requirements": [
    {
      "category": "Major Requirements",
      "subcategories": [
        {
          "name": "Lower Division",
          "required_courses": ["DSC 30", "DSC 40A"],
          "in_progress": ["DSC 20"]
        }
      ]
    }
  ]
}
```

## 🎨 Customization

### Adding More Demo Users:
1. Add their JSON files to `mern/client/src/jsons/`
2. Import them in `LeftSidebar.jsx`
3. Add a new case in the `loadDemoData` function
4. Add a new button in the demo UI section

### Changing Course Colors:
Edit `mern/client/src/components/planner/CourseCard.jsx` in the `getStatusStyling` function:
- **Completed**: Currently green (`bg-green-100`, `text-green-800`)
- **Current**: Currently yellow (`bg-yellow-100`, `text-yellow-800`)

## 🧪 Testing

The demo allows you to test:
- ✅ Term mapping (FA24 → Fall 2024, etc.)
- ✅ Course placement in correct year/quarter
- ✅ Visual styling (green for completed, yellow for current)
- ✅ Unit calculations
- ✅ Grade display
- ✅ Drag and drop functionality (still works with demo courses)
- ✅ Requirements display in sidebar

## 📝 Files Modified

### Core Implementation:
- `MainLayout.jsx` - Data flow management
- `CoursePlannerContainer.jsx` - Term mapping and course processing
- `CourseCard.jsx` - Visual styling for different course states
- `TermBlock.jsx` - UI updates for better course display
- `LeftSidebar.jsx` - Upload handling and demo functionality

### Demo Files:
- `austinCompleted.json` - Austin's course data
- `austinRequired.json` - Austin's requirements
- `saazCompleted.json` - Saaz's course data

This demo setup lets you fully test the degree audit integration before connecting it to the real PDF upload system!