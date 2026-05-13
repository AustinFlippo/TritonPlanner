import React, { useState, useEffect } from "react";
import RightSidebar from "./right-sidebar/RightSidebar";
import LeftSidebar from "./LeftSidebar";
import CoursePlannerContainer from "./planner/CoursePlannerContainer"; // use existing planner
import CourseStorage from "./CourseStorage";
import QuarterlyView from "./QuarterlyView";
import Header from "./Header";

// Note: Demo data imports are now in LeftSidebar.jsx

const MainLayout = () => {
  const [currentPage, setCurrentPage] = useState("planner");
  
  // State for parsed degree audit data
  const [parsedCourseData, setParsedCourseData] = useState({
    sections: [],
    metadata: {}
  });

  const [plannerCourse, setPlannerCourse] = useState(null);

  // DEMO: Optionally auto-load Austin's data when component mounts
  // TODO: Replace this with actual file upload functionality
  useEffect(() => {
    // Uncomment the lines below to auto-load Austin's data on page load
    
    // const demoData = {
    //   completed_courses: austinCompletedData.completed_courses || [],
    //   current_courses: austinCompletedData.current_courses || [],
    //   requirements: austinRequiredData.requirements || []
    // };
    
    // setParsedCourseData(demoData);
    
  }, []);

  const renderPage = () => {
    switch (currentPage) {
      case "planner":
        return <CoursePlannerContainer parsedCourseData={parsedCourseData} onCourseClick={setPlannerCourse} />;
      case "storage":
        return <CourseStorage />;
      case "quarter":
        return <QuarterlyView />;
      default:
        return <CoursePlannerContainer parsedCourseData={parsedCourseData} onCourseClick={setPlannerCourse} />;
    }
  };

  return (
    <div className="flex h-screen">
      <LeftSidebar
        onParsedDataUpdate={setParsedCourseData}
      />

      {/* Center: header + planner content */}
      <div className="flex flex-col flex-grow overflow-hidden">
        <Header />
        <div className="flex-grow p-6 overflow-y-auto">
          {renderPage()}
        </div>
      </div>

      {/* Right sidebar — full height, outside the header column */}
      <RightSidebar
        plannerCourse={plannerCourse}
      />
    </div>
  );
};

export default MainLayout;
