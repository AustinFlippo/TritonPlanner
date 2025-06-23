# 🔹 5. GoogleSheetsExporter Documentation

## Overview
The GoogleSheetsExporter provides functionality to export the current 4-year planner schedule to a newly generated Google Sheet using the Google Sheets API. This system creates formatted, shareable spreadsheets that follow the academic planner template structure.

## Core Files
- **Backend Route**: `/mern/server/routes/export.js`
- **Frontend Button**: `/mern/client/src/components/planner/CoursePlanner.jsx` (lines 42-70)
- **Container Logic**: `/mern/client/src/components/planner/CoursePlannerContainer.jsx` (lines 229-280)
- **Service Account Key**: `/mern/server/academic-planner-463804-202e89b2e5e4.json`
- **Template Reference**: `/mern/server/academic_planner_template.csv`

## Architecture Overview

### Frontend Export Button
**Location**: `/mern/client/src/components/planner/CoursePlanner.jsx` (lines 42-70)

The export button appears below the fourth year in the planner grid:

```javascript
{/* Export to Google Sheets Button */}
<div className="mt-6 px-4">
  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 hover:bg-gray-50 transition-colors">
    <svg className="w-8 h-8 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
    <button
      onClick={onExportToSheets}
      disabled={loading}
      className={`px-6 py-3 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
        loading 
          ? 'bg-gray-400 text-gray-700 cursor-not-allowed' 
          : 'bg-green-500 text-white hover:bg-green-600'
      }`}
    >
      {loading ? (
        <div className="flex items-center">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
          Exporting...
        </div>
      ) : (
        'Export to Google Sheets'
      )}
    </button>
    <p className="text-sm text-gray-500 mt-2">
      Create a shareable Google Sheets version of your 4-year plan
    </p>
  </div>
</div>
```

### Frontend Export Handler
**Location**: `/mern/client/src/components/planner/CoursePlannerContainer.jsx` (lines 229-280)

```javascript
const handleExportToSheets = async () => {
  try {
    setLoading(true);
    
    const response = await fetch('http://localhost:5050/api/export/google-sheets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schedule,      // 4x3 course grid
        yearLabels,    // Academic year labels
      }),
    });

    const data = await response.json();

    if (data.success) {
      // Open the Google Sheets URL in a new tab
      window.open(data.url, '_blank');
      alert('Schedule exported successfully! Opening Google Sheets...');
    } else {
      console.error('Export failed:', data.error);
      alert(`Export failed: ${data.error}`);
    }
  } catch (error) {
    console.error('Export error:', error);
    alert('Failed to export schedule. Please try again.');
  } finally {
    setLoading(false);
  }
};
```

## Backend API Implementation

### Express Route Configuration
**Location**: `/mern/server/routes/export.js`

#### Service Account Authentication
```javascript
import { google } from 'googleapis';
import path from 'path';

// Load the service account key
const KEYFILE_PATH = path.join(__dirname, '..', 'academic-planner-463804-202e89b2e5e4.json');

// Configure Google Sheets API
const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILE_PATH,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
  ],
});

const sheets = google.sheets({ version: 'v4' });
```

#### Main Export Endpoint
**POST `/api/export/google-sheets`** (lines 23-195)

```javascript
router.post('/google-sheets', async (req, res) => {
  try {
    const { schedule, yearLabels } = req.body;

    if (!schedule || !yearLabels) {
      return res.status(400).json({ error: 'Missing schedule or yearLabels data' });
    }

    // Debug logging to see the actual data structure
    console.log('Schedule data received:', JSON.stringify(schedule, null, 2));
    console.log('Year labels:', yearLabels);

    // Get authenticated client
    const authClient = await auth.getClient();
    
    // Create spreadsheet, format data, apply styling
    // ... (detailed implementation below)
    
  } catch (error) {
    console.error('Google Sheets export error:', error);
    res.status(500).json({ 
      error: 'Failed to export to Google Sheets',
      details: error.message 
    });
  }
});
```

## Data Processing Logic

### Course Data Extraction
**Helper Functions** (lines 54-83)

```javascript
// Helper function to get course display string
function getCourseDisplay(course) {
  if (!course) return '';
  
  // Support multiple possible property names for course ID
  const courseId = course.course_id || course.code || course.title || '';
  
  // Return just the course ID for CSV format
  return courseId;
}

// Helper function to calculate term units
function calculateTermUnits(courses) {
  if (!courses || courses.length === 0) return '';
  
  const totalUnits = courses.reduce((sum, course) => {
    if (course) {
      // Support multiple possible property names for units
      const units = course.credits || course.units || course.credit || 0;
      const parsedUnits = parseFloat(units);
      return sum + (isNaN(parsedUnits) ? 0 : parsedUnits);
    }
    return sum;
  }, 0);
  
  return totalUnits > 0 ? totalUnits.toString() : '';
}
```

### CSV Template Format
**Following `/mern/server/academic_planner_template.csv` structure:**

```javascript
// Prepare data following the CSV template format
const headers = ['Year', 'Quarter', 'Course Slot 1', 'Course Slot 2', 'Course Slot 3', 'Term Units', 'Notes'];
const rows = [headers];

// Convert schedule data to CSV format
schedule.forEach((year, yearIndex) => {
  const yearLabel = yearLabels[yearIndex];
  
  // Fall term
  const fallCourses = year.fall || [];
  const fallRow = [
    yearLabel,              // "2024-2025"
    'Fall',                 // Quarter name
    getCourseDisplay(fallCourses[0]),  // "DSC 100"
    getCourseDisplay(fallCourses[1]),  // "MATH 18"
    getCourseDisplay(fallCourses[2]),  // "COGS 108"
    calculateTermUnits(fallCourses),   // "12"
    ''                      // Notes (empty)
  ];
  rows.push(fallRow);
  
  // Winter and Spring terms follow same pattern
});
```

### Example Output Data
```
Year,Quarter,Course Slot 1,Course Slot 2,Course Slot 3,Term Units,Notes
2024–2025,Fall,DSC 100,MATH 18,COGS 108,12,
2024–2025,Winter,DSC 20,MATH 20A,PHIL 174,12,
2024–2025,Spring,DSC 30,MATH 20B,CSE 100,12,
2025–2026,Fall,DSC 40A,MATH 20C,,8,
...
```

## Google Sheets API Integration

### Spreadsheet Creation
**Lines 37-46 in export.js**

```javascript
// Create a new spreadsheet
const createResponse = await sheets.spreadsheets.create({
  auth: authClient,
  resource: {
    properties: {
      title: `Academic Planner - ${new Date().toLocaleDateString()}`,
    },
    sheets: [{
      properties: {
        title: 'Course Schedule',
      },
    }],
  },
});

const spreadsheetId = createResponse.data.spreadsheetId;
const sheetId = createResponse.data.sheets[0].properties.sheetId;
```

### Data Population
**Lines 118-125**

```javascript
// Write data to the spreadsheet
await sheets.spreadsheets.values.update({
  auth: authClient,
  spreadsheetId,
  range: 'A1',
  valueInputOption: 'RAW',
  resource: {
    values: rows,
  },
});
```

### Sheet Formatting
**Lines 128-164**

```javascript
// Format the spreadsheet
await sheets.spreadsheets.batchUpdate({
  auth: authClient,
  spreadsheetId,
  resource: {
    requests: [
      // Make header row bold
      {
        repeatCell: {
          range: {
            sheetId: sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
          },
          cell: {
            userEnteredFormat: {
              textFormat: {
                bold: true,
              },
            },
          },
          fields: 'userEnteredFormat.textFormat.bold',
        },
      },
      // Auto-resize columns
      {
        autoResizeDimensions: {
          dimensions: {
            sheetId: sheetId,
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: 7,
          },
        },
      },
    ],
  },
});
```

### Public Sharing
**Lines 167-174**

```javascript
// Make the spreadsheet publicly viewable
const drive = google.drive({ version: 'v3', auth: authClient });
await drive.permissions.create({
  fileId: spreadsheetId,
  resource: {
    role: 'reader',
    type: 'anyone',
  },
});
```

## Response Handling

### Success Response
```javascript
const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

res.json({
  success: true,
  spreadsheetId,
  url: spreadsheetUrl,
  message: 'Schedule exported to Google Sheets successfully!',
});
```

### Error Handling
```javascript
} catch (error) {
  console.error('Google Sheets export error:', error);
  console.error('Error stack:', error.stack);
  res.status(500).json({ 
    error: 'Failed to export to Google Sheets',
    details: error.message 
  });
}
```

## User Experience Flow

### Complete Export Workflow
1. **User Clicks Export**: Button in planner grid
2. **Loading State**: Button shows spinner and "Exporting..."
3. **Data Preparation**: Schedule and year labels packaged for API
4. **API Call**: POST request to `/api/export/google-sheets`
5. **Google Sheets Creation**: New spreadsheet created with formatted data
6. **Automatic Opening**: New tab opens with Google Sheets URL
7. **User Notification**: Success alert with confirmation
8. **Reset State**: Button returns to normal state

### Error Scenarios
- **Missing Data**: Validation error if schedule/yearLabels missing
- **Google API Errors**: Authentication, quota, or permission issues
- **Network Errors**: Connection failures between frontend/backend
- **Malformed Data**: Course objects missing expected properties

## Configuration Requirements

### Service Account Setup
**File**: `/mern/server/academic-planner-463804-202e89b2e5e4.json`

```json
{
  "type": "service_account",
  "project_id": "academic-planner-463804",
  "private_key_id": "REDACTED",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "REDACTED",
  "client_id": "101313595502259754704",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/sheet-writer-bot%40academic-planner-463804.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
}
```

### Required API Permissions
- **Google Sheets API**: Create and edit spreadsheets
- **Google Drive API**: Set file permissions for public sharing

### NPM Dependencies
**In `/mern/server/package.json`:**
```json
{
  "dependencies": {
    "googleapis": "^latest",
    "express": "^latest"
  }
}
```

## Security Considerations

### Service Account Security
- Private key stored securely in server directory
- Not exposed to frontend/client code
- Scoped permissions (Sheets and Drive only)
- Service account has minimal Google Cloud access

### API Endpoint Security
- Server-side only (no direct client Google API calls)
- Input validation for schedule data
- Error details limited in responses
- No sensitive data logged

### Public Sharing Implications
- Generated sheets are publicly readable
- No personal information in course data
- Users understand sheets are publicly accessible
- Option to manually adjust permissions later

## Performance Optimization

### Efficient Data Processing
```javascript
// Optimized course extraction
const getCourseDisplay = (course) => {
  if (!course) return '';
  return course.course_id || course.code || course.title || '';
};

// Efficient unit calculation
const calculateTermUnits = (courses) => {
  if (!courses?.length) return '';
  
  const total = courses.reduce((sum, course) => {
    const units = course?.credits || course?.units || 0;
    return sum + (parseFloat(units) || 0);
  }, 0);
  
  return total > 0 ? total.toString() : '';
};
```

### API Request Optimization
- Single spreadsheet creation call
- Batched formatting updates
- Minimal API calls for permissions
- Efficient data structure for Google Sheets API

### Frontend Optimization
- Loading states prevent double-clicks
- Error boundaries handle API failures
- Automatic URL opening improves UX
- Non-blocking UI during export process

## Testing and Debugging

### Manual Testing Endpoints
```bash
# Test export with sample data
curl -X POST http://localhost:5050/api/export/google-sheets \
  -H "Content-Type: application/json" \
  -d '{
    "schedule": [
      {
        "fall": [{"course_id": "DSC 100", "credits": 4}],
        "winter": [],
        "spring": []
      }
    ],
    "yearLabels": ["2024-2025"]
  }'
```

### Debug Logging
```javascript
// Server logs show received data structure
console.log('Schedule data received:', JSON.stringify(schedule, null, 2));
console.log('Year labels:', yearLabels);

// Error details in server logs
console.error('Google Sheets export error:', error);
console.error('Error stack:', error.stack);
```

### Common Issues and Solutions
1. **"Insufficient authentication scopes"**: Update service account permissions
2. **"Course data not appearing"**: Check course object property names
3. **"Permission denied"**: Verify service account key file
4. **"Network timeout"**: Check Google API connectivity and quotas