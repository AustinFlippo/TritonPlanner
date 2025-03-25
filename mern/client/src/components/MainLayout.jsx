import React from "react";
import Header from "./Header";
import CoursePlannerContainer from "./planner/CoursePlannerContainer";
import RightSidebar from "./right-sidebar/RightSidebar";

const MainLayout = () => {

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Top Header */}

      {/* Main content area */}
      <div className="flex h-full w-full overflow-hidden">
        {/* Left: Planner (flexible space) */}
        <div className="flex-grow overflow-auto">
          <CoursePlannerContainer />
        </div>

        {/* Right: Sidebar (fixed width controlled inside RightSidebar) */}
        <RightSidebar />
      </div>
    </div>
  );
};

export default MainLayout;
