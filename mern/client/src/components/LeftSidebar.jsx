import { useState, useRef, useCallback, useEffect } from "react";
import SidebarAuditTracker from "./audit/SidebarAuditTracker";

// Main LeftSidebar Component
// auditData is owned by MainLayout (parsedCourseData) so restored sessions —
// including the reload after the Google OAuth redirect — show up here too
const LeftSidebar = ({
  auditData = { sections: [], metadata: {} },
  schedule = [],
  onParsedDataUpdate,
  width,
  onWidthChange,
  expanded = false,
  onToggleExpand,
  onMinimize,
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef(null);

  // A fresh upload parsed by SidebarAuditTracker — report it up
  const handleAuditDataUpdate = (newAuditData) => {
    if (onParsedDataUpdate) {
      onParsedDataUpdate(newAuditData);
    }
  };

  const handleMouseMove = useCallback(
    (e) => {
      if (!isResizing || !onWidthChange) return;
      const left = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      onWidthChange(e.clientX - left);
    },
    [isResizing, onWidthChange]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={sidebarRef}
      className="bg-white border-r border-gray-200 h-full flex flex-col overflow-hidden relative"
      style={{ width: `${width}px` }}
    >
      <SidebarAuditTracker
        auditData={auditData}
        schedule={schedule}
        onAuditDataUpdate={handleAuditDataUpdate}
        expandState={expanded ? "expanded" : null}
        onToggleExpand={onToggleExpand}
        onMinimize={expanded ? undefined : onMinimize}
      />

      {/* Resize handle — stays available in full-bleed so you can drag back */}
      <div
        className="absolute top-0 right-0 w-1.5 h-full hover:bg-navy-300 cursor-col-resize z-10 transition-colors"
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
        }}
        title="Drag to resize"
      />
    </div>
  );
};

export default LeftSidebar;
