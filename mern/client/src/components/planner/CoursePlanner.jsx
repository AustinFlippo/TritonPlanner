import React from "react";
import YearBlock from "./YearBlock";

const CoursePlanner = ({
  schedule,
  yearLabels,
  collapsedYears,
  toggleYearCollapse,
  calculateAnnualUnits,
  calculateTermUnits,
  handleDragOver,
  handleDrop,
  handleDragStart,
  handleDragEnd,
  handleRemoveCourse,
  previewState,
  getSlotClassName,
}) => {
  
  return (
    <div className="[&>*]:m-4">
      {schedule.map((year, yearIndex) => (
        <YearBlock
          year={year}
          yearIndex={yearIndex}
          yearLabel={yearLabels[yearIndex]}
          collapsed={collapsedYears[yearIndex]}
          toggleCollapse={toggleYearCollapse}
          calculateAnnualUnits={calculateAnnualUnits}
          calculateTermUnits={calculateTermUnits}
          handleDragOver={handleDragOver}
          handleDrop={handleDrop}
          handleDragStart={handleDragStart}
          handleDragEnd={handleDragEnd}
          handleRemoveCourse={handleRemoveCourse}
          previewState={previewState}
          getSlotClassName={getSlotClassName}
        />
      ))}
    </div>
  );
};

export default CoursePlanner;
