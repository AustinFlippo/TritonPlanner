import React, { useState, useRef } from "react";
import SidebarAuditTracker from "./audit/SidebarAuditTracker";

// Main LeftSidebar Component
// auditData is owned by MainLayout (parsedCourseData) so restored sessions —
// including the reload after the Google OAuth redirect — show up here too
const LeftSidebar = ({
  auditData = { sections: [], metadata: {} },
  schedule = [],
  onParsedDataUpdate,
  expanded = false,
  onToggleExpand,
}) => {
  // State for sidebar width
  const [sidebarWidth, setSidebarWidth] = useState(320); // Default 320px (w-80)
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef(null);

  // A fresh upload parsed by SidebarAuditTracker — report it up
  const handleAuditDataUpdate = (newAuditData) => {
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
      className="bg-white border-r border-gray-200 h-full flex flex-col overflow-hidden relative"
      style={{
        width: expanded ? "100%" : `${sidebarWidth}px`,
      }}
    >
      <SidebarAuditTracker 
        auditData={auditData}
        schedule={schedule}
        onAuditDataUpdate={handleAuditDataUpdate}
        expandState={expanded ? "expanded" : null}
        onToggleExpand={onToggleExpand}
      />
      
      {/* Resize Handle — hidden while near-fullscreen */}
      {!expanded && (
        <div
          className="absolute top-0 right-0 w-1 h-full bg-gray-300 hover:bg-blue-400 cursor-col-resize opacity-0 hover:opacity-100 transition-opacity"
          onMouseDown={handleMouseDown}
          title="Drag to resize sidebar"
        />
      )}
    </div>
  );
};

export default LeftSidebar;
