import { useState, useEffect } from 'react';
import { UploadCloud, Loader2, Maximize2, Minimize2, ChevronDown } from 'lucide-react';
import AuditAccordionSection from './AuditAccordionSection';
import { calculateAuditProgress } from '../../utils/auditProgress';

const SidebarAuditTracker = ({
  auditData,
  schedule = [],
  onAuditDataUpdate,
  expandState,
  onToggleExpand,
}) => {
  const [auditSections, setAuditSections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [isDragActive, setIsDragActive] = useState(false);
  // Which requirement sections are open, by index
  const [expandedSections, setExpandedSections] = useState(() => new Set());
  // Progress summary is collapsed by default when the panel is maximized so
  // Requirements can use almost the full height; docked starts open.
  const [progressOpen, setProgressOpen] = useState(true);

  // Initialize with passed audit data
  useEffect(() => {
    if (auditData && auditData.sections) {
      setAuditSections(auditData.sections);
      setExpandedSections(new Set()); // new audit -> start collapsed
    }
  }, [auditData]);

  // Maximized panel → tuck the progress block so Requirements fills the view
  useEffect(() => {
    setProgressOpen(expandState !== "expanded");
  }, [expandState]);

  const toggleSection = (index) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const allExpanded =
    auditSections.length > 0 && expandedSections.size === auditSections.length;

  const toggleAllSections = () => {
    setExpandedSections(
      allExpanded ? new Set() : new Set(auditSections.map((_, i) => i))
    );
  };

  const processAuditFile = async (file) => {
    if (!file) return;

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
        const structuredSubrequirements = [];
        
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
          
          let needType = null;
          let needAmount = null;
          let availableCodes = [];

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
                needType = 'courses';
                needAmount = parseFloat(courseCountElement.textContent.trim());
              } else if (unitsElement && unitsLabel && unitsLabel.textContent.includes('Units')) {
                needsText += `${unitsElement.textContent.trim()} Units`;
                needType = 'units';
                needAmount = parseFloat(unitsElement.textContent.trim());
              } else if (courseCountElement) {
                // Fallback for course count without label
                needsText += `${courseCountElement.textContent.trim()} more courses`;
                needType = 'courses';
                needAmount = parseFloat(courseCountElement.textContent.trim());
              }
              
              if (needsText !== 'NEEDS: ') {
                needsDisplay = needsText;
              }
            }
            
            // Get available courses to select from
            const selectCourses = subreq.querySelectorAll('.selectcourses .course');
            if (selectCourses.length > 0) {
              availableCodes = Array.from(selectCourses).map(course => {
                const subject = course.querySelector('.discipline, .subject')
                  ?.textContent.trim();
                const number = course.querySelector('.number')?.textContent.trim();
                if (number && /^[A-Za-z]{2,6}\s*\d/.test(number)) return number;
                if (subject && number) return `${subject} ${number}`;
                return course.textContent.replace(/\s+/g, ' ').trim();
              }).filter(Boolean);
              const availableCourses = availableCodes.join(', ');
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

          structuredSubrequirements.push({
            status,
            needType,
            needAmount: Number.isFinite(needAmount) ? needAmount : null,
            availableCodes
          });
        });
        
        // Only include sections that have content
        if (title && items.length > 0) {
          return {
            title,
            status: isWorkInProgress ? 'in_progress' : overallStatus,
            items,
            subrequirements: structuredSubrequirements
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

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    event.target.value = ''; // reset input so the same file can be re-selected
    processAuditFile(file);
  };

  // Drag-and-drop upload for the audit HTML file
  const handleFileDragOver = (event) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleFileDragLeave = (event) => {
    event.preventDefault();
    setIsDragActive(false);
  };

  const handleFileDrop = (event) => {
    event.preventDefault();
    setIsDragActive(false);

    const file = event.dataTransfer.files?.[0];
    if (!file) return;

    if (!/\.html?$/i.test(file.name)) {
      setError('Please drop an HTML degree audit file (.html or .htm).');
      return;
    }

    setError(null);
    processAuditFile(file);
  };

  const progress = calculateAuditProgress(
    auditSections,
    schedule,
    auditData?.metadata
  );

  return (
    <div className="audit-tracker h-full flex flex-col bg-white">
      {/* Panel header */}
      <div className="h-11 px-4 flex items-center justify-between border-b border-slate-200 flex-shrink-0">
        <h2 className="panel-heading">Graduation Progress</h2>
        {onToggleExpand && (
          <button
            type="button"
            className="p-1 rounded text-slate-400 hover:text-navy-600 hover:bg-slate-100 transition-colors"
            onClick={onToggleExpand}
            title={
              expandState === "expanded"
                ? "Restore side panel (Esc)"
                : "Expand requirements"
            }
          >
            {expandState === "expanded" ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Upload + progress — progress details collapse so Requirements can grow */}
      <div className="border-b border-slate-200 flex-shrink-0">
        <div className="px-4 pt-3 pb-2">
          {/* Upload Section — big dropzone before an audit exists, a slim
              "Replace" row once one is loaded (both accept click or drag) */}
          <label className="block w-full">
            {auditSections.length === 0 ? (
              <div
                onDragOver={handleFileDragOver}
                onDragLeave={handleFileDragLeave}
                onDrop={handleFileDrop}
                className={`border border-dashed rounded-xl p-4 text-center transition-colors cursor-pointer ${
                  isDragActive
                    ? 'border-navy-400 bg-navy-50'
                    : 'border-slate-300 hover:border-navy-300 hover:bg-slate-50'
                }`}
              >
                <UploadCloud
                  className={`w-5 h-5 mx-auto mb-2 ${
                    isDragActive ? 'text-navy-500' : 'text-slate-400'
                  }`}
                />
                <div className="text-sm font-medium text-slate-700">
                  Upload degree audit
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  <span className="text-navy-500 font-medium">Choose a file</span>{' '}
                  or drag &amp; drop your HTML audit here
                </p>
              </div>
            ) : (
              <div
                onDragOver={handleFileDragOver}
                onDragLeave={handleFileDragLeave}
                onDrop={handleFileDrop}
                className={`flex items-center justify-center gap-1.5 border border-dashed rounded-lg px-3 py-1.5 transition-colors cursor-pointer ${
                  isDragActive
                    ? 'border-navy-400 bg-navy-50 text-navy-600'
                    : 'border-slate-300 text-slate-500 hover:border-navy-300 hover:text-navy-600 hover:bg-slate-50'
                }`}
                title="Upload a newer audit to replace the current one"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">Replace degree audit</span>
              </div>
            )}
            <input
              type="file"
              accept=".html,.htm"
              onChange={handleFileUpload}
              disabled={loading}
              className="hidden"
            />
          </label>

          {/* Loading/Error State */}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-navy-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              {uploadProgress || 'Processing…'}
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-3">
              <div className="text-sm text-red-700">{error}</div>
            </div>
          )}
        </div>

        {/* Progress Summary — dark green is audit-completed; light green is
            the additional estimated progress represented by the plan. */}
        {auditSections.length > 0 && (
          <div className="px-4 pb-3">
            <button
              type="button"
              onClick={() => setProgressOpen((o) => !o)}
              className="w-full flex items-center gap-2 text-left"
              aria-expanded={progressOpen}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-xs font-medium text-slate-700 truncate">
                    Overall progress
                  </span>
                  <div className="flex items-baseline gap-1.5 ml-2 tabular-nums">
                    <span className="text-sm font-semibold text-slate-800">
                      {progress.verifiedPercent}%
                    </span>
                    {progress.withPlanPercent > progress.verifiedPercent && (
                      <>
                        <span className="text-[10px] text-slate-400">→</span>
                        <span className="text-xs font-semibold text-emerald-500">
                          {progress.withPlanPercent}% with plan
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="relative h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-emerald-300 transition-all"
                    style={{ width: `${progress.withPlanPercent}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 bg-emerald-500 transition-all"
                    style={{
                      width: `${progress.verifiedPercent}%`,
                    }}
                  />
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500">
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Completed
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-300" />
                    Added by plan
                  </span>
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${
                  progressOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {progressOpen &&
              (auditData?.metadata?.unitsCompleted !== undefined ||
                progress.currentUnits > 0 ||
                progress.plannedUnits > 0) && (
              <div className="mt-3">
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {auditData?.metadata?.unitsCompleted !== undefined && (
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs text-slate-600">Units earned</span>
                      <span className="text-sm font-semibold tabular-nums text-slate-800">
                        {progress.earnedUnits}
                      </span>
                    </div>
                  )}
                  {progress.currentUnits > 0 && (
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs text-slate-600">In progress</span>
                      <span className="text-sm font-semibold tabular-nums text-amber-600">
                        +{progress.currentUnits} units
                      </span>
                    </div>
                  )}
                  {progress.plannedUnits > 0 && (
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs text-slate-600">Planned</span>
                      <span className="text-sm font-semibold tabular-nums text-navy-600">
                        +{progress.plannedUnits} units
                      </span>
                    </div>
                  )}
                  {(progress.currentUnits > 0 || progress.plannedUnits > 0) && (
                    <div className="flex items-center justify-between px-3 py-2 bg-navy-50/60">
                      <span className="text-xs font-medium text-navy-700">
                        Projected total
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-navy-800">
                        {progress.projectedUnits} / 180
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Requirements — grows into whatever the progress block leaves */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {auditSections.length > 0 && (
          <div className={`p-4 ${expandState === "expanded" ? "max-w-4xl" : ""}`}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="panel-heading truncate">Requirements</h3>
              <button
                onClick={toggleAllSections}
                className="flex-shrink-0 whitespace-nowrap text-[11px] font-medium text-navy-500 hover:text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 rounded"
              >
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
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
                    projection={progress.sectionProgress[index]}
                    isExpanded={expandedSections.has(index)}
                    onToggle={() => toggleSection(index)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SidebarAuditTracker;