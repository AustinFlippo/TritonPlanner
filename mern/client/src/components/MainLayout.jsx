// import React from "react";
// import Header from "./Header";
// import CoursePlannerContainer from "./planner/CoursePlannerContainer";
// import RightSidebar from "./right-sidebar/RightSidebar";

// const MainLayout = () => {

//   return (
//     <div className="flex flex-col h-screen bg-gray-100">
//       {/* Top Header */}

//       {/* Main content area */}
//       <div className="flex h-full w-full overflow-hidden">
//         {/* Left: Planner (flexible space) */}
//         <div className="flex-grow overflow-y-auto overflow-x-hidden">
//           <CoursePlannerContainer />
//         </div>

//         {/* Right: Sidebar (fixed width controlled inside RightSidebar) */}
//         <RightSidebar />
//       </div>
//     </div>
//   );
// };

// export default MainLayout;

import React, { useState } from "react";
import RightSidebar from "./right-sidebar/RightSidebar";
import LeftSidebar from "./LeftSidebar";
import CoursePlannerContainer from "./planner/CoursePlannerContainer"; // use existing planner
import CourseStorage from "./CourseStorage";
import QuarterlyView from "./QuarterlyView";

const MainLayout = () => {
  const [currentPage, setCurrentPage] = useState("planner");

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
      <LeftSidebar setCurrentPage={setCurrentPage} currentPage={currentPage} />
      
      {/* Main content area */}
      <div className="flex-grow p-6 overflow-y-auto">
        {renderPage()}
      </div>

      {/* Right sidebar with course search & assistant */}
      <RightSidebar />
    </div>
  );
};

export default MainLayout;
