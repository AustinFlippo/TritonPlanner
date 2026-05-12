import React from "react";
import TermBlock from "./TermBlock";

const YearBlock = ({
  year, yearIndex, yearLabel, collapsed, toggleCollapse,
  calculateAnnualUnits, calculateTermUnits,
  handleDragOver, handleDrop, handleDragStart, handleDragEnd,
  handleRemoveCourse, getSlotClassName, previewState, dragTarget, invalidDrop,
  onCourseClick,
}) => {
  return (
    <div style={{ marginBottom: '16px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div
        className="flex justify-between items-center cursor-pointer"
        style={{ background: '#003366', padding: '8px 14px' }}
        onClick={() => toggleCollapse(yearIndex)}
      >
        <div className="flex items-center gap-2">
          <svg
            width="12" height="12" viewBox="0 0 12 12"
            style={{ transition: 'transform 0.2s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', flexShrink: 0 }}
          >
            <path d="M2 4 L6 8 L10 4" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
          <span style={{ fontWeight: 700, fontSize: '13px', color: 'white' }}>{yearLabel}</span>
        </div>
        <span style={{ background: 'rgba(255,255,255,0.15)', color: 'white', borderRadius: '999px', padding: '2px 10px', fontSize: '11px', fontWeight: 600 }}>
          {calculateAnnualUnits(yearIndex).toFixed(1)}u
        </span>
      </div>

      {!collapsed && (
        <div className="flex flex-col md:flex-row" style={{ background: '#f8fafc' }}>
          {['fall', 'winter', 'spring'].map((term) => (
            <TermBlock
              key={term}
              termKey={term}
              termName={term.charAt(0).toUpperCase() + term.slice(1)}
              courses={year[term]}
              yearIndex={yearIndex}
              calculateTermUnits={calculateTermUnits}
              handleDragOver={handleDragOver}
              handleDrop={handleDrop}
              handleDragStart={handleDragStart}
              handleDragEnd={handleDragEnd}
              handleRemoveCourse={handleRemoveCourse}
              getSlotClassName={getSlotClassName}
              previewState={previewState}
              dragTarget={dragTarget}
              invalidDrop={invalidDrop}
              onCourseClick={onCourseClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default YearBlock;
