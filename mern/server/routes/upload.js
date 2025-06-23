import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';
import { parseHtmlAudit } from '../parseHtmlAuditSections.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create parsed outputs directory if it doesn't exist
const parsedOutputsDir = path.resolve(__dirname, '../parsed-outputs');
if (!fs.existsSync(parsedOutputsDir)) {
  fs.mkdirSync(parsedOutputsDir, { recursive: true });
}

// Function to clean up old parsed JSON files
const cleanupOldParsedFiles = () => {
  try {
    if (fs.existsSync(parsedOutputsDir)) {
      const files = fs.readdirSync(parsedOutputsDir);
      files.forEach(file => {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(parsedOutputsDir, file));
        }
      });
    }
  } catch (error) {
    console.error('Error cleaning up old parsed files:', error);
  }
};

// Function to save parsed data to JSON files
const saveParsedData = (parsedData, originalFilename) => {
  try {
    const timestamp = Date.now();
    const baseFilename = path.parse(originalFilename).name;
    
    // Save complete data
    const completeFilename = `${baseFilename}_complete_${timestamp}.json`;
    const completePath = path.join(parsedOutputsDir, completeFilename);
    fs.writeFileSync(completePath, JSON.stringify(parsedData, null, 2));
    
    // Save individual sections for easier viewing
    const sections = {
      sections: `${baseFilename}_sections_${timestamp}.json`,
      metadata: `${baseFilename}_metadata_${timestamp}.json`
    };
    
    Object.entries(sections).forEach(([key, filename]) => {
      if (parsedData[key]) {
        const filePath = path.join(parsedOutputsDir, filename);
        fs.writeFileSync(filePath, JSON.stringify(parsedData[key], null, 2));
      }
    });
    
    
    return {
      directory: parsedOutputsDir,
      files: {
        complete: completeFilename,
        ...sections
      }
    };
  } catch (error) {
    console.error('Error saving parsed data:', error);
    return null;
  }
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.resolve(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter to only allow HTML files
const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'text/html' || file.originalname.toLowerCase().endsWith('.html')) {
    cb(null, true);
  } else {
    cb(new Error('Only HTML files are allowed!'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// POST route for degree audit upload
router.post('/', upload.single('html'), async (req, res) => {
  
  try {
    if (!req.file) {
      console.error('No file uploaded in request');
      return res.status(400).json({ error: 'No HTML file uploaded' });
    }

    // Clean up old parsed files before processing new upload
    cleanupOldParsedFiles();

    const uploadedFilePath = path.resolve(req.file.path);
    

    


    // Check if uploaded file exists
    if (!fs.existsSync(uploadedFilePath)) {
      console.error('Uploaded file not found at:', uploadedFilePath);
      return res.status(500).json({ 
        error: 'Uploaded file not found',
        details: `File path: ${uploadedFilePath}`
      });
    }

    
    try {
      // Parse HTML directly with cheerio
      const parsedData = parseHtmlAudit(uploadedFilePath);
      
      
      // Clean up: delete the uploaded file
      fs.unlink(uploadedFilePath, (err) => {
        if (err) console.error('Error deleting uploaded file:', err);
        else {}
      });
      
      // Validate that required fields exist
      if (!parsedData.sections || !Array.isArray(parsedData.sections)) {
        console.error('Invalid response format - missing sections array');
        return res.status(500).json({ 
          error: 'Invalid response format from parser',
          details: {
            message: 'Missing required field: sections array',
            receivedFields: Object.keys(parsedData),
            fullResponse: parsedData
          }
        });
      }

      
      // Save parsed data to JSON files
      const savedFiles = saveParsedData(parsedData, req.file.originalname);
      
      // Send the parsed data back to frontend with file info
      res.json({
        ...parsedData,
        savedFiles: savedFiles
      });
      
    } catch (parseError) {
      console.error('HTML parsing error:', parseError);
      
      // Clean up file if parsing fails
      fs.unlink(uploadedFilePath, (err) => {
        if (err) console.error('Error deleting uploaded file:', err);
      });
      
      res.status(500).json({ 
        error: 'Failed to parse HTML audit file',
        details: {
          parseError: parseError.message,
          stack: parseError.stack
        }
      });
    }

  } catch (error) {
    console.error('Upload route error:', error);
    
    // Clean up file if anything goes wrong
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting uploaded file:', err);
      });
    }

    res.status(500).json({ 
      error: 'Internal server error',
      details: {
        message: error.message,
        stack: error.stack
      }
    });
  }
});

// GET route to list saved parsed files
router.get('/parsed-files', (req, res) => {
  try {
    if (!fs.existsSync(parsedOutputsDir)) {
      return res.json({ files: [], directory: parsedOutputsDir });
    }
    
    const files = fs.readdirSync(parsedOutputsDir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const filePath = path.join(parsedOutputsDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          path: filePath,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime
        };
      })
      .sort((a, b) => b.created - a.created); // Sort by creation time, newest first
    
    res.json({
      files: files,
      directory: parsedOutputsDir,
      count: files.length
    });
  } catch (error) {
    console.error('Error listing parsed files:', error);
    res.status(500).json({ error: 'Failed to list parsed files' });
  }
});

// GET route to download a specific parsed file
router.get('/parsed-files/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(parsedOutputsDir, filename);
    
    if (!fs.existsSync(filePath) || !filename.endsWith('.json')) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(path.resolve(filePath));
  } catch (error) {
    console.error('Error serving parsed file:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

export default router;