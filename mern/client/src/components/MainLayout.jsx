import React, { useState } from "react";
import RightSidebar from "./right-sidebar/RightSidebar";
import LeftSidebar from "./LeftSidebar";
import CoursePlannerContainer from "./planner/CoursePlannerContainer";
import CourseStorage from "./CourseStorage";
import QuarterlyView from "./QuarterlyView";
import Header from "./Header";

const EMPTY_SCHEDULE = () =>
  Array(4).fill(null).map(() => ({
    fall: Array(3).fill(null),
    winter: Array(3).fill(null),
    spring: Array(3).fill(null),
  }));

const MainLayout = () => {
  const [currentPage, setCurrentPage] = useState("planner");
  const [parsedCourseData, setParsedCourseData] = useState({ sections: [], metadata: {} });
  const [plannerCourse, setPlannerCourse] = useState(null);

  // Schedule state lifted here so Header and ScheduleManager can access it
  const [schedule, setSchedule] = useState(EMPTY_SCHEDULE());
  const [currentScheduleId, setCurrentScheduleId] = useState(null);
  const [currentScheduleName, setCurrentScheduleName] = useState("My Schedule");
  const [savedSchedule, setSavedSchedule] = useState(null);

  // True when logged in and schedule differs from last save (or has never been saved)
  const hasUnsavedChanges =
    savedSchedule === null ||
    JSON.stringify(schedule) !== JSON.stringify(savedSchedule);

  const handleLoadSchedule = (id, name, grid) => {
    setSchedule(grid);
    setCurrentScheduleId(id);
    setCurrentScheduleName(name);
    setSavedSchedule(grid);
  };

  const renderPage = () => {
    switch (currentPage) {
      case "planner":
        return (
          <CoursePlannerContainer
            parsedCourseData={parsedCourseData}
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
            parsedCourseData={parsedCourseData}
            onCourseClick={setPlannerCourse}
            schedule={schedule}
            setSchedule={setSchedule}
          />
        );
    }
  };

  return (
    <div className="flex h-screen">
      <LeftSidebar onParsedDataUpdate={setParsedCourseData} />
      <div className="flex flex-col flex-grow overflow-hidden">
        <Header
          currentScheduleName={currentScheduleName}
          setCurrentScheduleName={setCurrentScheduleName}
          hasUnsavedChanges={hasUnsavedChanges}
          schedule={schedule}
          currentScheduleId={currentScheduleId}
          setCurrentScheduleId={setCurrentScheduleId}
          setSavedSchedule={setSavedSchedule}
          onLoadSchedule={handleLoadSchedule}
        />
        <div className="flex-grow p-6 overflow-y-auto">
          {renderPage()}
        </div>
      </div>
      <RightSidebar plannerCourse={plannerCourse} parsedCourseData={parsedCourseData} />
    </div>
  );
};

export default MainLayout;
