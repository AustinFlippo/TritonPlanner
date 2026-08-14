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

function getServiceAccountAuth() {
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

function googleErrorInfo(error) {
  const data = error?.response?.data?.error || error?.cause || {};
  return {
    message: data.message || error.message,
    reason: data.errors?.[0]?.reason || data.status || '',
    status: error.status || data.code || 500,
  };
}

function describeExportError(error) {
  if (error.code === 'GOOGLE_USER_AUTH_REQUIRED' || error.code === 'MISSING_GOOGLE_CREDENTIALS') {
    return error.message;
  }
  const { message, reason, status } = googleErrorInfo(error);
  if (status === 401 || reason === 'authError') {
    return 'Google sign-in expired. Sign out and sign back in, then export again.';
  }
  if (
    reason === 'storageQuotaExceeded' ||
    /storage quota/i.test(message) ||
    (status === 403 && /does not have permission/i.test(message))
  ) {
    return (
      'Google no longer lets service accounts own Drive files. Sign in with Google ' +
      'so the sheet is created in your Drive (sign out and back in if you already ' +
      'were), or set GOOGLE_SHARED_DRIVE_ID to a Shared Drive shared with the bot.'
    );
  }
  if (reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' || /insufficient.*scope/i.test(message)) {
    return 'Sheets access is missing. Sign out and sign back in so Google can grant it.';
  }
  return message;
}

async function getAuthClient(googleAccessToken) {
  if (typeof googleAccessToken === 'string' && googleAccessToken.trim()) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleAccessToken.trim() });
    return { authClient: oauth2Client, via: 'user' };
  }

  const sharedDriveId = process.env.GOOGLE_SHARED_DRIVE_ID;
  if (sharedDriveId) {
    return {
      authClient: await getServiceAccountAuth().getClient(),
      via: 'service_account',
      sharedDriveId,
    };
  }

  const err = new Error(
    'Sign in with Google so the sheet can be created in your Drive. ' +
      'If you are already signed in, sign out and back in to grant Sheets access.'
  );
  err.code = 'GOOGLE_USER_AUTH_REQUIRED';
  err.status = 401;
  throw err;
}

async function createSpreadsheet(authClient, title, sharedDriveId) {
  if (sharedDriveId) {
    const drive = google.drive({ version: 'v3', auth: authClient });
    const created = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [sharedDriveId],
      },
      supportsAllDrives: true,
      fields: 'id',
    });
    return { spreadsheetId: created.data.id, sheetId: 0 };
  }

  const createResponse = await sheets.spreadsheets.create({
    auth: authClient,
    resource: {
      properties: { title },
      sheets: [{ properties: { title: 'Course Schedule' } }],
    },
  });
  return {
    spreadsheetId: createResponse.data.spreadsheetId,
    sheetId: createResponse.data.sheets[0].properties.sheetId,
  };
}

const sheets = google.sheets({ version: 'v4' });

// POST /api/export/google-sheets
router.post('/google-sheets', async (req, res) => {
  try {
    const { schedule, yearLabels, googleAccessToken } = req.body;

    if (!schedule || !yearLabels) {
      return res.status(400).json({ error: 'Missing schedule or yearLabels data' });
    }

    const { authClient, sharedDriveId } = await getAuthClient(googleAccessToken);
    const title = `Academic Planner - ${new Date().toLocaleDateString()}`;
    const { spreadsheetId, sheetId } = await createSpreadsheet(
      authClient,
      title,
      sharedDriveId
    );



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

    // Link-sharing is best-effort. The owner (signed-in student, or the
    // Shared Drive) can always open the URL even if this fails.
    try {
      const drive = google.drive({ version: 'v3', auth: authClient });
      await drive.permissions.create({
        fileId: spreadsheetId,
        supportsAllDrives: Boolean(sharedDriveId),
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });
    } catch (shareErr) {
      console.warn('Sheets link-sharing skipped:', googleErrorInfo(shareErr).message);
    }

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

    res.json({
      success: true,
      spreadsheetId,
      url: spreadsheetUrl,
      message: 'Schedule exported to Google Sheets successfully!',
    });

  } catch (error) {
    console.error('Google Sheets export error:', error);
    const status = error.status || googleErrorInfo(error).status || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: 'Failed to export to Google Sheets',
      details: describeExportError(error),
    });
  }
});

export default router;