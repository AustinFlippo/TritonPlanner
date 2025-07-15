import express from 'express';
import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { exportToPdf } from '../controllers/pdfController.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import dotenv from 'dotenv';





const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });



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
    
    sheets = google.sheets({ version: 'v4', auth });
    drive = google.drive({ version: 'v3', auth });
    
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

    console.log("Auth type:", auth.constructor.name);
    console.log("Auth key file path:", process.env.GOOGLE_SHEETS_KEY_FILENAME_IN_RENDER);

    console.log("✅ Authenticated successfully as:", authClient.email || "Unknown email");



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

// POST /api/export/pdf-schedule
router.post('/pdf-schedule', exportToPdf);

// POST /api/export/pdf - Compact grid-based PDF export
router.post('/pdf', async (req, res) => {
  try {
    const { studentName, plan } = req.body;

    if (!plan || !Array.isArray(plan)) {
      return res.status(400).json({ error: 'Invalid plan data provided' });
    }

    // Create a new PDF document in portrait orientation
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // Letter size, portrait (8.5x11)
    
    // Get form for fillable fields
    const form = pdfDoc.getForm();
    
    // Embed fonts
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Define colors
    const blueColor = rgb(0.29, 0.56, 0.89); // #4A90E2
    const whiteColor = rgb(1, 1, 1);
    const lightGrayColor = rgb(0.918, 0.918, 0.918); // #EAEAEA
    const darkGrayColor = rgb(0.75, 0.75, 0.75);
    const blackColor = rgb(0, 0, 0);
    
    // Layout constants (coordinate-based)
    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 50;
    const yearBlockWidth = pageWidth - (2 * margin); // 495 points
    const yearBlockHeight = 170;
    const yearBlockGap = 20;
    const yearHeaderHeight = 30;
    const termColumnWidth = yearBlockWidth / 3; // 165 points each
    const courseSlotWidth = 155;
    const courseSlotHeight = 35;
    const courseSlotGap = 5;
    
    // Add title
    if (studentName) {
      page.drawText(`Academic Plan - ${studentName}`, {
        x: margin,
        y: pageHeight - margin - 20,
        size: 16,
        font: boldFont,
        color: blackColor,
      });
    }
    
    // Starting Y position for first year block
    let currentY = pageHeight - margin - 50;
    
    // Process each year (maximum 4 years to fit on one page)
    for (let yearIndex = 0; yearIndex < Math.min(plan.length, 4); yearIndex++) {
      const yearData = plan[yearIndex];
      
      // Draw the outer year-block rectangle
      page.drawRectangle({
        x: margin,
        y: currentY - yearBlockHeight,
        width: yearBlockWidth,
        height: yearBlockHeight,
        color: lightGrayColor,
        borderColor: darkGrayColor,
        borderWidth: 1,
      });
      
      // Draw the blue year header
      page.drawRectangle({
        x: margin,
        y: currentY - yearHeaderHeight,
        width: yearBlockWidth,
        height: yearHeaderHeight,
        color: blueColor,
      });
      
      // Year title (left-aligned)
      page.drawText(yearData.year, {
        x: margin + 15,
        y: currentY - yearHeaderHeight + 8,
        size: 14,
        font: boldFont,
        color: whiteColor,
      });
      
      // Annual units display (right-aligned)
      const annualUnitsText = `Annual Units: ${yearData.annualUnits || 0}`;
      const annualUnitsWidth = font.widthOfTextAtSize(annualUnitsText, 12);
      page.drawText(annualUnitsText, {
        x: margin + yearBlockWidth - annualUnitsWidth - 15,
        y: currentY - yearHeaderHeight + 8,
        size: 12,
        font: boldFont,
        color: whiteColor,
      });
      
      // Draw the three term columns
      const termNames = ['Fall', 'Winter', 'Spring'];
      const termStartY = currentY - yearHeaderHeight - 10;
      
      for (let termIndex = 0; termIndex < 3; termIndex++) {
        const termData = yearData.terms[termIndex];
        const termX = margin + (termIndex * termColumnWidth);
        
        // Draw term sub-header
        page.drawText(termNames[termIndex], {
          x: termX + 10,
          y: termStartY,
          size: 12,
          font: boldFont,
          color: blackColor,
        });
        
        // Draw term units
        const termUnitsText = `${termData?.termUnits || 0} units`;
        const termUnitsWidth = font.widthOfTextAtSize(termUnitsText, 10);
        page.drawText(termUnitsText, {
          x: termX + termColumnWidth - termUnitsWidth - 10,
          y: termStartY,
          size: 10,
          font,
          color: blackColor,
        });
        
        // Draw three course slots for this term
        for (let courseIndex = 0; courseIndex < 3; courseIndex++) {
          const course = termData?.courses[courseIndex];
          const slotX = termX + 5;
          const slotY = termStartY - 25 - (courseIndex * (courseSlotHeight + courseSlotGap));
          
          // Draw course slot rectangle (white background)
          page.drawRectangle({
            x: slotX,
            y: slotY - courseSlotHeight,
            width: courseSlotWidth,
            height: courseSlotHeight,
            color: whiteColor,
            borderColor: darkGrayColor,
            borderWidth: 1,
          });
          
          if (course && course.code) {
            // Draw course information
            page.drawText(course.code, {
              x: slotX + 5,
              y: slotY - 15,
              size: 10,
              font: boldFont,
              color: blackColor,
            });
            
            if (course.title) {
              // Truncate long titles to fit
              let titleText = course.title;
              if (titleText.length > 25) {
                titleText = titleText.substring(0, 22) + '...';
              }
              page.drawText(titleText, {
                x: slotX + 5,
                y: slotY - 28,
                size: 8,
                font,
                color: blackColor,
              });
            }
          } else {
            // Create fillable text field for empty slots
            const fieldName = `${yearData.year}_${termNames[termIndex]}_slot_${courseIndex}`;
            const textField = form.createTextField(fieldName);
            textField.setText('Empty Slot');
            textField.setFontSize(9);
            textField.enableMultiline();
            
            textField.addToPage(page, {
              x: slotX + 1,
              y: slotY - courseSlotHeight + 1,
              width: courseSlotWidth - 2,
              height: courseSlotHeight - 2,
              font,
              textColor: rgb(0.5, 0.5, 0.5),
              backgroundColor: whiteColor,
              borderColor: darkGrayColor,
              borderWidth: 1,
            });
          }
        }
      }
      
      // Update Y position for next year block
      currentY = currentY - yearBlockHeight - yearBlockGap;
    }
    
    // Serialize the PDF document
    const pdfBytes = await pdfDoc.save();
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Academic-Plan.pdf"');
    
    // Send the PDF
    res.send(Buffer.from(pdfBytes));
    
  } catch (error) {
    console.error('PDF export error:', error);
    res.status(500).json({ 
      error: 'Failed to generate PDF', 
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
    });
  }
});

export default router;