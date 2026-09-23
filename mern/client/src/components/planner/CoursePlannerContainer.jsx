import { useState, useEffect, useMemo, useRef } from "react";
import { TriangleAlert } from "lucide-react";
import CoursePlanner from "./CoursePlanner";
import ConfirmDialog from "../ConfirmDialog";
import { outOfWindowAuditCourses } from "../../utils/auditCoursePlanner";
import { API_URL } from "../../utils/api";
import { hasUnknownCredits, parseCredits } from "../../utils/courseCredits";
import {
  clearYear,
  normalizePlanGrid,
  placeCourseAt,
  removeCourseAt,
  setCourseEnrolled,
  withoutEnrolledMark,
} from "../../utils/scheduleOps";
import { extractCompletedCourses } from "../../utils/recommendations";
import { isTakenCourse } from "../../utils/courseIds";
import {
  prereqPositions,
  prereqWarningFor,
} from "../../utils/prereqCheck";
import { useNextQuarterOfferings } from "../../context/NextQuarterOfferingsContext";
import {
  enrollmentPlacementBlock,
  enrollmentSeatWarning,
} from "../../utils/nextQuarterOfferings";
import { downloadCsv, scheduleToCsv } from "../../utils/scheduleExport";

// Grid terms -> catalog quarter codes, for offering warnings
const QUARTER_OF_TERM = { fall: "FA", winter: "WI", spring: "SP" };
const QUARTER_LABEL = { FA: "Fall", WI: "Winter", SP: "Spring" };

const CoursePlannerContainer = ({
  schedule,
  setSchedule,
  parsedCourseData = { sections: [], metadata: {} },
  planWindow = null,
  yearLabels = [],
  externalPlan = null,
  restoredPlan = null,
  activeSavedPlan = null,
  onSavedPlanChange,
  onLoadPlan,
  onChatCarryOver,
  onNavigate,
  onOpenCourse,
  buildFreshSchedule = null,
  enrollmentSlot = null,
  // Phone layout: no drag-and-drop, so placement is arm-then-tap. The armed
  // course lives in MainLayout because it can be armed from the right rail.
  compact = false,
  pendingPlacement = null,
  onQueuePlacement = null,
  onCancelPlacement = null,
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
  const [graphsMap, setGraphsMap] = useState({});
  const [dropWarning, setDropWarning] = useState(null);
  const [toast, setToast] = useState(null);
  const draggedCourseRef = useRef(null);
  const toastTimerRef = useRef(null);
  const requestedIdsRef = useRef(new Set()); // ids already looked up (or in flight)
  const graphsRequestedRef = useRef(new Set());
  const { isOffered, tssOfferings, seatChipFor } = useNextQuarterOfferings();

  const isEnrollmentTerm = (yearIndex, term) =>
    Boolean(
      enrollmentSlot &&
        yearIndex === enrollmentSlot.yearIndex &&
        term === enrollmentSlot.term
    );

  const getEnrollmentBlock = (course, yearIndex, term) => {
    if (!isEnrollmentTerm(yearIndex, term)) return null;
    return enrollmentPlacementBlock(course, {
      offeringsReady: tssOfferings.status === "ready",
      isOffered,
    });
  };

  const getEnrollmentSeatWarning = (course, yearIndex, term) => {
    if (!isEnrollmentTerm(yearIndex, term)) return null;
    return enrollmentSeatWarning(course, {
      offeringsReady: tssOfferings.status === "ready",
      isOffered,
      seatChip: course?.course_id ? seatChipFor(course.course_id) : null,
    });
  };

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

  // Prereq-graph rows for every grid course, same batch pattern as offerings.
  useEffect(() => {
    const ids = new Set();
    for (const year of schedule) {
      for (const term of ["fall", "winter", "spring"]) {
        for (const c of year?.[term] || []) {
          if (c?.course_id && !graphsRequestedRef.current.has(c.course_id)) {
            ids.add(c.course_id);
          }
        }
      }
    }
    if (ids.size === 0) return;
    for (const id of ids) graphsRequestedRef.current.add(id);
    let cancelled = false;
    fetch(`${API_URL}/search-courses/graphs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: [...ids] }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.graphs) {
          setGraphsMap((prev) => ({ ...prev, ...data.graphs }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [schedule]);

  // Audit-completed and out-of-window (AP/transfer) credit sit before every
  // grid term, so they satisfy prerequisites without occupying a slot.
  const prereqExtraIds = useMemo(() => {
    const sections = parsedCourseData?.sections || [];
    const completed = extractCompletedCourses(sections, null);
    const omitted = outOfWindowAuditCourses(sections, planWindow)
      .map((c) => c.course_id)
      .filter(Boolean);
    return [...new Set([...completed, ...omitted])];
  }, [parsedCourseData, planWindow]);

  const prereqPositionMap = useMemo(
    () => prereqPositions(schedule, prereqExtraIds),
    [schedule, prereqExtraIds]
  );

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
    // Registered on WebReg: the offering is confirmed, whatever history says.
    if (course.enrolled === true) return null;
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

  /**
   * Missing-prereq warning for placing `course` at (yearIndex, termKey).
   * Pass `grid` after a drop so the toast sees the course in its new seat.
   */
  const getPrereqWarning = (course, termKey, yearIndex, grid = null) => {
    if (!course?.course_id) return null;
    const position = grid
      ? prereqPositions(grid, prereqExtraIds)
      : prereqPositionMap;
    return prereqWarningFor(
      course,
      yearIndex,
      termKey,
      graphsMap[course.course_id],
      position
    );
  };

  const showToast = (message, hint) => {
    clearTimeout(toastTimerRef.current);
    setToast({ message, hint });
    toastTimerRef.current = setTimeout(() => setToast(null), 6000);
  };
  const dismissToast = () => {
    clearTimeout(toastTimerRef.current);
    setToast(null);
  };
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  // Audit uploads no longer rebuild the grid here: MainLayout merges the new
  // audit into the current schedule (mergeAuditIntoSchedule), so planned
  // courses survive a re-upload and restores never race a rebuild.

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

  // A course arriving from search / chat isn't on the grid yet, so the
  // schedule effect hasn't fetched its prereq graph. Warm it as soon as the
  // student picks it up, so the first placement can flag missing prereqs
  // rather than only the re-render after it.
  const prefetchGraph = (courseId) => {
    if (!courseId || graphsRequestedRef.current.has(courseId)) return;
    graphsRequestedRef.current.add(courseId);
    fetch(`${API_URL}/search-courses/graphs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: [courseId] }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.graphs) setGraphsMap((prev) => ({ ...prev, ...data.graphs }));
      })
      .catch(() => {});
  };

  const handleDragStart = (e, course, isFromSidebar = false, yearIndex = null, term = null, courseIndex = null) => {
    // dataTransfer can't be read during dragover, so keep the course in a ref
    // for live offering warnings while hovering terms
    draggedCourseRef.current = course;
    prefetchGraph(course?.course_id);
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
    const warning =
      getEnrollmentBlock(draggedCourseRef.current, yearIndex, term) ||
      getEnrollmentSeatWarning(draggedCourseRef.current, yearIndex, term) ||
      getPrereqWarning(draggedCourseRef.current, term, yearIndex) ||
      getCourseWarning(draggedCourseRef.current, term);
    setDropWarning((prev) => (prev?.message === warning?.message ? prev : warning));
  };

  /**
   * Put `course` in a slot, whatever gesture asked for it. Drag-and-drop and
   * the phone's tap-to-place both land here so the guards (already completed,
   * not offered next quarter) and the follow-up warnings stay identical.
   * `source` is null when the course comes from search / chat.
   */
  const commitPlacement = ({ course, source, yearIndex, term, courseIndex }) => {
    if (!course?.course_id) return false;
    const isFromSidebar = !source;

    const takenIds = extractCompletedCourses(
      parsedCourseData?.sections,
      schedule
    );
    if (isFromSidebar && isTakenCourse(course.course_id, takenIds)) {
      showToast(
        `${course.course_id} is already completed (or in progress) — it won’t be added again.`,
        null
      );
      return false;
    }

    const movingWithinEnrollment =
      source &&
      isEnrollmentTerm(source.yearIndex, source.term) &&
      isEnrollmentTerm(yearIndex, term);
    if (!movingWithinEnrollment) {
      const block = getEnrollmentBlock(course, yearIndex, term);
      if (block) {
        showToast(block.message, "Based on the live Class Planner schedule.");
        return false;
      }
    }

    // The "I registered" mark describes a seat in the enrollment quarter. A
    // card dragged to any other term is a plan again, so the mark comes off.
    const placedCourse = isEnrollmentTerm(yearIndex, term)
      ? course
      : withoutEnrolledMark(course);
    const next = placeCourseAt(
      schedule,
      yearIndex,
      term,
      courseIndex,
      placedCourse,
      source,
      takenIds
    );
    if (next === schedule) return false;

    setSchedule(next);
    setPreviewState(null);

    // Non-blocking heads-up: missing prereqs first, then seats, then history.
    const prereq = getPrereqWarning(placedCourse, term, yearIndex, next);
    const seats = getEnrollmentSeatWarning(placedCourse, yearIndex, term);
    const offering = getCourseWarning(placedCourse, term);
    if (prereq) {
      showToast(
        prereq.message,
        "Prerequisites must sit in an earlier quarter."
      );
    } else if (seats) {
      showToast(
        seats.message,
        "You can still plan it — seats open, and waitlisting is an option."
      );
    } else if (offering) {
      showToast(offering.message);
    } else {
      dismissToast();
    }
    return true;
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

    commitPlacement({ course, source, yearIndex, term, courseIndex });
  };

  const handleDragEnd = () => {
    setPreviewState(null);
    setDropWarning(null);
    draggedCourseRef.current = null;
    setDragTarget({ yearIndex: null, term: null, courseIndex: null });
  };

  // ---- Tap-to-place (phones) -------------------------------------------
  const placementCourse = compact ? pendingPlacement?.course || null : null;

  // The collapse state to put back once the placement resolves, and the year
  // that received the course (which stays open so the student lands on it).
  const collapsedBeforePlacementRef = useRef(null);
  const placedYearRef = useRef(null);

  // Warm the armed course's prereq graph, and open every year: a target
  // hidden inside a collapsed year would leave the student tapping at
  // nothing with no way to tell why.
  useEffect(() => {
    if (!placementCourse) return;
    prefetchGraph(placementCourse.course_id);
    setCollapsedYears((prev) => {
      collapsedBeforePlacementRef.current = prev;
      return Array(yearCount).fill(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- arming is the signal
  }, [pendingPlacement?.token]);

  // Placement over (placed or cancelled): fold the grid back up so the
  // student isn't left scrolling through years they never opened. The year
  // the course landed in stays open — that's the one they want to see.
  useEffect(() => {
    if (placementCourse) return;
    const saved = collapsedBeforePlacementRef.current;
    if (!saved) return;
    collapsedBeforePlacementRef.current = null;
    const landedIn = placedYearRef.current;
    placedYearRef.current = null;
    setCollapsedYears(
      saved.map((collapsed, index) => (index === landedIn ? false : collapsed))
    );
  }, [placementCourse]);

  /**
   * Drop the armed course into a term's first free slot. Phones target the
   * quarter rather than an individual slot — three 44px slots stacked in a
   * term are a coin toss under a thumb, and the slot order carries no
   * meaning anyway.
   */
  const handlePlaceInTerm = (yearIndex, term) => {
    if (!pendingPlacement?.course) return;
    const slots = schedule[yearIndex]?.[term] || [];
    let courseIndex = slots.findIndex((slot) => !slot);
    if (courseIndex === -1) courseIndex = slots.length;
    const placed = commitPlacement({
      course: pendingPlacement.course,
      source: pendingPlacement.source || null,
      yearIndex,
      term,
      courseIndex,
    });
    if (placed) placedYearRef.current = yearIndex;
    // Clear either way: a rejected placement already explains itself in a
    // toast, and leaving the banner armed reads as "try again here".
    onCancelPlacement?.();
  };

  // Phones open on the quarter the student is actually enrolling in; the
  // other years are a long scroll past courses they can't act on yet.
  useEffect(() => {
    if (!compact) return;
    setCollapsedYears(
      Array(yearCount)
        .fill(true)
        .map((_, index) => index !== (enrollmentSlot?.yearIndex ?? 0))
    );
  }, [compact, yearCount, enrollmentSlot?.yearIndex]);

  /**
   * The enrolled toggle for a card, or null when the card can't carry one:
   * only planned cards in the enrollment quarter — the one term with seat
   * data worth silencing — and never transcript cards, which are already
   * on the audit.
   */
  const enrolledToggleFor = (course, yearIndex, term) => {
    if (!course?.course_id || !isEnrollmentTerm(yearIndex, term)) return null;
    if (course.status === "completed" || course.status === "current") return null;
    // No toast: the card flips to "Enrolled" under the cursor, and the toast
    // is styled as a warning — which this is the opposite of.
    return () =>
      setSchedule((prev) =>
        setCourseEnrolled(
          prev,
          yearIndex,
          term,
          course.course_id,
          course.enrolled !== true
        )
      );
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
        className +=
          dropWarning.type === "not-live"
            ? "ring-2 ring-red-400 bg-red-50 "
            : "ring-2 ring-amber-400 bg-amber-50 ";
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
      const csv = scheduleToCsv(schedule, yearLabels);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`Academic Planner - ${stamp}.csv`, csv);
      setAlertDialog({
        title: "Export complete",
        message:
          "Your plan downloaded as a CSV. Open it in Google Sheets (File → Import) or Excel.",
      });
    } catch (error) {
      console.error("Export error:", error);
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
        getPrereqWarning={getPrereqWarning}
        getSlotClassName={getSlotClassName}
        onExportToSheets={handleExportToSheets}
        activeSavedPlan={activeSavedPlan}
        onSavedPlanChange={onSavedPlanChange}
        onLoadPlan={onLoadPlan}
        onChatCarryOver={onChatCarryOver}
        onResetSchedule={setSchedule}
        buildFreshSchedule={buildFreshSchedule}
        onNavigate={onNavigate}
        loading={loading}
        onOpenCourse={onOpenCourse}
        omittedCourses={omittedCourses}
        compact={compact}
        placementCourse={placementCourse}
        onPlaceInTerm={handlePlaceInTerm}
        onCancelPlacement={onCancelPlacement}
        enrolledToggleFor={enrolledToggleFor}
        onMoveCourse={
          compact && onQueuePlacement
            ? (course, yearIndex, term, courseIndex) =>
                onQueuePlacement(course, { yearIndex, term, courseIndex })
            : undefined
        }
      />

      {/* Offering warning toast — non-blocking, auto-dismisses */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] lg:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-md w-[calc(100%-2rem)] flex items-start gap-2.5 px-4 py-3 rounded-xl bg-white border border-amber-300 shadow-panel"
        >
          <TriangleAlert className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-[13px] text-slate-700 leading-snug">
            {toast.message}
            {toast.hint !== null && (
              <span className="block mt-0.5 text-[11px] text-slate-400">
                {toast.hint ??
                  "Based on past schedules — not a guarantee."}
              </span>
            )}
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
