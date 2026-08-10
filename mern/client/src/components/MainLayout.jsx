import { useState, useEffect, useRef, useCallback } from "react";
import RightSidebar from "./right-sidebar/RightSidebar";
import LeftSidebar from "./LeftSidebar";
import CoursePlannerContainer from "./planner/CoursePlannerContainer"; // use existing planner
import CourseStorage from "./CourseStorage";
import QuarterlyView from "./QuarterlyView";
import Header from "./Header";
import { useAuth } from "../context/AuthContext";
import { api } from "../utils/api";

const STORAGE_KEY = "tp_planner_state";
const SAVE_DEBOUNCE_MS = 800;

const emptySchedule = () =>
  Array(4)
    .fill()
    .map(() => ({
      fall: Array(3).fill(null),
      winter: Array(3).fill(null),
      spring: Array(3).fill(null),
    }));

const scheduleHasCourses = (grid) =>
  Array.isArray(grid) &&
  grid.some(
    (year) =>
      year &&
      ["fall", "winter", "spring"].some((term) =>
        (year[term] || []).some(Boolean)
      )
  );

const MainLayout = () => {
  const { user, initializing } = useAuth();

  const [currentPage, setCurrentPage] = useState("planner");

  // State for parsed degree audit data
  const [parsedCourseData, setParsedCourseData] = useState({
    sections: [],
    metadata: {},
  });

  // Bumped only on a fresh audit upload, so the planner knows to rebuild its
  // grid from the audit. Restoring a saved session sets parsedCourseData
  // WITHOUT bumping this, so the restored grid isn't clobbered.
  const [auditUploadKey, setAuditUploadKey] = useState(0);

  // The planner grid — owned here so the Planner AND the Quarter View can
  // both read and edit it (and the chat assistant can send it as context)
  const [schedule, setSchedule] = useState(emptySchedule);

  // AI-proposed plan the user accepted in chat; keyed so re-applying works
  const [appliedPlan, setAppliedPlan] = useState(null);

  // A saved schedule being restored (from this device or the account)
  const [restoredPlan, setRestoredPlan] = useState(null);

  // "idle" | "saving" | "saved" | "local" | "error"
  const [syncStatus, setSyncStatus] = useState("idle");

  // null | "requirements" | "search" | "chat" — near-fullscreen panel takeover
  const [expandedPanel, setExpandedPanel] = useState(null);

  const hydratedRef = useRef(false);
  const saveTimerRef = useRef(null);
  const serverLoadedRef = useRef(false);

  const handleApplyPlan = (grid) => {
    setAppliedPlan({ grid, key: Date.now() });
    setCurrentPage("planner"); // jump to the planner so the user sees the result
  };

  // A saved snapshot picked from the Storage page
  const handleLoadSavedPlan = (grid) => {
    setRestoredPlan({ grid, key: Date.now() });
    setCurrentPage("planner");
  };

  // Fresh audit upload from the left sidebar
  const handleParsedDataUpdate = (data) => {
    setParsedCourseData(data);
    setAuditUploadKey((k) => k + 1);
  };

  const applySavedState = useCallback((saved) => {
    if (!saved) return;
    if (saved.parsedCourseData && Array.isArray(saved.parsedCourseData.sections)) {
      setParsedCourseData(saved.parsedCourseData);
    }
    if (scheduleHasCourses(saved.schedule)) {
      setRestoredPlan({ grid: saved.schedule, key: Date.now() });
    }
  }, []);

  // 1) Restore whatever this device had saved, immediately on load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) applySavedState(JSON.parse(raw));
    } catch (err) {
      console.error("Failed to restore saved plan:", err);
    }
    hydratedRef.current = true;
  }, [applySavedState]);

  // 2) Once signed in, the account's saved plan wins; if the account has
  //    nothing yet, the next auto-save pushes this device's plan up
  useEffect(() => {
    if (initializing) return;
    if (!user) {
      serverLoadedRef.current = false;
      return;
    }
    if (serverLoadedRef.current) return;
    serverLoadedRef.current = true;

    api
      .loadPlannerState()
      .then(({ data }) => {
        if (
          data &&
          (scheduleHasCourses(data.schedule) ||
            data.parsedCourseData?.sections?.length)
        ) {
          applySavedState(data);
          setSyncStatus("saved");
        }
      })
      .catch((err) => {
        console.error("Failed to load saved plan:", err);
        setSyncStatus("error");
      });
  }, [user, initializing, applySavedState]);

  // 3) Auto-save (debounced): always to this device, and to the account
  //    when signed in
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (
      !scheduleHasCourses(schedule) &&
      !(parsedCourseData.sections || []).length
    ) {
      return; // nothing worth saving yet — don't overwrite a saved plan with an empty one
    }

    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const state = { schedule, parsedCourseData };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (err) {
        console.error("Failed to save plan locally:", err);
      }

      if (user) {
        setSyncStatus("saving");
        api
          .savePlannerState(user.id, state)
          .then(() => setSyncStatus("saved"))
          .catch((err) => {
            console.error("Failed to save plan to account:", err);
            setSyncStatus("error");
          });
      } else {
        setSyncStatus("local");
      }
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(saveTimerRef.current);
  }, [schedule, parsedCourseData, user]);

  // Escape restores the three-column layout from a maximized panel
  useEffect(() => {
    if (!expandedPanel) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setExpandedPanel(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [expandedPanel]);

  // The planner stays mounted (hidden on other pages) so the schedule
  // isn't lost when switching tabs
  const renderPage = () => (
    <>
      <div className={currentPage === "storage" || currentPage === "quarter" ? "hidden" : ""}>
        <CoursePlannerContainer
          schedule={schedule}
          setSchedule={setSchedule}
          parsedCourseData={parsedCourseData}
          auditUploadKey={auditUploadKey}
          externalPlan={appliedPlan}
          restoredPlan={restoredPlan}
          onNavigate={setCurrentPage}
        />
      </div>
      {currentPage === "storage" && (
        <CourseStorage
          schedule={schedule}
          onLoadPlan={handleLoadSavedPlan}
          onNavigate={setCurrentPage}
        />
      )}
      {currentPage === "quarter" && (
        <QuarterlyView
          schedule={schedule}
          setSchedule={setSchedule}
          onNavigate={setCurrentPage}
        />
      )}
    </>
  );

  return (
    <div className="flex flex-col h-screen">
      {/* Full-width app bar with brand + navigation */}
      <Header
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        syncStatus={syncStatus}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Keep sidebars mounted when hidden so upload/chat/search state survives */}
        <div
          className={
            expandedPanel === "requirements"
              ? "flex-1 min-w-0 h-full"
              : expandedPanel
                ? "hidden"
                : "flex-shrink-0 h-full"
          }
        >
          <LeftSidebar
            auditData={parsedCourseData}
            schedule={schedule}
            onParsedDataUpdate={handleParsedDataUpdate}
            expanded={expandedPanel === "requirements"}
            onToggleExpand={() =>
              setExpandedPanel((p) =>
                p === "requirements" ? null : "requirements"
              )
            }
          />
        </div>

        {/* Main content area */}
        <div
          className={
            expandedPanel
              ? "hidden"
              : "flex-grow p-6 overflow-y-auto bg-slate-100"
          }
        >
          {renderPage()}
        </div>

        {/* Right sidebar with course search & assistant */}
        <div
          className={
            expandedPanel === "search" || expandedPanel === "chat"
              ? "flex-1 min-w-0 h-full"
              : expandedPanel
                ? "hidden"
                : "flex-shrink-0 h-full"
          }
        >
          <RightSidebar
            parsedCourseData={parsedCourseData}
            schedule={schedule}
            onApplyPlan={handleApplyPlan}
            expandedPanel={
              expandedPanel === "search" || expandedPanel === "chat"
                ? expandedPanel
                : null
            }
            onExpandedPanelChange={setExpandedPanel}
            layoutExpanded={
              expandedPanel === "search" || expandedPanel === "chat"
            }
          />
        </div>
      </div>
    </div>
  );
};

export default MainLayout;
