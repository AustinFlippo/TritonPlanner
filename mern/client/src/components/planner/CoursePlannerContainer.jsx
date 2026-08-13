import { useState, useEffect, useRef } from "react";
import { TriangleAlert } from "lucide-react";
import CoursePlanner from "./CoursePlanner";
import ConfirmDialog from "../ConfirmDialog";
import {
  outOfWindowAuditCourses,
  processAuditForPlanner,
} from "../../utils/auditCoursePlanner";
import { API_URL } from "../../utils/api";
import { hasUnknownCredits, parseCredits } from "../../utils/courseCredits";
import {
  clearYear,
  normalizePlanGrid,
  placeCourseAt,
  removeCourseAt,
} from "../../utils/scheduleOps";

// Grid terms -> catalog quarter codes, for offering warnings
const QUARTER_OF_TERM = { fall: "FA", winter: "WI", spring: "SP" };
const QUARTER_LABEL = { FA: "Fall", WI: "Winter", SP: "Spring" };

const CoursePlannerContainer = ({
  schedule,
  setSchedule,
  parsedCourseData = { sections: [], metadata: {} },
  auditUploadKey = 0,
  planWindow = null,
  yearLabels = [],
  externalPlan = null,
  restoredPlan = null,
  activeSavedPlan = null,
  onSavedPlanChange,
  onNavigate,
  onOpenCourse,
  buildFreshSchedule = null,
}) => {
  // yearLabels and the grid's length both come from the student's plan window
  // (MainLayout), derived from the audit's Catalog Year — never hardcoded.
  const yearCount = yearLabels.length || 4;

  // Transfer/AP credit posted before Year 1 still counts in the sidebar but
  // has no UCSD term on the grid — surface the list so it doesn't vanish.
  const omittedCourses = outOfWindowAuditCourses(
    parsedCourseData?.sections || [],
    planWindow
  );

  const [collapsedYears, setCollapsedYears] = useState(() =>
    Array(yearCount).fill(false)
  );
  const [previewState, setPreviewState] = useState(null);
  const [dragTarget, setDragTarget] = useState({
    yearIndex: null,
    term: null,
    courseIndex: null,
  });
  const [loading, setLoading] = useState(false);
  // Custom alert dialog (replaces window.alert for export feedback)
  const [alertDialog, setAlertDialog] = useState(null);

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
    const emptySchedule = Array(yearCount).fill().map(() => ({
      fall: Array(3).fill(null),
      winter: Array(3).fill(null),
      spring: Array(3).fill(null),
    }));

    // Process audit sections and populate schedule
    const updatedSchedule = processAuditForPlanner(
      parsedCourseData.sections, emptySchedule, planWindow);
    setSchedule(updatedSchedule);
  }, [auditUploadKey, parsedCourseData, yearCount, planWindow, setSchedule]);

  // Apply a saved schedule being restored (from localStorage or the account)
  useEffect(() => {
    if (restoredPlan && restoredPlan.grid) {
      setSchedule(normalizePlanGrid(restoredPlan.grid, yearCount));
    }
    // Intentionally keyed on restoredPlan alone. Adding yearCount would
    // re-apply the restore every time the plan window changes (an audit upload
    // moves it), overwriting edits made since the restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoredPlan]);

  // Apply an AI-proposed plan accepted from the chat assistant. yearCount is
  // as load-bearing here as on the restore path above: without it the grid is
  // rebuilt at the default four years and a fifth-year student's Year 5 is
  // truncated away by the plan they just accepted.
  useEffect(() => {
    if (externalPlan && externalPlan.grid) {
      setSchedule(normalizePlanGrid(externalPlan.grid, yearCount));
    }
    // Same reasoning as the restore effect above: an accepted AI plan is
    // applied once, when it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPlan]);

  const toggleYearCollapse = (yearIndex) => {
    const newState = [...collapsedYears];
    newState[yearIndex] = !newState[yearIndex];
    setCollapsedYears(newState);
  };

  // Sum of the units we actually know. A course with no published unit count
  // contributes nothing here rather than a made-up 0 — TermBlock counts those
  // separately and shows them beside the total, so the number never quietly
  // claims to cover courses it can't measure.
  const calculateTermUnits = (courses) =>
    (courses || []).reduce(
      (total, course) =>
        !course || hasUnknownCredits(course)
          ? total
          : total + parseCredits(course.credits),
      0
    );

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

    let course;
    try {
      course = JSON.parse(courseData);
    } catch {
      return;
    }
    if (!course?.course_id) return;

    let source = null;
    if (!isFromSidebar) {
      const sourceYearIndex = parseInt(
        e.dataTransfer.getData("sourceYearIndex"),
        10
      );
      const sourceTerm = e.dataTransfer.getData("sourceTerm");
      const sourceCourseIndex = parseInt(
        e.dataTransfer.getData("sourceCourseIndex"),
        10
      );
      if (
        Number.isNaN(sourceYearIndex) ||
        !QUARTER_OF_TERM[sourceTerm] ||
        Number.isNaN(sourceCourseIndex)
      ) {
        return;
      }
      source = {
        yearIndex: sourceYearIndex,
        term: sourceTerm,
        courseIndex: sourceCourseIndex,
      };
    }

    const next = placeCourseAt(
      schedule,
      yearIndex,
      term,
      courseIndex,
      course,
      source
    );
    if (next === schedule) return;

    setSchedule(next);
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
    setSchedule((prev) => removeCourseAt(prev, yearIndex, term, courseIndex));
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
        setAlertDialog({
          title: "Export complete",
          message: "Your schedule was exported. Google Sheets is opening in a new tab.",
        });
      } else {
        console.error('Export failed:', data.error, data.details);
        setAlertDialog({
          title: "Export failed",
          message:
            data.details ||
            data.error ||
            "Something went wrong while exporting.",
        });
      }
    } catch (error) {
      console.error('Export error:', error);
      setAlertDialog({
        title: "Export failed",
        message: "Couldn't export your schedule. Please try again.",
      });
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
        activeSavedPlan={activeSavedPlan}
        onSavedPlanChange={onSavedPlanChange}
        onResetSchedule={setSchedule}
        buildFreshSchedule={buildFreshSchedule}
        onNavigate={onNavigate}
        loading={loading}
        onOpenCourse={onOpenCourse}
        omittedCourses={omittedCourses}
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

      <ConfirmDialog
        open={Boolean(alertDialog)}
        variant="alert"
        title={alertDialog?.title}
        message={alertDialog?.message}
        confirmLabel="OK"
        onConfirm={() => setAlertDialog(null)}
        onCancel={() => setAlertDialog(null)}
      />
    </div>
  );
};

export default CoursePlannerContainer;
