import React, { useState } from "react";
import CoursePlanner from "./CoursePlanner";

const CoursePlannerContainer = () => {
  const [schedule, setSchedule] = useState(
    Array(4).fill().map(() => ({
      fall: Array(3).fill(null),
      winter: Array(3).fill(null),
      spring: Array(3).fill(null),
    }))
  );

  const [yearLabels] = useState([
    "2024-2025",
    "2025-2026",
    "2026-2027",
    "2027-2028",
  ]);

  const [collapsedYears, setCollapsedYears] = useState(
    Array(4).fill(false)
  );

  const [previewState, setPreviewState] = useState(null);

  const toggleYearCollapse = (yearIndex) => {
    const newState = [...collapsedYears];
    newState[yearIndex] = !newState[yearIndex];
    setCollapsedYears(newState);
  };

  const calculateTermUnits = (courses) => {
    return courses.reduce((total, course) => total + (course ? course.units : 0), 0);
  };

  const calculateAnnualUnits = (yearIndex) => {
    const year = schedule[yearIndex];
    return (
      calculateTermUnits(year.fall) +
      calculateTermUnits(year.winter) +
      calculateTermUnits(year.spring)
    );
  };

  const handleDragStart = () => {};
  const handleDragEnd = () => {};
  const handleDragOver = () => {};
  const handleDrop = () => {};
  const handleRemoveCourse = () => {};

  const getSlotClassName = () => "border rounded p-2 mb-2";

  return (
    <CoursePlanner
      schedule={schedule}
      yearLabels={yearLabels}
      collapsedYears={collapsedYears}
      toggleYearCollapse={toggleYearCollapse}
      calculateAnnualUnits={calculateAnnualUnits}
      calculateTermUnits={calculateTermUnits}
      handleDragStart={handleDragStart}
      handleDragEnd={handleDragEnd}
      handleDragOver={handleDragOver}
      handleDrop={handleDrop}
      handleRemoveCourse={handleRemoveCourse}
      previewState={previewState}
      getSlotClassName={getSlotClassName}
    />
  );
};

export default CoursePlannerContainer;
