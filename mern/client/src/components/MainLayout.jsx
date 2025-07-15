import React, { useState } from "react";
import RightSidebar from "./right-sidebar/RightSidebar";
import LeftSidebar from "./LeftSidebar";
import CoursePlannerContainer from "./planner/CoursePlannerContainer";
import Header from "./Header";
import WelcomePopup from "./WelcomePopup";

// Import your new component
import Maintenance from "./Maintenance";

const MainLayout = () => {
  const [currentPage, setCurrentPage] = useState("planner");
  const [maintenanceMode, setMaintenanceMode] = useState(false); // toggle flag
  const [showWelcomePopup, setShowWelcomePopup] = useState(true);
  
  const [parsedCourseData, setParsedCourseData] = useState({
    sections: [],
    metadata: {}
  });

  const pageTitles = {
    planner: "Triton Planner - Plan Your Future at UCSD",
  };

  const handleTutorialClick = () => {
    setShowWelcomePopup(true);
  };

  const handleCloseWelcomePopup = () => {
    setShowWelcomePopup(false);
  };

  if (maintenanceMode) {
    // Only show maintenance screen
    return <Maintenance />;
  }

  const renderPage = () => {
    switch (currentPage) {
      case "planner":
        return <CoursePlannerContainer parsedCourseData={parsedCourseData} />;
      default:
        return <CoursePlannerContainer parsedCourseData={parsedCourseData} />;
    }
  };

  return (
    <div className="flex h-screen">
      <LeftSidebar onParsedDataUpdate={setParsedCourseData} />

      <div className="flex flex-col flex-grow overflow-hidden">
        <Header 
          currentPage={pageTitles[currentPage] || "Blueprint"} 
          onTutorialClick={handleTutorialClick}
        />

        <div className="flex flex-1 overflow-hidden">
          <div className="flex-grow p-6 overflow-y-auto">
            {renderPage()}
          </div>
          <RightSidebar />
        </div>
      </div>

      <WelcomePopup 
        showPopup={showWelcomePopup} 
        onClose={handleCloseWelcomePopup}
      />
    </div>
  );
};

export default MainLayout;
