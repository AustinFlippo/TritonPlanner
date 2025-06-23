# 🔹 2. LeftSidebarAuditView Documentation

## Overview
The LeftSidebarAuditView provides a visual representation of parsed degree audit data as interactive, collapsible dropdowns in the application's left sidebar. This component displays graduation progress, requirements status, and course completion details with color-coded indicators.

## Core Files
- **Main Container**: `/mern/client/src/components/LeftSidebar.jsx`
- **Audit Tracker**: `/mern/client/src/components/audit/SidebarAuditTracker.jsx`
- **Accordion Sections**: `/mern/client/src/components/audit/AuditAccordionSection.jsx`
- **Utility Functions**: `/mern/client/src/utils/auditParser.js`

## Component Architecture

### LeftSidebar.jsx
**Location**: `/mern/client/src/components/LeftSidebar.jsx`

Main container component that includes navigation and the audit tracker:
```javascript
const LeftSidebar = ({ parsedCourseData, onAuditDataUpdate }) => {
  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Navigation tabs */}
      <SidebarAuditTracker 
        auditData={parsedCourseData} 
        onAuditDataUpdate={onAuditDataUpdate}
      />
    </div>
  );
};
```

### SidebarAuditTracker.jsx
**Location**: `/mern/client/src/components/audit/SidebarAuditTracker.jsx`

The core audit display component managing upload, parsing, and visualization.

#### State Management
```javascript
const [auditSections, setAuditSections] = useState([]);
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);
const [uploadProgress, setUploadProgress] = useState(null);
```

## Visual Rendering System

### Progress Summary Display
**Lines 255-284 in SidebarAuditTracker.jsx**

#### Units Completed Indicator
```javascript
{/* Units Completed - Top priority display */}
{auditData?.metadata?.unitsCompleted !== undefined && (
  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-purple-800">Units Completed</span>
      <span className="text-lg font-bold text-purple-800">{auditData.metadata.unitsCompleted}</span>
    </div>
  </div>
)}
```

#### Status Count Cards
```javascript
// Completed Requirements (Green)
<div className="bg-green-50 border border-green-200 rounded-lg p-3">
  <span className="text-lg font-bold text-green-800">{statusCounts.fulfilled}</span>
</div>

// In Progress Requirements (Blue)  
<div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
  <span className="text-lg font-bold text-blue-800">{statusCounts.in_progress}</span>
</div>

// Remaining Requirements (Red)
<div className="bg-red-50 border border-red-200 rounded-lg p-3">
  <span className="text-lg font-bold text-red-800">{statusCounts.not_fulfilled}</span>
</div>
```

### Dropdown Generation Logic

#### Section Mapping
**Lines 296-312 in SidebarAuditTracker.jsx**
```javascript
{auditSections.map((section, index) => {
  // Rename "The following courses" sections to "In Progress"
  let displayTitle = section.title;
  if (section.title && section.title.toLowerCase().startsWith('the following courses')) {
    displayTitle = 'In Progress';
  }
  
  return (
    <AuditAccordionSection
      key={`${section.title}-${index}`}
      title={displayTitle}
      status={section.status}
      items={section.items || []}
    />
  );
})}
```

### AuditAccordionSection.jsx
**Location**: `/mern/client/src/components/audit/AuditAccordionSection.jsx`

Individual collapsible section component for each requirement category.

#### Color Indicator System
**Lines 20-38 in AuditAccordionSection.jsx**
```javascript
const getStatusConfig = (status) => {
  switch (status) {
    case 'fulfilled':
      return {
        bgColor: 'bg-green-100',
        borderColor: 'border-green-300', 
        textColor: 'text-green-800',
        icon: '✓' // Checkmark
      };
    case 'in_progress':
      return {
        bgColor: 'bg-yellow-100',
        borderColor: 'border-yellow-300',
        textColor: 'text-yellow-800', 
        icon: '⏳' // Clock
      };
    case 'not_fulfilled':
      return {
        bgColor: 'bg-red-100',
        borderColor: 'border-red-300',
        textColor: 'text-red-800',
        icon: '❌' // X mark
      };
  }
};
```

#### Collapsible Functionality
```javascript
const [isExpanded, setIsExpanded] = useState(false);

const toggleExpanded = () => {
  setIsExpanded(!isExpanded);
};

// Header with click handler
<div 
  className="flex items-center justify-between p-3 cursor-pointer"
  onClick={toggleExpanded}
>
  {/* Content shows/hides based on isExpanded */}
  {isExpanded && (
    <div className="px-3 pb-3">
      {items.map((item, index) => (
        <div key={index} className="text-sm text-gray-700 mb-1">
          {item}
        </div>
      ))}
    </div>
  )}
</div>
```

## Course Item Processing

### Individual Course Display
Each course item is displayed as a formatted string:
```
"DSC 100 - Intro to Data Science (FA24, A)"
"MATH 18 - Linear Algebra (WI25, WIP)" 
"NEEDS: 2 Courses | Available: DSC 102, CSE 110"
```

### Grade-Based Color Logic
**Function**: `isCourseCompleted()` in `AuditAccordionSection.jsx`
```javascript
const isCourseCompleted = (item) => {
  // Extract grade from course string
  const gradeMatch = item.match(/\(([^,]+),\s*([^)]+)\)/);
  if (!gradeMatch) return false;
  
  const grade = gradeMatch[2].trim().toLowerCase();
  
  // Green highlighting logic
  if (!grade || grade === '' || grade === 'nr' || grade === 'wip' ||
      grade.includes('wip') || grade.includes('progress')) {
    return false; // Yellow for in-progress
  }
  return true; // Green for completed
};
```

## Duplicate Course Handling

### Sidebar vs. Planner Policy
**Key Difference**: The sidebar allows duplicate courses across sections, while the planner prevents duplicates.

#### Sidebar Duplicate Logic
```javascript
// In SidebarAuditTracker.jsx - duplicates are preserved
items.push(`${courseCode} - ${description} (${term}, ${displayGrade})`);
// No duplicate checking - shows course in every relevant section
```

#### Why Duplicates Are Allowed
1. **Audit Accuracy**: Shows exactly what appears in official audit
2. **Requirement Tracking**: Same course may fulfill multiple requirements
3. **Cross-listing**: Courses with multiple department codes
4. **User Understanding**: Matches official university documentation

### Example Duplicate Scenario
```
Section: "Core CS Requirements"
- DSC 100 - Intro to Data Science (FA24, A)

Section: "Statistics Requirements"  
- DSC 100 - Intro to Data Science (FA24, A)  // Same course, different context
```

## Scrolling Behavior

### Container Layout
**Lines 203-331 in SidebarAuditTracker.jsx**
```javascript
<div className="audit-tracker h-full flex flex-col">
  {/* Header - Fixed */}
  <div className="p-4 border-b border-gray-200 bg-white flex-shrink-0">
    {/* Upload and progress summary - always visible */}
  </div>

  {/* Scrollable Content Area */}
  <div className="flex-1 overflow-y-auto">
    {/* Requirements List - scrollable */}
    <div className="p-4">
      {auditSections.map((section, index) => (
        <AuditAccordionSection {...props} />
      ))}
    </div>
  </div>
</div>
```

### Scroll Implementation
- **Fixed Header**: Upload area and progress cards remain visible
- **Flex Layout**: Uses `flex-1 overflow-y-auto` for automatic scrolling
- **Touch Friendly**: Smooth scrolling on mobile devices
- **Performance**: Virtualization not needed due to limited audit sections

## User Interactivity

### Upload Workflow
1. **File Selection**: Click dashed border area or choose file button
2. **Processing**: Loading spinner with progress messages
3. **Success**: Audit sections populate with color-coded status
4. **Error Handling**: Red error message with retry option

### Section Interaction
1. **Click to Expand**: Click section header to view courses
2. **Visual Feedback**: Hover effects and transitions
3. **Status at Glance**: Color and icon indicate completion status
4. **Detailed View**: Expanded sections show individual courses and requirements

### Progress Tracking
```javascript
// Real-time updates as sections are parsed
setUploadProgress('Processing audit...');
setUploadProgress('Extracting requirements...');
setUploadProgress('Calculating progress...');
setUploadProgress(null); // Complete
```

## Global State Synchronization

### Data Flow Integration
**MainLayout.jsx Integration**:
```javascript
const [parsedCourseData, setParsedCourseData] = useState({
  sections: [],
  metadata: {}
});

// Callback from audit tracker
const handleAuditDataUpdate = (auditResult) => {
  setParsedCourseData(auditResult);
  // This triggers updates in other components
};

<LeftSidebar 
  parsedCourseData={parsedCourseData}
  onAuditDataUpdate={handleAuditDataUpdate}
/>
```

### Cross-Component Updates
1. **Audit Upload** → Updates `parsedCourseData` 
2. **Planner Population** → `CoursePlannerContainer` receives new data
3. **Course Search** → Right sidebar can reference audit requirements
4. **Export Function** → Includes audit status in exported sheets

## Styling and Theming

### Tailwind CSS Classes
```javascript
// Main container
"w-80 bg-white border-r border-gray-200 flex flex-col h-full"

// Progress cards
"bg-purple-50 border border-purple-200 rounded-lg p-3"
"bg-green-50 border border-green-200 rounded-lg p-3"

// Upload area
"border-2 border-dashed border-gray-300 rounded-lg p-3 text-center hover:border-blue-400"
```

### Responsive Design
- **Fixed Width**: 320px (w-80) for consistent layout
- **Full Height**: Uses available vertical space
- **Mobile Adaptation**: Maintains usability on smaller screens
- **Color Accessibility**: High contrast ratios for all status indicators

## Performance Optimizations

### Efficient Rendering
- **Conditional Rendering**: Only shows sections when data exists
- **Key Optimization**: Stable keys prevent unnecessary re-renders
- **State Updates**: Batched updates during parsing process
- **Memory Management**: Cleans up DOM parser instances

### Large Audit Handling
- **Chunked Processing**: Breaks large HTML files into manageable pieces
- **Async Operations**: Non-blocking file reading and parsing
- **Error Boundaries**: Graceful degradation for malformed data
- **Progress Indicators**: User feedback during long operations