import React, { useState } from "react";
import RightSidebar from "./right-sidebar/RightSidebar";
import LeftSidebar from "./LeftSidebar";
import CoursePlannerContainer from "./planner/CoursePlannerContainer";
import Header from "./Header";
import WelcomePopup from "./WelcomePopup";
import MobileHeader from "./MobileHeader";
import FloatingActionButton from "./FloatingActionButton";
import ActionDrawer from "./ActionDrawer";
import { useMobileUI } from "../context/MobileUIContext";

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

  const { isLeftSidebarOpen, isActionDrawerOpen, closeAllOverlays } = useMobileUI();

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
    <div className="flex flex-col md:flex-row h-screen">
      {/* Mobile Header - Only visible on mobile */}
      <MobileHeader />

      {/* Backdrop overlay for mobile overlays */}
      {/* {(isLeftSidebarOpen || isActionDrawerOpen) && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-30 md:hidden"
          onClick={closeAllOverlays}
        />
      )} */}
      {/* The backdrop overlay NOW ONLY appears for the Left Sidebar */}
      {isLeftSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-30 md:hidden"
          onClick={closeAllOverlays}
        />
      )}

      {/* Left Sidebar - Mobile drawer or desktop sidebar */}
      <LeftSidebar 
        onParsedDataUpdate={setParsedCourseData} 
        isOpen={isLeftSidebarOpen}
      />

      {/* Main Content Area */}
      <div className="flex flex-col flex-grow overflow-hidden">
        {/* Desktop Header - Only visible on desktop */}
        <div className="hidden md:block">
          <Header 
            currentPage={pageTitles[currentPage] || "Blueprint"} 
            onTutorialClick={handleTutorialClick}
          />
        </div>

        {/* Desktop Layout */}
        <div className="hidden md:flex md:flex-1 md:overflow-hidden">
          <div className="flex-grow p-6 overflow-y-auto">
            {renderPage()}
          </div>
          <RightSidebar />
        </div>

        {/* Mobile Content Area - Only visible on mobile */}
        <div className="flex-grow overflow-y-auto md:hidden">
          <div className="p-4">
            {renderPage()}
          </div>
        </div>
      </div>

      {/* Floating Action Button - Mobile only */}
      <FloatingActionButton />

      {/* Action Drawer - Mobile only */}
      <ActionDrawer />

      <WelcomePopup 
        showPopup={showWelcomePopup} 
        onClose={handleCloseWelcomePopup}
      />
    </div>
  );
};

export default MainLayout;
