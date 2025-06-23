// Client-side audit parsing utilities
// Integrates with the main project's server-side HTML parsing

/**
 * Parse audit HTML content in the browser (for file uploads)
 * This matches exactly the demo project parsing logic
 */
export function parseAuditHTMLContent(htmlText) {
  try {
    // Parse HTML using DOMParser (browser environment)
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    
    const auditSections = [];
    
    // Find all subrequirements (audit sections)
    const subrequirements = doc.querySelectorAll('.subrequirement');
    
    subrequirements.forEach(subreq => {
      // Get status from status class
      const statusElement = subreq.querySelector('.status');
      let status = 'unknown';
      
      if (statusElement) {
        if (statusElement.classList.contains('Status_OK')) {
          status = 'fulfilled';
        } else if (statusElement.classList.contains('Status_NO')) {
          status = 'not_fulfilled';
        } else if (statusElement.classList.contains('Status_IP')) {
          status = 'in_progress';
        }
      }
      
      // Get section title
      const titleElement = subreq.querySelector('.subreqTitle');
      const title = titleElement ? titleElement.textContent.trim() : 'Unknown Section';
      
      // Get completed courses
      const courseRows = subreq.querySelectorAll('.completedCourses .takenCourse');
      const items = [];
      
      courseRows.forEach(row => {
        const courseElement = row.querySelector('.course');
        const descElement = row.querySelector('.descLine');
        const termElement = row.querySelector('.term');
        const gradeElement = row.querySelector('.grade');
        
        if (courseElement && descElement) {
          const courseCode = courseElement.textContent.trim();
          const description = descElement.textContent.trim();
          const term = termElement ? termElement.textContent.trim() : '';
          const grade = gradeElement ? gradeElement.textContent.trim() : '';
          
          items.push(`${courseCode} - ${description} (${term}, ${grade})`);
        }
      });
      
      // Get needed courses if status is not fulfilled
      if (status === 'not_fulfilled') {
        const needsElement = subreq.querySelector('.subreqNeeds .count');
        if (needsElement) {
          const needsCount = needsElement.textContent.trim();
          items.push(`NEEDS: ${needsCount} more courses`);
        }
        
        // Get available courses to select from
        const selectCourses = subreq.querySelectorAll('.selectcourses .course .number');
        if (selectCourses.length > 0) {
          const availableCourses = Array.from(selectCourses).map(course => 
            course.textContent.trim()
          ).join(', ');
          items.push(`Available: ${availableCourses}`);
        }
      }
      
      if (title && items.length > 0) {
        auditSections.push({
          title,
          status,
          items
        });
      }
    });
    
    return auditSections;
  } catch (error) {
    console.error('Error parsing audit HTML:', error);
    return [];
  }
}

/**
 * Upload audit file to server for processing
 */
export async function uploadAuditFile(file) {
  const formData = new FormData();
  formData.append('html', file); // Match existing server endpoint
  
  try {
    const response = await fetch('http://localhost:5050/upload-degree-audit', {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error uploading audit file:', error);
    throw error;
  }
}

/**
 * Get status counts for progress summary
 */
export function getStatusCounts(auditSections) {
  const counts = {
    fulfilled: 0,
    in_progress: 0,
    not_fulfilled: 0
  };
  
  auditSections.forEach(section => {
    counts[section.status] = (counts[section.status] || 0) + 1;
  });
  
  return counts;
}

/**
 * Calculate completion percentage
 */
export function calculateCompletionPercentage(auditSections) {
  if (auditSections.length === 0) return 0;
  
  const counts = getStatusCounts(auditSections);
  const completed = counts.fulfilled;
  const total = auditSections.length;
  
  return Math.round((completed / total) * 100);
}