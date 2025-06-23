# JSON Output System Documentation

## Overview

The degree audit parsing system now automatically saves all parsed JSON outputs to a dedicated folder that you can easily view and manage.

## ✅ **Features Implemented**

### 1. **Automatic File Saving**
- All parsed JSON data is saved to `/mern/server/parsed-outputs/`
- Creates both complete and individual section files
- Files are timestamped for easy identification

### 2. **Smart File Management**
- **Auto-cleanup**: Deletes old files when new audit is uploaded
- **Organized naming**: Uses original PDF filename + timestamp
- **Multiple formats**: Complete data + individual sections

### 3. **File Structure**
When you upload `my_degree_audit.pdf`, the system creates:
```
my_degree_audit_complete_1703123456789.json           # All data
my_degree_audit_completed_courses_1703123456789.json  # Only completed courses  
my_degree_audit_current_courses_1703123456789.json    # Only current courses
my_degree_audit_requirements_1703123456789.json       # Only requirements
```

### 4. **API Endpoints**
- `GET /upload-degree-audit/parsed-files` - List all saved files
- `GET /upload-degree-audit/parsed-files/:filename` - Download specific file

## 📁 **Where to Find Your Files**

### Local File System
Navigate to: `/Users/austinflippo/Documents/GitHub/AIVac/mern/server/parsed-outputs/`

You can:
- **Open files** directly in any text editor or JSON viewer
- **Copy files** to other locations for backup
- **View file details** (size, creation date, etc.)

### Via Browser/API
- List files: `http://localhost:5050/upload-degree-audit/parsed-files`
- Download file: `http://localhost:5050/upload-degree-audit/parsed-files/[filename]`

## 🔄 **How It Works**

### Upload Process
1. **User uploads PDF** via the frontend
2. **System cleans up** old JSON files automatically  
3. **PDF gets parsed** by the Python script
4. **JSON data is saved** in multiple formats
5. **Frontend receives** the parsed data + file info

### File Lifecycle
```
New Upload → Cleanup Old Files → Parse PDF → Save New Files → Display Data
```

## 📋 **File Contents**

### Complete File Format
```json
{
  "completed_courses": [...],
  "current_courses": [...], 
  "requirements": [...],
  "savedFiles": {
    "directory": "/path/to/parsed-outputs",
    "files": {
      "complete": "filename_complete_timestamp.json",
      "completed_courses": "filename_completed_courses_timestamp.json",
      "current_courses": "filename_current_courses_timestamp.json", 
      "requirements": "filename_requirements_timestamp.json"
    }
  }
}
```

### Individual Section Files
Each section file contains only the relevant data:
- **completed_courses.json**: Array of completed courses with grades
- **current_courses.json**: Array of in-progress courses  
- **requirements.json**: Array of remaining degree requirements

## 🛠 **Backend Implementation**

### Key Functions Added

#### `cleanupOldParsedFiles()`
- Removes all existing JSON files before processing new upload
- Prevents folder from accumulating old files
- Logs cleanup actions for debugging

#### `saveParsedData(parsedData, originalFilename)`
- Creates timestamped filenames based on original PDF name
- Saves complete data + individual sections
- Returns file information for frontend use
- Handles errors gracefully

### Modified Upload Route
- Calls cleanup before processing
- Saves files after successful parsing
- Includes file info in response to frontend
- Maintains existing error handling

## 🚀 **Usage Examples**

### Viewing Files Programmatically
```bash
# List all saved files
curl http://localhost:5050/upload-degree-audit/parsed-files

# Download specific file  
curl http://localhost:5050/upload-degree-audit/parsed-files/my_audit_complete_1703123456789.json
```

### Frontend Integration
The frontend automatically receives file information:
```javascript
// After successful upload, data includes:
{
  completed_courses: [...],
  current_courses: [...],
  requirements: [...],
  savedFiles: {
    directory: "/path/to/files",
    files: { /* file mapping */ }
  }
}
```

## 🧹 **File Management**

### Automatic Cleanup
- **Trigger**: Every new PDF upload
- **Action**: Deletes ALL `.json` files in parsed-outputs folder
- **Safety**: Only affects the parsed-outputs directory

### Manual Management
You can also manually:
- **Delete specific files** if needed
- **Backup files** to other locations  
- **Archive old results** before new uploads

## 🔧 **Troubleshooting**

### Common Issues

#### Files Not Saving
- Check that `/mern/server/parsed-outputs/` directory exists
- Verify write permissions on the directory
- Check server logs for error messages

#### Old Files Not Cleaning
- Ensure cleanup function runs before parsing
- Check for file permission issues
- Verify files have `.json` extension

#### API Endpoints Not Working
- Confirm server is running on port 5050
- Check that upload routes are properly mounted
- Verify file exists before downloading

### Debugging
Check server console for these messages:
```
🧹 Cleaning up old parsed files...
✅ Saved parsed data to: /path/to/parsed-outputs  
📁 Files created: [list of filenames]
```

## 📈 **Benefits**

1. **Easy Access**: View parsed data anytime without re-uploading
2. **Data Backup**: Automatic preservation of parsing results  
3. **Debugging**: Inspect exact data sent to frontend
4. **Development**: Use saved files for testing and development
5. **Audit Trail**: Timestamped files show parsing history

## 🔮 **Future Enhancements**

Potential improvements:
- **File versioning** for comparing different parses of same PDF
- **Selective cleanup** to keep certain files
- **Compression** for large JSON files
- **Database storage** for better file management
- **Frontend file browser** to view files in the UI

This system provides a robust foundation for managing parsed degree audit data while maintaining simplicity and reliability.