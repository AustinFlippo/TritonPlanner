import { useState } from "react";
import RightSidebar from "./right-sidebar/RightSidebar";
import LeftSidebar from "./LeftSidebar";
import CoursePlannerContainer from "./planner/CoursePlannerContainer";
import CourseStorage from "./CourseStorage";
import QuarterlyView from "./QuarterlyView";
import Header from "./Header";
import { useAuth } from "../context/AuthContext";

const EMPTY_SCHEDULE = () =>
  Array(4).fill(null).map(() => ({
    fall: Array(3).fill(null),
    winter: Array(3).fill(null),
    spring: Array(3).fill(null),
  }));

const MainLayout = () => {
  const { currentUser } = useAuth();
  const [currentPage, setCurrentPage] = useState("planner");
  // auditDataForSidebar: shown in the requirements sidebar (updated on upload AND on schedule load)
  const [auditDataForSidebar, setAuditDataForSidebar] = useState({ sections: [], metadata: {} });
  // auditDataForPlanner: drives the schedule-population effect in CoursePlannerContainer
  // Only updated on a fresh audit upload — NOT on schedule load — to avoid overwriting the loaded grid
  const [auditDataForPlanner, setAuditDataForPlanner] = useState({ sections: [], metadata: {} });
  const [plannerCourse, setPlannerCourse] = useState(null);

  // Schedule state lifted here so Header and ScheduleManager can access it
  const [schedule, setSchedule] = useState(EMPTY_SCHEDULE());
  const [currentScheduleId, setCurrentScheduleId] = useState(null);
  const [currentScheduleName, setCurrentScheduleName] = useState("My Schedule");
  const [savedSchedule, setSavedSchedule] = useState(null);

  // Only true when signed in and schedule differs from last save
  const hasUnsavedChanges =
    !!currentUser && (
      savedSchedule === null ||
      JSON.stringify(schedule) !== JSON.stringify(savedSchedule)
    );

  const handleAuditUpload = (data) => {
    setAuditDataForSidebar(data);
    setAuditDataForPlanner(data);
  };

  const handleNewSchedule = () => {
    setSchedule(EMPTY_SCHEDULE());
    setCurrentScheduleId(null);
    setCurrentScheduleName("My Schedule");
    setSavedSchedule(null);
    setAuditDataForSidebar({ sections: [], metadata: {} });
    setAuditDataForPlanner({ sections: [], metadata: {} });
  };

  const handleLoadSchedule = (id, name, grid, auditData) => {
    setSchedule(grid);
    setCurrentScheduleId(id);
    setCurrentScheduleName(name);
    setSavedSchedule(JSON.parse(JSON.stringify(grid)));
    // Only update the sidebar — do NOT update auditDataForPlanner so the
    // CoursePlannerContainer effect doesn't overwrite the loaded grid.
    if (auditData) setAuditDataForSidebar(auditData);
  };

  const renderPage = () => {
    switch (currentPage) {
      case "planner":
        return (
          <CoursePlannerContainer
            parsedCourseData={auditDataForPlanner}
            onCourseClick={setPlannerCourse}
            schedule={schedule}
            setSchedule={setSchedule}
          />
        );
      case "storage":
        return <CourseStorage />;
      case "quarter":
        return <QuarterlyView />;
      default:
        return (
          <CoursePlannerContainer
            parsedCourseData={auditDataForPlanner}
            onCourseClick={setPlannerCourse}
            schedule={schedule}
            setSchedule={setSchedule}
          />
        );
    }
  };

  return (
    <div className="flex h-screen">
      <LeftSidebar onParsedDataUpdate={handleAuditUpload} auditData={auditDataForSidebar} />
      <div className="flex flex-col flex-grow overflow-hidden">
        <Header
          currentScheduleName={currentScheduleName}
          setCurrentScheduleName={setCurrentScheduleName}
          hasUnsavedChanges={hasUnsavedChanges}
          schedule={schedule}
          parsedCourseData={auditDataForSidebar}
          currentScheduleId={currentScheduleId}
          setCurrentScheduleId={setCurrentScheduleId}
          setSavedSchedule={setSavedSchedule}
          onLoadSchedule={handleLoadSchedule}
          onNewSchedule={handleNewSchedule}
        />
        <div className="flex-grow p-6 overflow-y-auto">
          {renderPage()}
        </div>
      </div>
      <RightSidebar plannerCourse={plannerCourse} parsedCourseData={auditDataForSidebar} />
    </div>
  );
};

export default MainLayout;
