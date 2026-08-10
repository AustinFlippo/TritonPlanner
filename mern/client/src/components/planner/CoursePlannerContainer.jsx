import { useState, useEffect, useRef } from "react";
import { TriangleAlert } from "lucide-react";
import CoursePlanner from "./CoursePlanner";
import { processAuditForPlanner } from "../../utils/auditCoursePlanner";
import { API_URL } from "../../utils/api";
import { clearYear } from "../../utils/scheduleOps";

// Coerce an AI-proposed grid into valid planner shape: 4 years, each term an
// array of course objects with at least 3 slots and one trailing empty slot
const normalizePlanGrid = (plan) =>
  Array(4)
    .fill()
    .map((_, yearIndex) => {
      const source = (plan && plan[yearIndex]) || {};
      const year = {};
      ["fall", "winter", "spring"].forEach((term) => {
        const courses = (source[term] || []).filter(
          (c) => c && typeof c === "object" && c.course_id
        );
        const slots = [...courses];
        while (slots.length < 2) slots.push(null);
        slots.push(null);
        year[term] = slots;
      });
      return year;
    });

// Grid terms -> catalog quarter codes, for offering warnings
const QUARTER_OF_TERM = { fall: "FA", winter: "WI", spring: "SP" };
const QUARTER_LABEL = { FA: "Fall", WI: "Winter", SP: "Spring" };

const CoursePlannerContainer = ({
  schedule,
  setSchedule,
  parsedCourseData = { sections: [], metadata: {} },
  auditUploadKey = 0,
  externalPlan = null,
  restoredPlan = null,
  onNavigate,
}) => {
  const [yearLabels] = useState([
    "2024-2025",
    "2025-2026",
    "2026-2027",
    "2027-2028",
  ]);

  const [collapsedYears, setCollapsedYears] = useState(Array(4).fill(false));
  const [previewState, setPreviewState] = useState(null);
  const [dragTarget, setDragTarget] = useState({
    yearIndex: null,
    term: null,
    courseIndex: null,
  });
  const [loading, setLoading] = useState(false);

  // Offering warnings. offeringsMap holds catalog offerings for every course
  // on the grid ({ "CSE 100": { known, offerings } }); dropWarning is the
  // live hint while dragging over a term; toast is the post-drop notice.
  const [offeringsMap, setOfferingsMap] = useState({});
  const [dropWarning, setDropWarning] = useState(null);
  const [toast, setToast] = useState(null);
  const draggedCourseRef = useRef(null);
  const toastTimerRef = useRef(null);
  const requestedIdsRef = useRef(new Set()); // ids already looked up (or in flight)

  // Fetch offerings for any grid course we haven't looked up yet. Covers
  // audit-restored and saved-plan cards, whose payloads lack `offerings`.
  useEffect(() => {
    const ids = new Set();
    for (const year of schedule) {
      for (const term of ["fall", "winter", "spring"]) {
        for (const c of year?.[term] || []) {
          if (c?.course_id && !requestedIdsRef.current.has(c.course_id)) ids.add(c.course_id);
        }
      }
    }
    if (ids.size === 0) return;
    for (const id of ids) requestedIdsRef.current.add(id);
    let cancelled = false;
    fetch(`${API_URL}/search-courses/offerings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: [...ids] }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.offerings) {
          setOfferingsMap((prev) => ({ ...prev, ...data.offerings }));
        }
      })
      .catch(() => {}); // warnings are best-effort; the grid works without them
    return () => {
      cancelled = true;
    };
  }, [schedule]);

  /**
   * Offering warning for placing `course` in `termKey`, or null.
   * Only warns about the future: completed/in-progress courses are history.
   * Empty offerings with known:true = "no record in the harvest window";
   * known:false (audit tokens, retired codes) stays silent — no evidence
   * either way.
   */
  const getCourseWarning = (course, termKey) => {
    if (!course?.course_id) return null;
    if (course.status === "completed" || course.status === "current") return null;
    const info =
      offeringsMap[course.course_id] ??
      (Array.isArray(course.offerings) ? { known: true, offerings: course.offerings } : null);
    if (!info || !info.known) return null;
    const offered = info.offerings || [];
    const quarter = QUARTER_OF_TERM[termKey];
    if (offered.length === 0) {
      return {
        type: "no-history",
        message: `${course.course_id} has no record of being offered in the last two years.`,
      };
    }
    if (!offered.includes(quarter)) {
      const past = offered.map((q) => QUARTER_LABEL[q]).join(" and ");
      return {
        type: "quarter",
        message: `${course.course_id} may not be offered in ${QUARTER_LABEL[quarter]} — in the last two years it ran in ${past} only.`,
      };
    }
    return null;
  };

  const showToast = (message) => {
    clearTimeout(toastTimerRef.current);
    setToast({ message });
    toastTimerRef.current = setTimeout(() => setToast(null), 6000);
  };
  const dismissToast = () => {
    clearTimeout(toastTimerRef.current);
    setToast(null);
  };
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  // Effect to populate courses from audit data — only on a FRESH upload
  // (auditUploadKey bump), never when a saved session is being restored
  const lastAuditKeyRef = useRef(0);
  useEffect(() => {
    if (!auditUploadKey || auditUploadKey === lastAuditKeyRef.current) {
      return;
    }
    lastAuditKeyRef.current = auditUploadKey;

    if (!parsedCourseData.sections || parsedCourseData.sections.length === 0) {
      return; // No audit data to process
    }

    // Create fresh schedule
    const emptySchedule = Array(4).fill().map(() => ({
      fall: Array(3).fill(null),
      winter: Array(3).fill(null),
      spring: Array(3).fill(null),
    }));

    // Process audit sections and populate schedule
    const updatedSchedule = processAuditForPlanner(parsedCourseData.sections, emptySchedule);
    setSchedule(updatedSchedule);
  }, [auditUploadKey, parsedCourseData]);

  // Apply a saved schedule being restored (from localStorage or the account)
  useEffect(() => {
    if (restoredPlan && restoredPlan.grid) {
      setSchedule(normalizePlanGrid(restoredPlan.grid));
    }
  }, [restoredPlan]);

  // Apply an AI-proposed plan accepted from the chat assistant
  useEffect(() => {
    if (externalPlan && externalPlan.grid) {
      setSchedule(normalizePlanGrid(externalPlan.grid));
    }
  }, [externalPlan]);

  const toggleYearCollapse = (yearIndex) => {
    const newState = [...collapsedYears];
    newState[yearIndex] = !newState[yearIndex];
    setCollapsedYears(newState);
  };

  const calculateTermUnits = (courses) => {
    return courses.reduce((total, course) => total + (course ? course.credits : 0), 0);
  };

  const calculateAnnualUnits = (yearIndex) => {
    const year = schedule[yearIndex];
    return (
      calculateTermUnits(year.fall) +
      calculateTermUnits(year.winter) +
      calculateTermUnits(year.spring)
    );
  };

  const handleDragStart = (e, course, isFromSidebar = false, yearIndex = null, term = null, courseIndex = null) => {
    // dataTransfer can't be read during dragover, so keep the course in a ref
    // for live offering warnings while hovering terms
    draggedCourseRef.current = course;
    e.dataTransfer.setData("course", JSON.stringify(course));
    e.dataTransfer.setData("isFromSidebar", isFromSidebar.toString());
  
    if (!isFromSidebar) {
      e.dataTransfer.setData("sourceYearIndex", yearIndex.toString());
      e.dataTransfer.setData("sourceTerm", term);
      e.dataTransfer.setData("sourceCourseIndex", courseIndex.toString());
    }
  };
  

  const handleDragOver = (e, yearIndex, term, courseIndex) => {
    e.preventDefault();
    setDragTarget((prev) =>
      prev.yearIndex === yearIndex && prev.term === term && prev.courseIndex === courseIndex
        ? prev
        : { yearIndex, term, courseIndex }
    );
    const warning = getCourseWarning(draggedCourseRef.current, term);
    setDropWarning((prev) => (prev?.message === warning?.message ? prev : warning));
  };

  const handleDrop = (e, yearIndex, term, courseIndex) => {
    e.preventDefault();
  
    const courseData = e.dataTransfer.getData("course");
    const isFromSidebar = e.dataTransfer.getData("isFromSidebar") === "true";
  
    if (!courseData) return;
  
    const course = JSON.parse(courseData);
    const newSchedule = [...schedule];
    const targetYear = newSchedule[yearIndex];
    if (!targetYear || !targetYear[term]) return; // ✅ defensive check
  
    const targetSlot = targetYear[term];
    const existingCourse = targetSlot[courseIndex];
  
    if (!isFromSidebar) {
      
      const sourceYearIndex = parseInt(e.dataTransfer.getData("sourceYearIndex"));
      const sourceTerm = e.dataTransfer.getData("sourceTerm");
      const sourceCourseIndex = parseInt(e.dataTransfer.getData("sourceCourseIndex"));
      
      if (
        sourceYearIndex === yearIndex &&
        sourceTerm === term &&
        sourceCourseIndex === courseIndex
      ) return;
  
      // const sourceCourse = newSchedule[sourceYearIndex]?.[sourceTerm]?.[sourceCourseIndex];
  
      // Swap or clear source
      if (existingCourse) {
        newSchedule[sourceYearIndex][sourceTerm][sourceCourseIndex] = existingCourse;
      } else {
        newSchedule[sourceYearIndex][sourceTerm][sourceCourseIndex] = null;
      }
    }
    
    {/* Ensure one empty slot remains */}
    targetSlot[courseIndex] = course;
  
    if (!targetSlot.some((c) => c === null)) {
      targetSlot.push(null);
    }
  
    setSchedule(newSchedule);
    setPreviewState(null);

    // Non-blocking heads-up when the placement disagrees with offering history.
    // Clear any prior toast when the course lands in a quarter where it's offered.
    const warning = getCourseWarning(course, term);
    if (warning) showToast(warning.message);
    else dismissToast();
  };

  const handleDragEnd = () => {
    setPreviewState(null);
    setDropWarning(null);
    draggedCourseRef.current = null;
    setDragTarget({ yearIndex: null, term: null, courseIndex: null });
  };

  const handleRemoveCourse = (yearIndex, term, courseIndex) => {
    const newSchedule = [...schedule];
    const termCourses = newSchedule[yearIndex][term];
  
    // Remove the course
    termCourses[courseIndex] = null;
  
    // Count nulls
    const nullCount = termCourses.filter((c) => c === null).length;
  
    // Trim excess nulls if more than 1 null and total > 3 slots
    if (termCourses.length > 3 && nullCount > 1) {
      const trimmed = termCourses.filter((c) => c !== null); // keep non-null courses
  
      // Ensure 3 slots minimum + 1 empty
      while (trimmed.length < 2) trimmed.push(null);
      trimmed.push(null); // one empty slot
  
      newSchedule[yearIndex][term] = trimmed;
    }
  
    setSchedule(newSchedule);
  };

  const handleClearYear = (yearIndex) => {
    setSchedule((prev) => clearYear(prev, yearIndex));
  };
  
  const getSlotClassName = (yearIndex, term, courseIndex) => {
    let className = "rounded-lg transition-shadow ";

    // Check if this is the current drag target
    if (
      dragTarget.yearIndex === yearIndex &&
      dragTarget.term === term &&
      dragTarget.courseIndex === courseIndex
    ) {
      // Amber = droppable but offering history disagrees; navy = normal target
      if (dropWarning) {
        className += "ring-2 ring-amber-400 bg-amber-50 ";
      } else {
        className += "ring-2 ring-navy-400 bg-navy-50 ";
      }
    }

    // Check if this is the destination in a preview
    if (
      previewState &&
      previewState.targetYearIndex === yearIndex &&
      previewState.targetTerm === term &&
      previewState.targetCourseIndex === courseIndex
    ) {
      className += "ring-2 ring-gold-400 bg-gold-300/20 ";
    }

    return className;

  };

  const handleExportToSheets = async () => {
    try {
      setLoading(true);
      
      const response = await fetch(`${API_URL}/api/export/google-sheets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          schedule,
          yearLabels,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Open the Google Sheets URL in a new tab
        window.open(data.url, '_blank');
        alert('Schedule exported successfully! Opening Google Sheets...');
      } else {
        console.error('Export failed:', data.error);
        alert(`Export failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export schedule. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Button for saving
      <div className="flex justify-end p-3">
        <button className="bg-blue-500 text-white">Save</button>
      </div>
      */}

      <CoursePlanner
        schedule={schedule}
        yearLabels={yearLabels}
        collapsedYears={collapsedYears}
        toggleYearCollapse={toggleYearCollapse}
        calculateAnnualUnits={calculateAnnualUnits}
        calculateTermUnits={calculateTermUnits}
        handleDragStart={handleDragStart}
        handleDragEnd={handleDragEnd}
        handleDragOver={handleDragOver}
        handleDrop={handleDrop}
        handleRemoveCourse={handleRemoveCourse}
        handleClearYear={handleClearYear}
        previewState={previewState}
        dragTarget={dragTarget}
        dropWarning={dropWarning}
        getCourseWarning={getCourseWarning}
        getSlotClassName={getSlotClassName}
        onExportToSheets={handleExportToSheets}
        onNavigate={onNavigate}
        loading={loading}
      />

      {/* Offering warning toast — non-blocking, auto-dismisses */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-md w-[calc(100%-2rem)] flex items-start gap-2.5 px-4 py-3 rounded-xl bg-white border border-amber-300 shadow-panel"
        >
          <TriangleAlert className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-[13px] text-slate-700 leading-snug">
            {toast.message}
            <span className="block mt-0.5 text-[11px] text-slate-400">
              Based on past schedules — not a guarantee.
            </span>
          </div>
          <button
            onClick={dismissToast}
            className="ml-auto text-slate-300 hover:text-slate-500 text-lg leading-none flex-shrink-0"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
};

export default CoursePlannerContainer;
