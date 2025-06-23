# 🔹 1. DegreeAuditParser Documentation

## Overview
The DegreeAuditParser is a comprehensive system for uploading and parsing HTML degree audit files into structured JavaScript objects. This system enables students to upload their university degree audit and automatically populate their academic planner.

## Core Files
- **Main Component**: `/mern/client/src/components/audit/SidebarAuditTracker.jsx`
- **Utility Parser**: `/mern/client/src/utils/auditParser.js`
- **Supporting Component**: `/mern/client/src/components/audit/AuditAccordionSection.jsx`

## Architecture Overview

### SidebarAuditTracker.jsx
**Location**: `/mern/client/src/components/audit/SidebarAuditTracker.jsx`

This is the primary component that handles the entire audit parsing workflow:

```javascript
const SidebarAuditTracker = ({ auditData, onAuditDataUpdate }) => {
  const [auditSections, setAuditSections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // ... state management
}
```

## HTML Parsing Logic

### File Upload Handler
**Function**: `handleFileUpload()` in `SidebarAuditTracker.jsx` (lines 18-197)

```javascript
const handleFileUpload = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  
  const htmlText = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  // ... parsing logic
}
```

### Section Identification Strategy

#### 1. Major Requirements Detection
**Lines 38-52 in SidebarAuditTracker.jsx**
```javascript
// Find the MAJOR REQUIREMENTS starting point
const majorReqHeader = Array.from(doc.querySelectorAll('.reqHeader'))
  .find(header => header.textContent.includes('MAJOR REQUIREMENTS'));

const startingReq = majorReqHeader.closest('.requirement');
```

The parser specifically looks for:
- `.reqHeader` elements containing "MAJOR REQUIREMENTS"
- Starts parsing from this section onwards
- Ignores general education and other preliminary sections

#### 2. Section Parsing Function
**Function**: `parseRequirementSection()` in `SidebarAuditTracker.jsx` (lines 87-187)

**Section Categories Identified**:
- **Completed Courses**: `.completedCourses .takenCourse`
- **Work In Progress**: Special handling for sections with "WORK IN PROGRESS" in title
- **Requirements Not Fulfilled**: `.subreqNeeds` elements
- **Available Course Options**: `.selectcourses .course .number`

### Data Extraction Process

#### Course Information Extraction
**Lines 114-138 in SidebarAuditTracker.jsx**
```javascript
courseRows.forEach(row => {
  const courseElement = row.querySelector('.course');
  const descElement = row.querySelector('.descLine');
  const termElement = row.querySelector('.term');
  const gradeElement = row.querySelector('.grade');
  
  const courseCode = courseElement.textContent.trim();
  const description = descElement.textContent.trim();
  const term = termElement ? termElement.textContent.trim() : '';
  const grade = gradeElement ? gradeElement.textContent.trim() : '';
  // ... processing
});
```

**Extracted Fields**:
- **Course ID**: From `.course` elements (e.g., "DSC 100")
- **Course Title**: From `.descLine` elements
- **Term**: From `.term` elements (e.g., "FA24", "WI25")
- **Units**: From `.credit` elements (typically 4.0)
- **Grade**: From `.grade` elements (A, B, C, etc.)

### Fulfillment Status Logic

#### Grade-Based Status Determination
**Lines 129-134 in SidebarAuditTracker.jsx**
```javascript
// For WORK IN PROGRESS, mark courses with WIP/NR grades
let displayGrade = grade;
if (isWorkInProgress && (!grade || grade === '' || grade === 'NR')) {
  displayGrade = 'WIP';
}
```

**Status Categories**:
- **Fulfilled** (`.statusOK`): Green indicator, course completed with passing grade
- **In Progress** (`.statusIP`): Yellow indicator, currently taking course
- **Not Fulfilled** (`.statusNO`): Red indicator, requirement not met

### NEEDS Information Consolidation
**Lines 170-219 in SidebarAuditTracker.jsx**

The parser consolidates "NEEDS" requirements:
```javascript
// Enhanced NEEDS parsing - group NEEDS and Available courses together
const needsTable = subreq.querySelector('.subreqNeeds');
let needsDisplay = 'NEEDS: ';

// Check for course count vs units
const courseCountElement = needsTable.querySelector('.count.number');
const unitsElement = needsTable.querySelector('.hours.number');

if (courseCountElement && courseCountLabel.includes('Courses')) {
  needsDisplay += `${courseCountElement.textContent.trim()} Courses`;
} else if (unitsElement && unitsLabel.includes('Units')) {
  needsDisplay += `${unitsElement.textContent.trim()} Units`;
}
```

**Formats Supported**:
- "NEEDS: 2 Courses | Available: DSC 100, DSC 102"
- "NEEDS: 16.00 Units | Available: MATH 189, COGS 108"

### Edge Cases Handling

#### 1. Summer Course Filtering
**Location**: `/mern/client/src/utils/auditCoursePlanner.js` (lines 45-49)
```javascript
if (seasonCode === 'SU' || seasonCode === 'SM' ||
    (seasonCode.startsWith('S') && seasonCode !== 'SP' && /\d/.test(termString.substring(1)))) {
  return null; // Skip summer courses
}
```

#### 2. Work in Progress Special Handling
**Lines 78-91 in SidebarAuditTracker.jsx**
```javascript
const isWorkInProgress = title.includes('WORK IN PROGRESS');
// Special handling for courses without grades or with NR grades
```

#### 3. Duplicate Course Prevention
**Location**: `/mern/client/src/utils/auditCoursePlanner.js` (lines 115-125)
```javascript
// Check for duplicates before adding
const existingCourse = termArray.find(existing => 
  existing && existing.course_id === courseObj.course_id
);
if (existingCourse) {
  // Handle priority: completed > current > planned
}
```

### Units Calculation

#### EARNED Units Extraction
**Function**: `calculateUnitsCompleted()` in `SidebarAuditTracker.jsx` (lines 67-95)
```javascript
function calculateUnitsCompleted(doc) {
  // Find the main 180-unit requirement section
  const totalHrxElement = doc.querySelector('[rname="TOTALHRX"]');
  const earnedRow = totalHrxElement.querySelector('.requirementTotals .reqEarned');
  const earnedUnitsElement = earnedRow.querySelector('.hours.number');
  
  return parseFloat(earnedUnitsElement.textContent.trim());
}
```

This specifically targets the official "EARNED:" section showing completed units toward degree.

## Integration with Application

### Data Flow
1. **Upload**: User selects HTML audit file
2. **Parse**: `handleFileUpload()` processes HTML using DOMParser
3. **Structure**: Data organized into sections with status and items
4. **Callback**: `onAuditDataUpdate(auditResult)` notifies parent component
5. **Display**: `AuditAccordionSection` renders collapsible sections
6. **Planner Integration**: `processAuditForPlanner()` populates course schedule

### Data Structure Output
```javascript
const auditResult = {
  sections: [
    {
      title: "Core Computer Science Courses",
      status: "in_progress", // fulfilled | not_fulfilled | in_progress
      items: [
        "DSC 100 - Intro to Data Science (FA24, A)",
        "NEEDS: 2 Courses | Available: DSC 102, CSE 110",
        "MATH 18 - Linear Algebra (WI25, WIP)"
      ]
    }
  ],
  metadata: {
    totalSections: 8,
    fulfilledSections: 3,
    inProgressSections: 2,
    notFulfilledSections: 3,
    unitsCompleted: 98.0,
    parseTimestamp: "2024-01-15T10:30:00.000Z",
    parsedBy: "client"
  }
}
```

### UI Components Integration
- **Left Sidebar**: Displays parsed audit with progress indicators
- **Course Planner**: Auto-populates with completed and in-progress courses
- **Right Sidebar**: Course search can reference audit requirements

## Error Handling
- **File Format Validation**: Only accepts .html and .htm files
- **Parse Errors**: Graceful fallback with error messages
- **Missing Sections**: Warns when major requirements not found
- **Malformed HTML**: DOMParser handles most HTML irregularities

## Performance Considerations
- **Client-Side Parsing**: No server uploads required
- **DOM Manipulation**: Efficient querySelector usage
- **Memory Management**: Large HTML files processed in chunks
- **Async Processing**: Non-blocking file reading with loading states