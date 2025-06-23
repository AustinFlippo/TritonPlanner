# 🔹 3. FourYearPlannerGrid Documentation

## Overview
The FourYearPlannerGrid is the central component of the academic planner, providing a visual 4×3 grid layout representing four academic years with three terms each (Fall, Winter, Spring). This component handles course scheduling, drag-and-drop functionality, and automatic population from parsed audit data.

## Core Files
- **Container Component**: `/mern/client/src/components/planner/CoursePlannerContainer.jsx`
- **Display Component**: `/mern/client/src/components/planner/CoursePlanner.jsx`
- **Year Components**: `/mern/client/src/components/planner/YearBlock.jsx`
- **Term Components**: `/mern/client/src/components/planner/TermBlock.jsx`
- **Course Components**: `/mern/client/src/components/planner/CourseCard.jsx`
- **Utility Integration**: `/mern/client/src/utils/auditCoursePlanner.js`

## Architecture Overview

### CoursePlannerContainer.jsx
**Location**: `/mern/client/src/components/planner/CoursePlannerContainer.jsx`

Main container managing all planner state and business logic.

#### Core State Structure
```javascript
const [schedule, setSchedule] = useState(
  Array(4).fill().map(() => ({
    fall: Array(3).fill(null),    // 3 course slots minimum
    winter: Array(3).fill(null),
    spring: Array(3).fill(null),
  }))
);

const [yearLabels] = useState([
  "2024-2025",  // Academic year format
  "2025-2026", 
  "2026-2027",
  "2027-2028",
]);
```

#### Dynamic Slot Management
```javascript
// Slots expand as needed beyond the minimum 3
// Example: fall: [course1, course2, course3, course4, null]
//          ^--- 4 courses + 1 empty slot for future additions
```

## Grid Layout System

### 4×3 Layout Structure
```
Year 1 (2024-2025)    Year 2 (2025-2026)    Year 3 (2026-2027)    Year 4 (2027-2028)
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ Fall   │ 12 units│   │ Fall   │ 16 units│   │ Fall   │ 12 units│   │ Fall   │ 12 units│
│ Winter │  8 units│   │ Winter │ 12 units│   │ Winter │ 16 units│   │ Winter │  8 units│
│ Spring │ 16 units│   │ Spring │ 12 units│   │ Spring │ 12 units│   │ Spring │ 16 units│
└─────────────────┘   └─────────────────┘   └─────────────────┘   └─────────────────┘
  Total: 36 units      Total: 40 units      Total: 40 units      Total: 36 units
```

### CoursePlanner.jsx
**Location**: `/mern/client/src/components/planner/CoursePlanner.jsx`

Pure presentation component rendering the grid layout.

```javascript
const CoursePlanner = ({ 
  schedule, yearLabels, collapsedYears, 
  // ... all handlers passed as props
}) => {
  return (
    <div className="[&>*]:m-4">
      {schedule.map((year, yearIndex) => (
        <YearBlock
          year={year}
          yearIndex={yearIndex}
          yearLabel={yearLabels[yearIndex]}
          // ... all props and handlers
        />
      ))}
      
      {/* Export Button */}
      <div className="mt-6 px-4">
        <button onClick={onExportToSheets}>
          Export to Google Sheets
        </button>
      </div>
    </div>
  );
};
```

## Course Slot Management

### Dynamic Slot Expansion
**Lines 150-172 in CoursePlannerContainer.jsx**
```javascript
const handleRemoveCourse = (yearIndex, term, courseIndex) => {
  const newSchedule = [...schedule];
  const termCourses = newSchedule[yearIndex][term];

  // Remove the course
  termCourses[courseIndex] = null;

  // Count nulls
  const nullCount = termCourses.filter((c) => c === null).length;

  // Trim excess nulls if more than 1 null and total > 3 slots
  if (termCourses.length > 3 && nullCount > 1) {
    const trimmed = termCourses.filter((c) => c !== null);
    
    // Ensure 3 slots minimum + 1 empty
    while (trimmed.length < 2) trimmed.push(null);
    trimmed.push(null); // Always one empty slot
    
    newSchedule[yearIndex][term] = trimmed;
  }
  
  setSchedule(newSchedule);
};
```

### Slot Addition Logic
```javascript
// When dropping a course on a term:
// 1. If empty slot exists, fill it
// 2. If all slots full, add new slot at end
// 3. Always maintain at least one empty slot for future additions
```

## Audit Data Population

### Automatic Schedule Population
**Lines 31-50 in CoursePlannerContainer.jsx**
```javascript
// Effect to populate courses from audit data
useEffect(() => {
  if (!parsedCourseData.sections || parsedCourseData.sections.length === 0) {
    console.log('No audit sections to process');
    return;
  }

  console.log('Processing audit data for planner:', parsedCourseData.sections);
  
  // Create fresh schedule
  const emptySchedule = Array(4).fill().map(() => ({
    fall: Array(3).fill(null),
    winter: Array(3).fill(null),
    spring: Array(3).fill(null),
  }));

  // Process audit sections and populate schedule
  const updatedSchedule = processAuditForPlanner(parsedCourseData.sections, emptySchedule);
  setSchedule(updatedSchedule);
}, [parsedCourseData]);
```

### processAuditForPlanner Integration
**Location**: `/mern/client/src/utils/auditCoursePlanner.js`

Main orchestration function for audit-to-planner conversion:

```javascript
export function processAuditForPlanner(auditSections, emptySchedule) {
  console.log('🎯 Processing audit data for planner...');
  
  // Convert audit data to planner-compatible course objects
  const auditCourses = convertAuditToPlanner(auditSections);
  
  // Populate the schedule with audit courses
  const populatedSchedule = populatePlannerWithAuditCourses(auditCourses, emptySchedule);
  
  console.log('✅ Schedule populated with audit data');
  return populatedSchedule;
}
```

## Duplicate Prevention System

### Course Duplicate Detection
**Lines 115-125 in `/mern/client/src/utils/auditCoursePlanner.js`**
```javascript
function addCourseToSchedule(schedule, courseObj) {
  const { yearIndex, quarter } = courseObj;
  
  if (!schedule[yearIndex] || !schedule[yearIndex][quarter]) {
    return false;
  }
  
  const termArray = schedule[yearIndex][quarter];
  
  // Check for duplicates before adding
  const existingCourse = termArray.find(existing => 
    existing && existing.course_id === courseObj.course_id
  );
  
  if (existingCourse) {
    // Priority system: completed > current > planned
    if (shouldReplaceCourse(existingCourse, courseObj)) {
      const index = termArray.indexOf(existingCourse);
      termArray[index] = courseObj;
    }
    return true; // Course handled (duplicate resolved)
  }
  
  // Add to first available slot
  const emptyIndex = termArray.findIndex(slot => slot === null);
  if (emptyIndex !== -1) {
    termArray[emptyIndex] = courseObj;
    return true;
  }
  
  // Expand term if no empty slots
  termArray.push(courseObj);
  return true;
}
```

### Priority-Based Replacement
```javascript
function shouldReplaceCourse(existing, newCourse) {
  const statusPriority = { 
    completed: 3, 
    current: 2, 
    planned: 1 
  };
  
  const existingPriority = statusPriority[existing.status] || 0;
  const newPriority = statusPriority[newCourse.status] || 0;
  
  return newPriority > existingPriority;
}
```

## Color System Integration

### Status-Based Color Mapping
**Course objects include status field that determines visual styling:**

```javascript
const courseObject = {
  course_id: "DSC 100",
  course_name: "Intro to Data Science", 
  credits: 4,
  status: "completed", // "completed" | "current" | "planned"
  grade: "A",
  // ... other fields
};
```

### CourseCard Color Logic
**Location**: `/mern/client/src/components/planner/CourseCard.jsx`
```javascript
const getStatusColor = (status, grade) => {
  switch(status) {
    case 'completed':
      return 'bg-green-100 border-green-300 text-green-800'; // Green
    case 'current':
      return 'bg-yellow-100 border-yellow-300 text-yellow-800'; // Yellow  
    case 'planned':
    default:
      return 'bg-blue-100 border-blue-300 text-blue-800'; // Blue
  }
};
```

### Visual Status Indicators
- **Green**: ✓ Completed courses with grades
- **Yellow**: ⏳ Currently enrolled (WIP/NR grades)
- **Blue**: 📅 Planned future courses

## Drag-and-Drop System

### Drag Handler Implementation
**Lines 78-112 in CoursePlannerContainer.jsx**
```javascript
const handleDragStart = (e, course, sourceYearIndex, sourceTerm, sourceCourseIndex) => {
  // Store drag source information
  const dragData = {
    course,
    sourceYearIndex,
    sourceTerm, 
    sourceCourseIndex
  };
  
  e.dataTransfer.setData("application/json", JSON.stringify(dragData));
  e.dataTransfer.effectAllowed = "move";
};

const handleDrop = (e, targetYearIndex, targetTerm, targetCourseIndex) => {
  e.preventDefault();
  
  const dragData = JSON.parse(e.dataTransfer.getData("application/json"));
  const { course, sourceYearIndex, sourceTerm, sourceCourseIndex } = dragData;
  
  // Prevent dropping on same location
  if (sourceYearIndex === targetYearIndex && 
      sourceTerm === targetTerm && 
      sourceCourseIndex === targetCourseIndex) {
    return;
  }
  
  // Handle the course move
  moveCourse(dragData, targetYearIndex, targetTerm, targetCourseIndex);
};
```

### Drop Validation
```javascript
const handleDragOver = (e, yearIndex, term, courseIndex) => {
  e.preventDefault();
  
  // Visual feedback for valid drop zones
  setDragTarget({ yearIndex, term, courseIndex });
  
  // Check for invalid drops (duplicate courses, etc.)
  if (wouldCreateDuplicate(draggedCourse, yearIndex, term)) {
    setInvalidDrop(true);
  } else {
    setInvalidDrop(false);
  }
};
```

## Unit Calculation System

### Term Unit Calculation
**Lines 55-77 in CoursePlannerContainer.jsx**
```javascript
const calculateTermUnits = (courses) => {
  if (!courses || courses.length === 0) return 0;
  
  return courses.reduce((total, course) => {
    if (course && course.credits) {
      const credits = parseFloat(course.credits) || 0;
      return total + credits;
    }
    return total;
  }, 0);
};
```

### Annual Unit Calculation
```javascript
const calculateAnnualUnits = (year) => {
  const fallUnits = calculateTermUnits(year.fall || []);
  const winterUnits = calculateTermUnits(year.winter || []);
  const springUnits = calculateTermUnits(year.spring || []);
  
  return fallUnits + winterUnits + springUnits;
};
```

### Visual Unit Display
**Each term block shows:**
- Individual course units (e.g., "4.0u")
- Term total units (e.g., "12 units") 
- Annual total units (e.g., "36 units")

## State Management Utilities

### Slot Class Name Logic
**Lines 174-201 in CoursePlannerContainer.jsx**
```javascript
const getSlotClassName = (yearIndex, term, courseIndex) => {
  let className = "border rounded mb-2 p-2 ";

  // Drag target highlighting
  if (dragTarget.yearIndex === yearIndex &&
      dragTarget.term === term &&
      dragTarget.courseIndex === courseIndex) {
    if (invalidDrop) {
      className += "border-red-500 border-2 bg-red-50 ";
    } else {
      className += "border-blue-500 border-2 bg-blue-50 ";
    }
  }

  // Preview state highlighting
  if (previewState &&
      previewState.targetYearIndex === yearIndex &&
      previewState.targetTerm === term &&
      previewState.targetCourseIndex === courseIndex) {
    className += "border-yellow-400 border-2 bg-yellow-50 ";
  }

  return className;
};
```

### Collapsible Year Management
```javascript
const [collapsedYears, setCollapsedYears] = useState(Array(4).fill(false));

const toggleYearCollapse = (yearIndex) => {
  const newState = [...collapsedYears];
  newState[yearIndex] = !newState[yearIndex];
  setCollapsedYears(newState);
};
```

## Integration with Other Components

### Data Flow Connections
1. **Audit Parser** → Populates initial schedule via `processAuditForPlanner()`
2. **Course Search** → Adds courses via drag-and-drop from right sidebar
3. **Export System** → Reads current schedule for Google Sheets export
4. **Local Storage** → Persists schedule state across sessions (if implemented)

### Props Interface
```javascript
// From CoursePlannerContainer to CoursePlanner
const plannerProps = {
  schedule,                    // 4x3 course grid
  yearLabels,                 // Academic year labels
  collapsedYears,             // UI state for year sections
  toggleYearCollapse,         // Handler for expand/collapse
  calculateAnnualUnits,       // Unit calculation function
  calculateTermUnits,         // Term unit calculation
  handleDragStart,            // Drag-and-drop handlers
  handleDragEnd,
  handleDragOver,
  handleDrop,
  handleRemoveCourse,         // Course removal handler
  previewState,               // UI state for interactions
  getSlotClassName,           // Dynamic CSS classes
  onExportToSheets,           // Export functionality
  loading                     // Loading state for exports
};
```

## Performance Optimizations

### Efficient Re-rendering
- **Stable Keys**: Uses `yearIndex-termName-courseIndex` for React keys
- **Memo Usage**: Pure components prevent unnecessary renders
- **Batched Updates**: State changes grouped to minimize re-renders

### Memory Management
- **Course Objects**: Shared references prevent duplication
- **Event Handlers**: Optimized to avoid recreation on each render
- **DOM Manipulation**: Minimal direct DOM access, React-managed

### Large Schedule Handling
- **Virtualization**: Not needed due to fixed 4×3 grid size
- **Lazy Loading**: Course details loaded on-demand
- **Efficient Filtering**: Fast duplicate detection algorithms

## Export Integration

### Google Sheets Export Button
**Located below the fourth year in the grid layout:**
```javascript
{/* Export to Google Sheets Button */}
<div className="mt-6 px-4">
  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
    <button
      onClick={onExportToSheets}
      disabled={loading}
      className="bg-green-500 text-white px-6 py-3 rounded-lg"
    >
      {loading ? 'Exporting...' : 'Export to Google Sheets'}
    </button>
  </div>
</div>
```

### Export Data Format
The schedule is formatted for export with course IDs and units:
```javascript
// Example export data
{
  "schedule": [
    {
      "fall": [
        {"course_id": "DSC 100", "credits": 4},
        {"course_id": "MATH 18", "credits": 4}
      ],
      "winter": [...],
      "spring": [...]
    }
  ],
  "yearLabels": ["2024-2025", "2025-2026", "2026-2027", "2027-2028"]
}
```