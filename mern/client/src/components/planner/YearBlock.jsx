import React from "react";
import TermBlock from "./TermBlock";

const YearBlock = ({
  year,
  yearIndex,
  yearLabel,
  collapsed,
  toggleCollapse,
  calculateAnnualUnits,
  calculateTermUnits,
  handleDragOver,
  handleDrop,
  handleDragStart,
  handleDragEnd,
  handleRemoveCourse,
  getSlotClassName,
  previewState,
  dragTarget,
  invalidDrop
}) => {
  return (
    <div className="mb-6 border rounded-lg overflow-hidden shadow-md">
      {/* Year header */}
      <div
        className="bg-blue-500 text-white p-3 flex justify-between items-center cursor-pointer"
        onClick={() => toggleCollapse(yearIndex)}
      >
        <div className="flex items-center">
          <span className="mr-2">{collapsed ? "▶" : "▼"}</span>
          <span className="font-bold">{yearLabel}</span>
        </div>
        <div className="flex items-center">
          <span className="mr-2">annual units</span>
          <span className="bg-white text-blue-500 rounded-full px-3 py-1 font-bold">
            {calculateAnnualUnits(yearIndex).toFixed(1)}
          </span>
        </div>
      </div>

      {/* Terms */}
      {!collapsed && (
        <div className="flex flex-col md:flex-row">
          {['fall', 'winter', 'spring'].map((term) => (
            <TermBlock
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
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default YearBlock;
