import React, { useState } from "react";
import { DndContext, TouchSensor, MouseSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import RightSidebar from "./right-sidebar/RightSidebar";
import LeftSidebar from "./LeftSidebar";
import CoursePlannerContainer from "./planner/CoursePlannerContainer";
import Header from "./Header";
import WelcomePopup from "./WelcomePopup";
import MobileHeader from "./MobileHeader";
import FloatingActionButton from "./FloatingActionButton";
import ActionDrawer from "./ActionDrawer";
import { useMobileUI } from "../context/MobileUIContext";
import { shouldUseDndKit } from "../utils/deviceDetection";
import CourseItem from "./right-sidebar/CourseItem";

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
  const useDndKit = shouldUseDndKit();
  const [activeId, setActiveId] = useState(null);
  const [activeCourse, setActiveCourse] = useState(null);

  // Configure sensors for drag and drop
  const mouseSensor = useSensor(MouseSensor, {
    // Require the mouse to move by 10 pixels before activating
    activationConstraint: {
      distance: 10,
    },
  });

  const touchSensor = useSensor(TouchSensor, {
    // Press delay of 100ms, with tolerance of 5px of movement
    activationConstraint: {
      delay: 100,
      tolerance: 5,
    },
  });

  const sensors = useSensors(
    mouseSensor,
    touchSensor
  );

  // Dnd Kit drag start handler (mobile only)
  const handleDndDragStart = (event) => {
    if (!useDndKit) return;
    
    const { active } = event;
    setActiveId(active.id);
    
    // Store the active course data for the overlay
    if (active.data.current) {
      setActiveCourse(active.data.current.course);
    }
    
    // console.log('Drag start event:', { active });
  };

  // Dnd Kit drag end handler (mobile only)
  const handleDndDragEnd = (event) => {
    if (!useDndKit) return;
    
    const { active, over } = event;
    
    // console.log('Drag end event:', { active, over }); // Debug log
    
    if (!over) {
      // console.log('No drop target'); // Debug log
      return;
    }
    
    // Handle drops on specific course slots
    if (over.id.startsWith('course-slot-')) {
      const courseData = active.data.current;
      const dropZoneData = over.data.current;
      
      console.log('Course data:', courseData); // Debug log
      console.log('Drop zone data:', dropZoneData); // Debug log
      
      if (courseData && courseData.course && courseData.isFromSidebar && dropZoneData) {
        const course = courseData.course;
        const { yearIndex, termKey, courseIndex } = dropZoneData;
        
        console.log('Adding course to specific slot:', { course: course.course_id, yearIndex, termKey, courseIndex }); // Debug log
        
        // Create a custom event with specific slot information
        const addCourseEvent = new CustomEvent('addCourseToPlanner', {
          detail: {
            course: course,
            isFromSidebar: true,
            targetSlot: {
              yearIndex,
              termKey,
              courseIndex
            }
          }
        });
        
        document.dispatchEvent(addCourseEvent);
        closeAllOverlays();
      }
    }
    // Fallback for the old general planner drop zone (if still needed)
    else if (over.id === 'planner-drop-zone') {
      const courseData = active.data.current;
      
      if (courseData && courseData.course && courseData.isFromSidebar) {
        const course = courseData.course;
        
        // Create a custom event to communicate with the planner
        const addCourseEvent = new CustomEvent('addCourseToPlanner', {
          detail: {
            course: course,
            isFromSidebar: true
          }
        });
        
        document.dispatchEvent(addCourseEvent);
        closeAllOverlays();
      }
    }
    
    // Reset active drag state
    setActiveId(null);
    setActiveCourse(null);
  };

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

  const content = (
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

  return useDndKit ? (
    <DndContext 
      sensors={sensors} 
      onDragStart={handleDndDragStart}
      onDragEnd={handleDndDragEnd}
    >
      {content}
      <DragOverlay>
        {activeId && activeCourse ? (
          <div 
            className="transform rotate-12 opacity-90 shadow-2xl bg-white border-2 border-blue-500 rounded-lg p-1 pointer-events-none"
            style={{ zIndex: 9999 }}
          >
            <CourseItem
              course={activeCourse}
              onDoubleClick={() => {}} // No-op for overlay
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  ) : content;
};

export default MainLayout;
