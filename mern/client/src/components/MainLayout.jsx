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

  const pageTitles = {
    planner: "4-Year Planner",
    storage: "Course Storage",
    quarter: "Quarter View",
  };  

  const renderPage = () => {
    switch (currentPage) {
      case "planner":
        return <CoursePlannerContainer parsedCourseData={parsedCourseData} />;
      case "storage":
        return <CourseStorage />;
      case "quarter":
        return <QuarterlyView />;
      default:
        return <CoursePlannerContainer parsedCourseData={parsedCourseData} />;
    }
  };

  return (
    <div className="flex h-screen">
      <LeftSidebar 
        onParsedDataUpdate={setParsedCourseData}
      />

      {/* Main Panel: header + content + right sidebar */}
      
      <div className="flex flex-col flex-grow overflow-hidden">
        <Header currentPage={pageTitles[currentPage] || "Blueprint"} />

        <div className="flex flex-1 overflow-hidden">
          {/* Main content area */}
          <div className="flex-grow p-6 overflow-y-auto">
            {renderPage()}
          </div>

          {/* Right sidebar with course search & assistant */}
          <RightSidebar />

        </div>
      </div>
    </div>
  );
};

export default MainLayout;
