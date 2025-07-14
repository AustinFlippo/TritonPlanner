import express from 'express';
import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import dotenv from 'dotenv';





const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure Google Sheets API
let auth = null;
let sheets = null;
let drive = null;

// Initialize Google API clients
function initializeGoogleAPI() {
  try {
    // Check if we're in production (Render) with secret files
    if (process.env.NODE_ENV === 'production') {
      // On Render, secret files are mounted at /etc/secrets/
      const KEYFILE_PATH = process.env.GOOGLE_SHEETS_KEY_FILENAME_IN_RENDER;
      console.log('Production: Looking for service account key at:', KEYFILE_PATH);
      
      auth = new google.auth.GoogleAuth({
        keyFile: KEYFILE_PATH,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive'
        ]
      });
    } else {
      // Development: Try to use service account from environment variable or local file
      const serviceAccountKey = process.env.GOOGLE_SHEETS_KEY_LOCAL_PATH;
      
      if (serviceAccountKey) {

        // Read JSON from file 
        const keyFileContents = fs.readFileSync(serviceAccountKey, 'utf8');
        // Parse JSON from environment variable
        const credentials = JSON.parse(keyFileContents);
        auth = new google.auth.GoogleAuth({
          credentials: credentials,
          scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
          ]
        });
        console.log('Development: Using service account from environment variable');
      } else {
        // Fallback to local file (for development)
        const localKeyPath =  process.env.GOOGLE_SHEETS_KEY_LOCAL_PATH;
        console.log('Development: Looking for service account key at:', localKeyPath);
        
        auth = new google.auth.GoogleAuth({
          keyFile: localKeyPath,
          scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
          ]
        });
      }
    }
    
    sheets = google.sheets({ version: 'v4' });
    drive = google.drive({ version: 'v3' });
    
    console.log('✅ Google API initialized successfully');
    return true;
    
  } catch (error) {
    console.error('❌ Failed to initialize Google API:', error.message);
    return false;
  }
}

// Initialize on startup
const isGoogleAPIReady = initializeGoogleAPI();

// POST /api/export/google-sheets
router.post('/google-sheets', async (req, res) => {
  try {
    // Check if Google API is ready
    if (!isGoogleAPIReady || !auth) {
      return res.status(503).json({ 
        error: 'Google Sheets service is not available',
        details: 'Service account credentials not configured properly'
      });
    }

    const { schedule, yearLabels, studentName } = req.body;

    if (!schedule || !yearLabels) {
      return res.status(400).json({ error: 'Missing schedule or yearLabels data' });
    }

    // Get authenticated client
    const authClient = await auth.getClient();

    // Create a new spreadsheet with student name
    const titleName = studentName || 'Student';
    const createResponse = await sheets.spreadsheets.create({
      auth: authClient,
      resource: {
        properties: {
          title: `${titleName}'s Audit - ${new Date().toLocaleDateString()}`,
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



    // Helper function to get course display string
    function getCourseDisplay(course) {
      if (!course) return '';
      
      // Support multiple possible property names for course ID
      const courseId = course.course_id || course.code || course.title || '';
      
      // Support multiple possible property names for course name  
      const courseName = course.course_name || course.name || course.title || '';
      
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

    // Prepare data following the CSV template format
    const headers = ['Year', 'Quarter', 'Course Slot 1', 'Course Slot 2', 'Course Slot 3', 'Term Units'];
    const rows = [headers];

    // Convert schedule data to CSV format
    schedule.forEach((year, yearIndex) => {
      const yearLabel = yearLabels[yearIndex];
      
      // Fall term
      const fallCourses = year.fall || [];
      const fallRow = [
        yearLabel,
        'Fall',
        getCourseDisplay(fallCourses[0]),
        getCourseDisplay(fallCourses[1]),
        getCourseDisplay(fallCourses[2]),
        calculateTermUnits(fallCourses),
        ''
      ];
      rows.push(fallRow);

      // Winter term
      const winterCourses = year.winter || [];
      const winterRow = [
        yearLabel,
        'Winter',
        getCourseDisplay(winterCourses[0]),
        getCourseDisplay(winterCourses[1]),
        getCourseDisplay(winterCourses[2]),
        calculateTermUnits(winterCourses),
        ''
      ];
      rows.push(winterRow);

      // Spring term
      const springCourses = year.spring || [];
      const springRow = [
        yearLabel,
        'Spring',
        getCourseDisplay(springCourses[0]),
        getCourseDisplay(springCourses[1]),
        getCourseDisplay(springCourses[2]),
        calculateTermUnits(springCourses),
        ''
      ];
      rows.push(springRow);
    });

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

    // Make the spreadsheet publicly viewable
    await drive.permissions.create({
      auth: authClient,
      fileId: spreadsheetId,
      resource: {
        role: 'reader',
        type: 'anyone',
      },
    });

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

    res.json({
      success: true,
      spreadsheetId,
      url: spreadsheetUrl,
      message: 'Schedule exported to Google Sheets successfully!',
    });

  } catch (error) {
    console.error('Google Sheets export error:', error);
    console.error('Error stack:', error.stack);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to export to Google Sheets';
    let statusCode = 500;
    
    if (error.message.includes('auth') || error.message.includes('credential')) {
      errorMessage = 'Authentication failed - check service account credentials';
      statusCode = 401;
    } else if (error.message.includes('quota') || error.message.includes('limit')) {
      errorMessage = 'Google API quota exceeded - please try again later';
      statusCode = 429;
    } else if (error.message.includes('permission')) {
      errorMessage = 'Insufficient permissions to create Google Sheets';
      statusCode = 403;
    }
    
    res.status(statusCode).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Health check endpoint for Google Sheets integration
router.get('/health', async (req, res) => {
  try {
    if (!isGoogleAPIReady || !auth) {
      return res.status(503).json({
        status: 'unhealthy',
        service: 'google-sheets',
        error: 'Google API not initialized',
        timestamp: new Date().toISOString()
      });
    }
    
    // Test authentication
    const authClient = await auth.getClient();
    
    res.json({
      status: 'healthy',
      service: 'google-sheets',
      authenticated: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'google-sheets',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;