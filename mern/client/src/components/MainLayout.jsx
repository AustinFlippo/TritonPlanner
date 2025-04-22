import React, { useState } from "react";
import RightSidebar from "./right-sidebar/RightSidebar";
import LeftSidebar from "./LeftSidebar";
import CoursePlannerContainer from "./planner/CoursePlannerContainer"; // use existing planner
import CourseStorage from "./CourseStorage";
import QuarterlyView from "./QuarterlyView";
import Header from "./Header";

const completedCourses = [
  { "id": "CSE 100", "units": 4 },
  { "id": "MATH 20C", "units": 4 },
  { "id": "PHYS 2A", "units": 4 }
];


const MainLayout = () => {
  
  const [currentPage, setCurrentPage] = useState("planner");

  const pageTitles = {
    planner: "4-Year Planner",
    storage: "Course Storage",
    quarter: "Quarter View",
  };  

  const renderPage = () => {
    switch (currentPage) {
      case "planner":
        return <CoursePlannerContainer />;
      case "storage":
        return <CourseStorage />;
      case "quarter":
        return <QuarterlyView />;
      default:
        return <CoursePlannerContainer />;
    }
  };

  return (
    <div className="flex h-screen">
      <LeftSidebar setCurrentPage={setCurrentPage} currentPage={currentPage} completedCourses={completedCourses}/>

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
