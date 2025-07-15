import React, { useState, useRef } from "react";
import SidebarAuditTracker from "./audit/SidebarAuditTracker";
import { useMobileUI } from "../context/MobileUIContext";

// Main LeftSidebar Component
const LeftSidebar = ({ onParsedDataUpdate, isOpen }) => {
  const { closeAllOverlays } = useMobileUI();
  // State for parsed data from uploaded degree audit
  const [auditData, setAuditData] = useState({
    sections: [],
    metadata: {}
  });

  // State for sidebar width
  const [sidebarWidth, setSidebarWidth] = useState(320); // Default 320px (w-80)
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef(null);

  // Handle audit data updates from the SidebarAuditTracker
  const handleAuditDataUpdate = (newAuditData) => {
    setAuditData(newAuditData);
    
    // Update the parent component with all parsed data
    if (onParsedDataUpdate) {
      onParsedDataUpdate(newAuditData);
    }
  };

  // Handle mouse down on resize handle
  const handleMouseDown = (e) => {
    setIsResizing(true);
    e.preventDefault();
  };

  // Handle mouse move for resizing
  const handleMouseMove = React.useCallback((e) => {
    if (!isResizing) return;
    
    const newWidth = e.clientX;
    if (newWidth >= 250 && newWidth <= 600) { // Min 250px, Max 600px
      setSidebarWidth(newWidth);
    }
  }, [isResizing]);

  // Handle mouse up to stop resizing
  const handleMouseUp = () => {
    setIsResizing(false);
  };

  // Add global mouse event listeners
  React.useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove]);
  
  return (
    <div 
      ref={sidebarRef}
      className={`
        bg-white border-r border-gray-200 h-full flex flex-col overflow-hidden
        fixed top-0 left-0 z-40 w-3/4 shadow-lg transition-transform duration-300
        md:relative md:w-auto md:shadow-none md:translate-x-0 md:z-auto
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}
      style={{ width: window.innerWidth >= 768 ? `${sidebarWidth}px` : '75%' }}
    >
      {/* Mobile close button */}
      <div className="block md:hidden p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">Degree Audit</h2>
          <button
            onClick={closeAllOverlays}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Close sidebar"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <SidebarAuditTracker 
        auditData={auditData}
        onAuditDataUpdate={handleAuditDataUpdate}
      />
      
      {/* Resize Handle - Only visible on desktop */}
      <div
        className="absolute top-0 right-0 w-1 h-full bg-gray-300 hover:bg-blue-400 cursor-col-resize opacity-0 hover:opacity-100 transition-opacity hidden md:block"
        onMouseDown={handleMouseDown}
        title="Drag to resize sidebar"
      />
    </div>
  );
};

export default LeftSidebar;