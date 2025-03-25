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

  const [collapsedYears, setCollapsedYears] = useState(Array(4).fill(false));
  const [previewState, setPreviewState] = useState(null);
  const [dragTarget, setDragTarget] = useState({
    yearIndex: null,
    term: null,
    courseIndex: null,
  });
  const [invalidDrop, setInvalidDrop] = useState(false);

  const toggleYearCollapse = (yearIndex) => {
    console.log("yoooo");
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

  const handleDragStart = (e, course, isFromSidebar = false, yearIndex = null, term = null, courseIndex = null) => {
    e.dataTransfer.setData("course", JSON.stringify(course));
    e.dataTransfer.setData("isFromSidebar", isFromSidebar.toString());
  
    if (!isFromSidebar) {
      e.dataTransfer.setData("sourceYearIndex", yearIndex.toString());
      e.dataTransfer.setData("sourceTerm", term);
      e.dataTransfer.setData("sourceCourseIndex", courseIndex.toString());
    }
  };
  

  const handleDragOver = (e, yearIndex, term, courseIndex) => {
    e.preventDefault();
    setDragTarget({ yearIndex, term, courseIndex });
  };

  const handleDrop = (e, yearIndex, term, courseIndex) => {
    e.preventDefault();
  
    const courseData = e.dataTransfer.getData("course");
    const isFromSidebar = e.dataTransfer.getData("isFromSidebar") === "true";
  
    if (!courseData) return;
  
    const course = JSON.parse(courseData);
    const newSchedule = [...schedule];
    const targetYear = newSchedule[yearIndex];
    if (!targetYear || !targetYear[term]) return; // ✅ defensive check
  
    const targetSlot = targetYear[term];
    const existingCourse = targetSlot[courseIndex];
  
    if (!isFromSidebar) {
      
      const sourceYearIndex = parseInt(e.dataTransfer.getData("sourceYearIndex"));
      const sourceTerm = e.dataTransfer.getData("sourceTerm");
      const sourceCourseIndex = parseInt(e.dataTransfer.getData("sourceCourseIndex"));
      console.log("Swap attempt:", {
        sourceYearIndex,
        sourceTerm,
        sourceCourseIndex,
        targetYearIndex: yearIndex,
        targetTerm: term,
        targetCourseIndex: courseIndex,
      });
      
      if (
        sourceYearIndex === yearIndex &&
        sourceTerm === term &&
        sourceCourseIndex === courseIndex
      ) return;
  
      const sourceCourse = newSchedule[sourceYearIndex]?.[sourceTerm]?.[sourceCourseIndex];
  
      // Swap or clear source
      if (existingCourse) {
        newSchedule[sourceYearIndex][sourceTerm][sourceCourseIndex] = existingCourse;
      } else {
        newSchedule[sourceYearIndex][sourceTerm][sourceCourseIndex] = null;
      }
    }
    
    {/* Ensure one empty slot remains */}
    targetSlot[courseIndex] = course;
  
    if (!targetSlot.some((c) => c === null)) {
      targetSlot.push(null);
    }
  
    setSchedule(newSchedule);
    setPreviewState(null);
  };
  
  const handleDragEnd = () => {
    setPreviewState(null);
    setInvalidDrop(false);
    setDragTarget({ yearIndex: null, term: null, courseIndex: null });
  };

  const handleRemoveCourse = (yearIndex, term, courseIndex) => {
    const newSchedule = [...schedule];
    const termCourses = newSchedule[yearIndex][term];
  
    // Remove the course
    termCourses[courseIndex] = null;
  
    // Count nulls
    const nullCount = termCourses.filter((c) => c === null).length;
  
    // Trim excess nulls if more than 1 null and total > 3 slots
    if (termCourses.length > 3 && nullCount > 1) {
      const trimmed = termCourses.filter((c) => c !== null); // keep non-null courses
  
      // Ensure 3 slots minimum + 1 empty
      while (trimmed.length < 2) trimmed.push(null);
      trimmed.push(null); // one empty slot
  
      newSchedule[yearIndex][term] = trimmed;
    }
  
    setSchedule(newSchedule);
  };
  
  const getSlotClassName = (yearIndex, term, courseIndex) => {
    let className = "border rounded p-2 mb-2 transition-colors ";
  
    if (
      dragTarget.yearIndex === yearIndex &&
      dragTarget.term === term &&
      dragTarget.courseIndex === courseIndex
    ) {
      className += invalidDrop
        ? "border-red-500 bg-red-100"
        : "border-blue-500 bg-blue-50";
    }
  
    return className;
  };
  

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
      dragTarget={dragTarget}
      invalidDrop={invalidDrop}
      getSlotClassName={getSlotClassName}
    />
  );
};

export default CoursePlannerContainer;
