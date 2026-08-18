import { useState, useEffect } from 'react';
import { UploadCloud, Loader2, Maximize2, Minimize2, ChevronDown, PanelLeftClose } from 'lucide-react';
import AuditAccordionSection from './AuditAccordionSection';
import { WatchDemoLink } from '../HowItWorks';
import { calculateAuditProgress } from '../../utils/auditProgress';
import { requirementMode } from '../../utils/auditRequirements';
import { SHOW_GRADES } from '../../utils/courseGrades';
import { readCourseGroups } from '../../utils/readCourseGroups';

const normalizeTitle = (value) =>
  String(value || '')
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, ' ')
    .replace(/^[>\s]+|[<\s]+$/g, '')
    .trim()
    .toUpperCase();

/**
 * The degree/major exactly as the audit's own header states it.
 *
 * Returns two lists because they are matched differently:
 *   prefixes — the "MAJOR - DEGREE" form the degree banner prints
 *              ("DATA SCIENCE - BS"). Prefix-matched, since the banner often
 *              carries a catalog year or plan code after it.
 *   exact    — the bare header values ("DATA SCIENCE", "BS"). Exact-only,
 *              because "Data Science BS Upper Division Requirements and Major
 *              GPA" is a REAL section and must survive.
 *
 * Read from the audit instead of hardcoded so it works for any major. Only
 * Degree/Major/Program labels are used — matching the College entry would
 * swallow the real "Eighth College General Education" section.
 */
const degreeBannerTitles = (doc) => {
  const header = doc.querySelector('.auditHeaderEntryLabel')?.parentElement;
  if (!header) return { prefixes: [], exact: [] };
  const nodes = Array.from(
    header.querySelectorAll('.auditHeaderEntryLabel, .auditHeaderEntry')
  );
  const values = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    if (!nodes[i].classList.contains('auditHeaderEntryLabel')) continue;
    const label = (nodes[i].textContent || '').trim().toLowerCase();
    if (!/\b(degree|major|program)\b/.test(label) || label.includes('gpa')) {
      continue;
    }
    const value = normalizeTitle(nodes[i + 1].textContent);
    if (value) values.push(value);
  }
  const prefixes = new Set();
  for (const a of values) {
    for (const b of values) {
      if (a !== b) prefixes.add(`${a} - ${b}`);
    }
  }
  return { prefixes: [...prefixes], exact: values };
};

/**
 * True for the degree/major banner that announces the sections below it.
 *
 * This used to be `title.includes('DATA SCIENCE - BS')` — the banner was
 * skipped for exactly one major, so every CSE, bioengineering or other student
 * had it rendered as a bogus requirement section whose course codes then leaked
 * into codesNamedByAudit. Recognise the block by what it IS instead: either it
 * lists no `.subrequirement` rows (nothing in it to track) or its title is the
 * degree the audit's own header names.
 */
const isBannerBlock = (reqElement, title, banners = {}) => {
  if (!reqElement.querySelector('.subrequirement')) return true;
  const normalized = normalizeTitle(title);
  return (
    (banners.exact || []).includes(normalized) ||
    (banners.prefixes || []).some((prefix) => normalized.startsWith(prefix))
  );
};

const SidebarAuditTracker = ({
  auditData,
  schedule = [],
  onAuditDataUpdate,
  expandState,
  onToggleExpand,
  onMinimize,
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
      
      // A layout we can't read must SAY so. This used to console.warn and
      // return from inside the try, leaving setError untouched: the panel
      // showed nothing at all and any audit already on screen stayed there, so
      // a non-DARS file, a truncated download or a DARS layout change looked
      // exactly like a successful upload.
      const startingReq = majorReqHeader?.closest('.requirement');
      if (!majorReqHeader || !startingReq) {
        setError(
          `We couldn't read "${file.name}" as a UC San Diego degree audit — ` +
            'the "MAJOR REQUIREMENTS" section is missing. Open your audit at ' +
            'act.ucsd.edu, choose "Save as HTML" (not Print or PDF), and upload ' +
            'that file. Your previously loaded audit is unchanged.'
        );
        setUploadProgress(null);
        return;
      }

      // The degree/major exactly as the audit's own header names it, used to
      // recognise the degree banner block for ANY major (see isBannerBlock).
      const degreeBanners = degreeBannerTitles(doc);

      // Get all requirement sections starting from MAJOR REQUIREMENTS
      let currentElement = startingReq.nextElementSibling;
      while (currentElement) {
        if (currentElement.classList.contains('requirement')) {
          const requirementSection = parseRequirementSection(
            currentElement,
            degreeBanners
          );
          if (requirementSection) {
            newAuditSections.push(requirementSection);
          }
        }
        currentElement = currentElement.nextElementSibling;
      }
      
      // The audit's student-info header carries "Catalog Year" ("Fall 2024"),
      // which is the student's matriculation catalog and therefore Year 1 of
      // their planner grid. Labels and values alternate as sibling divs, so
      // pair each label with the entry that follows it.
      //
      // Deliberately NOT inferred from the earliest completed term: transfer
      // and AP credit post under the term they were earned (a Fall 2024
      // student can carry an SP22 BILD 1 with grade TP), which would anchor
      // the grid years too early and push their current quarter off the end.
      function extractCatalogYear(doc) {
        const header = doc.querySelector('.auditHeaderEntryLabel')?.parentElement;
        if (!header) return null;
        const nodes = Array.from(
          header.querySelectorAll('.auditHeaderEntryLabel, .auditHeaderEntry')
        );
        for (let i = 0; i < nodes.length - 1; i++) {
          if (!nodes[i].classList.contains('auditHeaderEntryLabel')) continue;
          const label = (nodes[i].textContent || '').trim().toLowerCase();
          if (label !== 'catalog year') continue;
          const value = (nodes[i + 1].textContent || '').trim();
          return value || null;
        }
        return null;
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

      // Units the whole degree requires, from the audit's own total-units
      // requirement (rqdHours, e.g. "180.00"). Reading the audit rather than
      // hardcoding 180 keeps this right for students whose total differs.
      // The requirement carries no NEEDS row, so subtract EARNED ourselves.
      function calculateUnitsRequired(doc) {
        const totalHrx = doc.querySelector('[rname="TOTALHRX"]');
        const value = parseFloat(totalHrx?.getAttribute('rqdHours') || '');
        return isNaN(value) || value <= 0 ? null : value;
      }
      
      // Enhanced parsing function for requirement sections
      function parseRequirementSection(reqElement, banners = {}) {
        // Get requirement title from reqTitle or reqHeader
        const titleElement = reqElement.querySelector('.reqTitle') || reqElement.querySelector('.reqHeader');
        if (!titleElement) return null;

        let title = titleElement.textContent.trim();

        // Clean up title (remove HTML artifacts)
        title = title.replace(/^\s*>>\s*|\s*<<\s*$/g, '').trim();
        if (!title) return null;
        if (isBannerBlock(reqElement, title, banners)) return null;

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

          // Subcategory label from the audit (e.g. "Arts", "Formal Skills")
          const subTitleElement = subreq.querySelector('.subreqTitle');
          const subTitle = subTitleElement
            ? subTitleElement.textContent
                .replace(/^\s*>>\s*|\s*<<\s*$/g, '')
                .replace(/\s+/g, ' ')
                .trim()
            : null;
          
          // Get completed courses from this subrequirement. Keep them on the
          // subrequirement itself so the UI can nest MUS 20R under Arts (etc.)
          // instead of dumping every taken course into a flat section-level list.
          const courseRows = subreq.querySelectorAll('.completedCourses .takenCourse');
          const completedCourses = [];

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
              // The audit prints the units it applied for this course. That is
              // the authoritative count — it is what the registrar credited —
              // and the only one available while the grid is being built, since
              // the catalog is behind an async endpoint. Courses whose row
              // carries no hours stay null (honestly unknown) rather than being
              // stamped with a fabricated 4.
              // DARS exports are not consistent about which class carries the
              // units on a taken-course row — requirement totals use `.hours`,
              // but course rows have also been documented as `.credit`. Try
              // every known spelling rather than betting on one: guessing wrong
              // would silently mark EVERY audit course unknown.
              const hoursElement = [
                '.hours.number',
                '.hours',
                '.credit.number',
                '.credit',
                '.credits',
                '.creditHours',
              ].reduce((found, sel) => found || row.querySelector(sel), null);
              const hours = hoursElement
                ? parseFloat(hoursElement.textContent.trim())
                : NaN;
              const credits = Number.isFinite(hours) ? hours : null;

              // For WORK IN PROGRESS, mark courses with WIP/NR grades
              let displayGrade = grade;
              if (isWorkInProgress && (!grade || grade === '' || grade === 'NR')) {
                displayGrade = 'WIP';
              }

              const display = `${courseCode} - ${description} (${term}, ${displayGrade})`;
              // Still push to section.items for older UI / restored-plan fallbacks.
              items.push(display);
              completedCourses.push({
                course_id: courseCode,
                description,
                term,
                grade: displayGrade,
                credits,
                display,
              });
            }
          });
          
          let needType = null;
          let needAmount = null;
          let availableCodes = [];
          let groups = [];

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
            
            // Get available courses to select from.
            //
            // The audit abbreviates runs within a department — "DSC 152, 100,
            // 102" renders the tail entries as bare numbers — but every option
            // carries department/number as attributes, so read those instead of
            // the visible text. Adjacent options joined by "OR" are alternatives
            // for ONE slot; "to" (or a hyphen) between two codes of the same
            // department is a range ("ECON 100 to ECON 199" → ECON 100TO199);
            // commas/whitespace separate slots.
            const selectTable = subreq.querySelector('.selectcourses');
            if (selectTable?.querySelector('.course')) {
              groups = readCourseGroups(selectTable);
              availableCodes = groups.flat();
              availableCoursesDisplay = `Available: ${availableCodes.join(', ')}`;
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
            title: subTitle || null,
            status,
            needType,
            needAmount: Number.isFinite(needAmount) ? needAmount : null,
            // OR-groups are the real structure; availableCodes is the flat
            // projection kept so older saved audits and any consumer that
            // hasn't migrated still work.
            groups,
            mode: requirementMode(groups, needType, needAmount),
            availableCodes,
            completedCourses,
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
      
      // Found the anchor but read nothing out of it — same class of failure,
      // same rule: say so rather than silently keeping the old audit.
      if (newAuditSections.length === 0) {
        setError(
          `We found the audit structure in "${file.name}" but couldn't read any ` +
            'requirement sections from it. The file may be truncated, or saved ' +
            'from a page that had not finished loading. Re-download it from ' +
            'act.ucsd.edu and try again. Your previously loaded audit is unchanged.'
        );
        setUploadProgress(null);
        return;
      }

      // Calculate total units completed
      const unitsCompleted = calculateUnitsCompleted(doc);
      const unitsRequired = calculateUnitsRequired(doc);

      // Create audit result with same structure as demo
      const auditResult = {
        sections: newAuditSections,
        metadata: {
          totalSections: newAuditSections.length,
          fulfilledSections: newAuditSections.filter(s => s.status === 'fulfilled').length,
          inProgressSections: newAuditSections.filter(s => s.status === 'in_progress').length,
          notFulfilledSections: newAuditSections.filter(s => s.status === 'not_fulfilled').length,
          unitsCompleted: unitsCompleted,
          // From the audit's own total-units requirement, so the headline can
          // say "N units left" instead of only a category percentage.
          unitsRequired: unitsRequired,
          // "Fall 2024" — anchors year_index 0 of the planner grid.
          catalogYear: extractCatalogYear(doc),
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

  // A restored audit parsed before the structured-groups parser has course
  // lists but no OR-group data (or no subrequirements at all), so it renders
  // through the flat legacy fallback — a wall of comma-separated codes with no
  // checklists or subsection labels. The HTML isn't stored, so it can't be
  // re-parsed silently; tell the student a re-upload upgrades the view rather
  // than letting the downgrade read as a bug. Fresh parses always set groups
  // alongside availableCodes, so this never fires for a current-parser audit.
  const staleAuditStructure = auditSections.some(
    (section) =>
      section.subrequirements === undefined ||
      (section.subrequirements || []).some(
        (sub) =>
          (sub.availableCodes || []).length > 0 && !(sub.groups || []).length
      )
  );

  const requirementsExpanded = expandState === "expanded";

  return (
    <div className="audit-tracker h-full flex flex-col bg-white">
      {/* Graduation Progress — collapses to its header when Requirements is maximized,
          same pattern as Course Search when the assistant takes over */}
      <div className="flex-shrink-0 border-b border-slate-200">
        <div className="h-11 px-4 flex items-center justify-between">
          <h2 className="panel-heading">Graduation Progress</h2>
          {onMinimize && (
            <button
              type="button"
              className="p-1 rounded text-slate-400 hover:text-navy-600 hover:bg-slate-100 transition-colors"
              onClick={onMinimize}
              title="Hide panel"
              aria-label="Hide graduation progress panel"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Upload + progress — hidden while Requirements owns the panel */}
        {!requirementsExpanded && (
          <div>
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

          {staleAuditStructure && !loading && (
            <p className="mt-2 text-[11px] leading-relaxed text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              This audit was saved by an older version of the planner, so
              requirements show as flat course lists. Re-upload your audit HTML
              to get the full breakdown with checklists and course choices.
            </p>
          )}

          {auditSections.length === 0 && !loading && (
            <div className="mt-3 px-0.5 space-y-1.5">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                In TritonLink, open <span className="font-medium text-slate-600">Degree Audit</span>, save the page as HTML, then drop it here.
              </p>
              <WatchDemoLink />
            </div>
          )}

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
                    {progress.unitsRemaining !== null
                      ? 'Left to graduate'
                      : 'Overall progress'}
                  </span>
                  <div className="flex items-baseline gap-1.5 ml-2 tabular-nums">
                    {progress.unitsRemaining !== null ? (
                      <span className="text-sm font-semibold text-slate-800">
                        {/* "at most" because unverified courses carry no unit
                            count, so the true remainder can only be lower. */}
                        {progress.unknownUnitCourses > 0 ? '≤ ' : ''}
                        {progress.unitsRemaining} units
                        {progress.unitsRemaining > 0 ? (
                          // ~15 units is a normal full-time quarter
                          <span className="ml-1.5 text-xs font-normal text-slate-500">
                            ≈ {Math.ceil(progress.unitsRemaining / 15)} quarter
                            {Math.ceil(progress.unitsRemaining / 15) === 1 ? '' : 's'}
                          </span>
                        ) : (
                          // Units and requirements clear independently. A plan
                          // can cover 180 units and still leave Arts or the
                          // elective units open, so never let a bare "0 units"
                          // read as "done".
                          progress.outstandingSections > 0 && (
                            <span className="ml-1.5 text-xs font-normal text-amber-600">
                              · {progress.outstandingSections} requirement
                              {progress.outstandingSections === 1 ? '' : 's'} still open
                            </span>
                          )
                        )}
                      </span>
                    ) : (
                      <span className="text-sm font-semibold text-slate-800">
                        {progress.verifiedPercent}%
                      </span>
                    )}
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
                  <span className="ml-auto tabular-nums text-slate-400">
                    {progress.verified}/{progress.total} categories
                    {progress.newlyProjected > 0
                      ? ` · +${progress.newlyProjected} via plan`
                      : ''}
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
                  {/* Courses the audit vouches for that the catalog never
                      published carry no unit count, so they add 0 to every
                      row above. Saying so is the difference between a total
                      that is incomplete and one that is quietly wrong. */}
                  {progress.unknownUnitCourses > 0 && (
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs text-amber-700">
                        Units not counted
                      </span>
                      <span className="text-xs font-medium tabular-nums text-amber-600">
                        {progress.unknownUnitCourses} unverified course
                        {progress.unknownUnitCourses === 1 ? '' : 's'}
                      </span>
                    </div>
                  )}
                  {(progress.currentUnits > 0 || progress.plannedUnits > 0) && (
                    <div className="flex items-center justify-between px-3 py-2 bg-navy-50/60">
                      <span className="text-xs font-medium text-navy-700">
                        Projected total
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-navy-800">
                        {progress.unknownUnitCourses > 0 ? '≥ ' : ''}
                        {progress.projectedUnits}
                        {progress.unitsRequired !== null
                          ? ` / ${progress.unitsRequired}`
                          : ''}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        </div>
        )}
      </div>

      {/* Requirements — own header + expand control, matching Course Assistant */}
      {auditSections.length > 0 && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="h-11 px-4 flex items-center justify-between border-b border-slate-200 flex-shrink-0 gap-2">
            <h3 className="panel-heading truncate">Requirements</h3>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={toggleAllSections}
                className="whitespace-nowrap px-1.5 py-1 text-[11px] font-medium text-navy-500 hover:text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 rounded"
              >
                {allExpanded ? "Collapse all" : "Expand all"}
              </button>
              {onToggleExpand && (
                <button
                  type="button"
                  className="p-1 rounded text-slate-400 hover:text-navy-600 hover:bg-slate-100 transition-colors"
                  onClick={onToggleExpand}
                  title={
                    requirementsExpanded
                      ? "Restore side panel (Esc)"
                      : "Expand requirements"
                  }
                >
                  {requirementsExpanded ? (
                    <Minimize2 className="w-3.5 h-3.5" />
                  ) : (
                    <Maximize2 className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            <div className={`p-4 ${requirementsExpanded ? "max-w-4xl" : ""}`}>
              <div className="space-y-2">
                {auditSections.map((section, index) => {
                  // Rename "The following courses" sections to "In Progress"
                  let displayTitle = section.title;
                  if (
                    section.title &&
                    section.title.toLowerCase().startsWith("the following courses")
                  ) {
                    displayTitle = "In Progress";
                  }

                  // GPA-only blocks (e.g. "MAJOR GPA") — keep mixed titles like
                  // "...Requirements and Major GPA", which are real requirement
                  // sections. Parsing is unchanged; this is display-only.
                  if (
                    !SHOW_GRADES &&
                    /\bgpa\b/i.test(displayTitle || "") &&
                    !/\b(requirement|course|need)s?\b/i.test(displayTitle || "")
                  ) {
                    return null;
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
          </div>
        </div>
      )}
    </div>
  );
};

export default SidebarAuditTracker;