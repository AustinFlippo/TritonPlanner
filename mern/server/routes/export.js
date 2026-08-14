import express from 'express';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables from root .env file
dotenv.config({ path: path.join(process.cwd(), '../../.env') });

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Service-account key for Sheets + Drive. Hosted deploys should set this to the
// absolute Secret File path (Render: /etc/secrets/<name>.json). Relative values
// resolve from the repo root (credentials/...), not from mern/.
const GOOGLE_SERVICE_ACCOUNT_PATH =
  process.env.GOOGLE_SERVICE_ACCOUNT_PATH ||
  'credentials/triton-planner-3f3e351a505c.json';
const KEYFILE_PATH = path.isAbsolute(GOOGLE_SERVICE_ACCOUNT_PATH)
  ? GOOGLE_SERVICE_ACCOUNT_PATH
  : path.resolve(__dirname, '../../..', GOOGLE_SERVICE_ACCOUNT_PATH);

function getSheetsAuth() {
  if (!fs.existsSync(KEYFILE_PATH)) {
    const err = new Error(
      `Google service-account key not found at ${KEYFILE_PATH}. ` +
        'On Render, add the JSON as a Secret File and set ' +
        'GOOGLE_SERVICE_ACCOUNT_PATH to that absolute path ' +
        '(e.g. /etc/secrets/google-service-account.json).'
    );
    err.code = 'MISSING_GOOGLE_CREDENTIALS';
    throw err;
  }
  return new google.auth.GoogleAuth({
    keyFile: KEYFILE_PATH,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
}

const sheets = google.sheets({ version: 'v4' });

// POST /api/export/google-sheets
router.post('/google-sheets', async (req, res) => {
  try {
    const { schedule, yearLabels } = req.body;

    if (!schedule || !yearLabels) {
      return res.status(400).json({ error: 'Missing schedule or yearLabels data' });
    }

    // Get authenticated client
    const authClient = await getSheetsAuth().getClient();

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
    const headers = ['Year', 'Quarter', 'Course Slot 1', 'Course Slot 2', 'Course Slot 3', 'Term Units', 'Notes'];
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

    // Note: To make the spreadsheet publicly viewable, enable Google Drive API
    const drive = google.drive({ version: 'v3', auth: authClient });
    await drive.permissions.create({
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
    res.status(500).json({ 
      error: 'Failed to export to Google Sheets',
      details: error.message 
    });
  }
});

export default router;