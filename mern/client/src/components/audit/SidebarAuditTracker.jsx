import { useState, useEffect } from 'react';
import AuditAccordionSection from './AuditAccordionSection';
import { getStatusCounts, calculateCompletionPercentage } from '../../utils/auditParser';

const SidebarAuditTracker = ({ auditData, onAuditDataUpdate }) => {
  const [auditSections, setAuditSections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);

  // Initialize with passed audit data
  useEffect(() => {
    if (auditData && auditData.sections) {
      setAuditSections(auditData.sections);
    }
  }, [auditData]);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Reset input
    event.target.value = '';

    try {
      setLoading(true);
      setError(null);
      setUploadProgress('Processing audit...');
      
      const htmlText = await file.text();
      
      // Parse HTML using DOMParser - Enhanced parsing for direct structure from MAJOR REQUIREMENTS
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');
      
      const newAuditSections = [];
      
      // Find the MAJOR REQUIREMENTS starting point
      const majorReqHeader = Array.from(doc.querySelectorAll('.reqHeader'))
        .find(header => header.textContent.includes('MAJOR REQUIREMENTS'));
      
      if (!majorReqHeader) {
        console.warn('MAJOR REQUIREMENTS section not found');
        return;
      }
      
      // Start from MAJOR REQUIREMENTS and get all requirement sections after it
      const startingReq = majorReqHeader.closest('.requirement');
      if (!startingReq) {
        console.warn('Could not find requirement container for MAJOR REQUIREMENTS');
        return;
      }
      
      // Get all requirement sections starting from MAJOR REQUIREMENTS
      let currentElement = startingReq.nextElementSibling;
      while (currentElement) {
        if (currentElement.classList.contains('requirement')) {
          const requirementSection = parseRequirementSection(currentElement);
          if (requirementSection) {
            newAuditSections.push(requirementSection);
          }
        }
        currentElement = currentElement.nextElementSibling;
      }
      
      // Function to find EARNED units from the 180-unit requirement section
      function calculateUnitsCompleted(doc) {
        // Find the main 180-unit requirement section
        const totalHrxElement = doc.querySelector('[rname="TOTALHRX"]');
        if (!totalHrxElement) {
          console.warn('Could not find TOTALHRX requirement section');
          return 0;
        }
        
        // Look for the EARNED row within the requirement totals table
        const earnedRow = totalHrxElement.querySelector('.requirementTotals .reqEarned');
        if (!earnedRow) {
          console.warn('Could not find reqEarned row');
          return 0;
        }
        
        // Extract the earned units value
        const earnedUnitsElement = earnedRow.querySelector('.hours.number');
        if (earnedUnitsElement) {
          const earnedText = earnedUnitsElement.textContent.trim();
          const earnedValue = parseFloat(earnedText);
          if (!isNaN(earnedValue)) {
            return earnedValue;
          }
        }
        
        console.warn('Could not parse earned units value');
        return 0;
      }
      
      // Enhanced parsing function for requirement sections
      function parseRequirementSection(reqElement) {
        // Get requirement title from reqTitle or reqHeader
        const titleElement = reqElement.querySelector('.reqTitle') || reqElement.querySelector('.reqHeader');
        if (!titleElement) return null;
        
        let title = titleElement.textContent.trim();
        
        // Clean up title (remove HTML artifacts)
        title = title.replace(/^\s*\>\>\s*|\s*\<\<\s*$/g, '').trim();
        if (!title || title.includes('DATA SCIENCE - BS')) return null; // Skip header sections
        
        // Special handling for WORK IN PROGRESS section
        const isWorkInProgress = title.includes('WORK IN PROGRESS');
        
        // Get overall requirement status
        const reqStatusElement = reqElement.querySelector('.reqStatusGroup .status');
        let overallStatus = 'unknown';
        if (reqStatusElement) {
          if (reqStatusElement.classList.contains('statusOK')) {
            overallStatus = 'fulfilled';
          } else if (reqStatusElement.classList.contains('statusNO')) {
            overallStatus = 'not_fulfilled';
          } else if (reqStatusElement.classList.contains('statusIP')) {
            overallStatus = 'in_progress';
          }
        }
        
        const items = [];
        
        // Find all subrequirements within this requirement
        const subrequirements = reqElement.querySelectorAll('.subrequirement');
        
        subrequirements.forEach(subreq => {
          // Get subrequirement status
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
          
          // Get completed courses from this subrequirement
          const courseRows = subreq.querySelectorAll('.completedCourses .takenCourse');
          
          courseRows.forEach(row => {
            const courseElement = row.querySelector('.course');
            const descElement = row.querySelector('.descLine') || row.querySelector('.description .descLine');
            const termElement = row.querySelector('.term');
            const gradeElement = row.querySelector('.grade');
            
            if (courseElement && descElement) {
              const courseCode = courseElement.textContent.trim();
              const description = descElement.textContent.trim();
              const term = termElement ? termElement.textContent.trim() : '';
              const grade = gradeElement ? gradeElement.textContent.trim() : '';
              
              // For WORK IN PROGRESS, mark courses with WIP/NR grades
              let displayGrade = grade;
              if (isWorkInProgress && (!grade || grade === '' || grade === 'NR')) {
                displayGrade = 'WIP';
              }
              
              
              items.push(`${courseCode} - ${description} (${term}, ${displayGrade})`);
            }
          });
          
          // Enhanced NEEDS parsing - group NEEDS and Available courses together
          if (status === 'not_fulfilled') {
            const needsTable = subreq.querySelector('.subreqNeeds');
            let needsDisplay = '';
            let availableCoursesDisplay = '';
            
            // Parse NEEDS information
            if (needsTable) {
              let needsText = 'NEEDS: ';
              
              // Check for course count
              const courseCountElement = needsTable.querySelector('.count.number');
              const courseCountLabel = needsTable.querySelector('.countlabel');
              
              // Check for units
              const unitsElement = needsTable.querySelector('.hours.number');
              const unitsLabel = needsTable.querySelector('.hourslabel');
              
              if (courseCountElement && courseCountLabel && courseCountLabel.textContent.includes('Courses')) {
                needsText += `${courseCountElement.textContent.trim()} Courses`;
              } else if (unitsElement && unitsLabel && unitsLabel.textContent.includes('Units')) {
                needsText += `${unitsElement.textContent.trim()} Units`;
              } else if (courseCountElement) {
                // Fallback for course count without label
                needsText += `${courseCountElement.textContent.trim()} more courses`;
              }
              
              if (needsText !== 'NEEDS: ') {
                needsDisplay = needsText;
              }
            }
            
            // Get available courses to select from
            const selectCourses = subreq.querySelectorAll('.selectcourses .course .number');
            if (selectCourses.length > 0) {
              const availableCourses = Array.from(selectCourses).map(course => 
                course.textContent.trim()
              ).join(', ');
              availableCoursesDisplay = `Available: ${availableCourses}`;
            }
            
            // Group NEEDS and Available courses together as a single item
            if (needsDisplay && availableCoursesDisplay) {
              items.push(`${needsDisplay} | ${availableCoursesDisplay}`);
            } else if (needsDisplay) {
              items.push(needsDisplay);
            } else if (availableCoursesDisplay) {
              items.push(availableCoursesDisplay);
            }
          }
        });
        
        // Only include sections that have content
        if (title && items.length > 0) {
          return {
            title,
            status: isWorkInProgress ? 'in_progress' : overallStatus,
            items
          };
        }
        
        return null;
      }
      
      // Calculate total units completed
      const unitsCompleted = calculateUnitsCompleted(doc);
      
      // Create audit result with same structure as demo
      const auditResult = {
        sections: newAuditSections,
        metadata: {
          totalSections: newAuditSections.length,
          fulfilledSections: newAuditSections.filter(s => s.status === 'fulfilled').length,
          inProgressSections: newAuditSections.filter(s => s.status === 'in_progress').length,
          notFulfilledSections: newAuditSections.filter(s => s.status === 'not_fulfilled').length,
          unitsCompleted: unitsCompleted,
          parseTimestamp: new Date().toISOString(),
          parsedBy: 'client'
        }
      };
      
      setAuditSections(newAuditSections);
      if (onAuditDataUpdate) {
        onAuditDataUpdate(auditResult);
      }
      
      setUploadProgress(null);
    } catch (err) {
      setError(`Failed to parse uploaded file: ${err.message}`);
      console.error('Error parsing uploaded file:', err);
      setUploadProgress(null);
    } finally {
      setLoading(false);
    }
  };

  const statusCounts = getStatusCounts(auditSections);
  const completionPercentage = calculateCompletionPercentage(auditSections);

  return (
    <div className="audit-tracker h-full flex flex-col">
      {/* Header - Fixed */}
      <div className="p-4 border-b border-gray-200 bg-white flex-shrink-0">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Graduation Progress
        </h2>
        
        {/* Upload Section */}
        <div className="mb-4">
          <label className="text-sm font-medium text-gray-700 mb-2 block">
            Upload Degree Audit (HTML)
          </label>
          <label className="block w-full">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-3 text-center hover:border-blue-400 hover:bg-gray-50 transition-colors cursor-pointer">
              <svg className="w-6 h-6 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <div className="flex items-center justify-center">
                <span className="bg-blue-500 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-600 transition-colors">
                  Choose File
                </span>
                <span className="ml-2 text-sm text-blue-500">No file chosen</span>
              </div>
            </div>
            <input
              type="file"
              accept=".html,.htm"
              onChange={handleFileUpload}
              disabled={loading}
              className="hidden"
            />
          </label>
          <p className="text-xs text-gray-500 mt-2 text-center">
            Upload an HTML degree audit to see your graduation progress.
          </p>
        </div>

        {/* Loading/Error State */}
        {loading && (
          <div className="text-center py-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2"></div>
            <div className="text-sm text-blue-900">{uploadProgress || 'Processing...'}</div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <div className="text-sm text-red-800">{error}</div>
          </div>
        )}

        {/* Progress Summary */}
        {auditSections.length > 0 && (
          <div className="space-y-2">
            {/* Units Completed - Top priority display */}
            {auditData?.metadata?.unitsCompleted !== undefined && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-purple-800">Units Completed</span>
                  <span className="text-lg font-bold text-purple-800">{auditData.metadata.unitsCompleted}</span>
                </div>
              </div>
            )}
            
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-green-800">Completed</span>
                <span className="text-lg font-bold text-green-800">{statusCounts.fulfilled}</span>
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-blue-800">In Progress</span>
                <span className="text-lg font-bold text-blue-800">{statusCounts.in_progress}</span>
              </div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-red-800">Remaining</span>
                <span className="text-lg font-bold text-red-800">{statusCounts.not_fulfilled}</span>
              </div>
            </div>
            
            {/* Completion Percentage */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800">Overall Progress</span>
                <span className="text-lg font-bold text-gray-800">{completionPercentage}%</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto">
        {/* Requirements List */}
        {auditSections.length > 0 && (
          <div className="p-4">
            <h3 className="text-base font-semibold text-gray-900 mb-3">
              Requirements
            </h3>
            <div className="space-y-2">
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
            </div>
          </div>
        )}

        {/* Empty State */}
        {auditSections.length === 0 && !loading && !error && (
          <div className="p-4">
            <div className="text-center py-8">
              <svg className="w-12 h-12 mx-auto mb-3 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm text-blue-500 mb-1">No degree audit loaded</p>
              <p className="text-xs text-blue-500">
                Upload your degree audit to see requirements
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SidebarAuditTracker;