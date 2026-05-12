import React, { useState, useRef } from "react";
import SidebarAuditTracker from "./audit/SidebarAuditTracker";

const LeftSidebar = ({ onParsedDataUpdate }) => {
  const [auditData, setAuditData] = useState({ sections: [], metadata: {} });
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const sidebarRef = useRef(null);

  const handleAuditDataUpdate = (newAuditData) => {
    setAuditData(newAuditData);
    if (onParsedDataUpdate) onParsedDataUpdate(newAuditData);
  };

  const handleMouseDown = (e) => {
    setIsResizing(true);
    e.preventDefault();
  };

  const handleMouseMove = React.useCallback((e) => {
    if (!isResizing) return;
    const newWidth = e.clientX;
    if (newWidth >= 250 && newWidth <= 600) setSidebarWidth(newWidth);
  }, [isResizing]);

  const handleMouseUp = () => setIsResizing(false);

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

  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center h-full cursor-pointer flex-shrink-0"
        style={{ width: '28px', background: '#003366' }}
        onClick={() => setCollapsed(false)}
        title="Expand requirements"
      >
        <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '10px', marginTop: '10px' }}>▶</span>
        <span style={{
          writingMode: 'vertical-lr',
          transform: 'rotate(180deg)',
          fontSize: '7px',
          fontWeight: 700,
          letterSpacing: '0.5px',
          color: 'rgba(255,255,255,0.4)',
          marginTop: '10px',
        }}>REQUIREMENTS</span>
      </div>
    );
  }

  return (
    <div
      ref={sidebarRef}
      className="bg-white border-r border-gray-200 h-full flex flex-col overflow-hidden relative flex-shrink-0"
      style={{ width: `${sidebarWidth}px` }}
    >
      {/* Section header with collapse button */}
      <div
        className="flex items-center px-3 flex-shrink-0"
        style={{ height: '36px', background: '#003366' }}
      >
        <span style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '0.5px', color: 'white', flex: 1 }}>
          REQUIREMENTS
        </span>
        <button
          onClick={() => setCollapsed(true)}
          style={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
          title="Collapse"
        >
          ◀
        </button>
      </div>

      <SidebarAuditTracker
        auditData={auditData}
        onAuditDataUpdate={handleAuditDataUpdate}
      />

      <div
        className="absolute top-0 right-0 w-1 h-full bg-gray-300 hover:bg-blue-400 cursor-col-resize opacity-0 hover:opacity-100 transition-opacity"
        onMouseDown={handleMouseDown}
        title="Drag to resize sidebar"
      />
    </div>
  );
};

export default LeftSidebar;