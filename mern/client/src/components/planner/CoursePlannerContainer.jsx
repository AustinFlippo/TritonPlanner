import { useEffect, useState } from "react";
import CoursePlanner from "./CoursePlanner";
import { processAuditForPlanner } from "../../utils/auditCoursePlanner";

const CoursePlannerContainer = ({
  parsedCourseData = { sections: [], metadata: {} },
  onCourseClick,
  schedule,
  setSchedule,
}) => {
  const [yearLabels] = useState([
    "2024-2025", "2025-2026", "2026-2027", "2027-2028",
  ]);
  const [collapsedYears, setCollapsedYears] = useState(Array(4).fill(false));
  const [previewState, setPreviewState] = useState(null);
  const [dragTarget, setDragTarget] = useState({ yearIndex: null, term: null, courseIndex: null });
  const [invalidDrop, setInvalidDrop] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!parsedCourseData.sections || parsedCourseData.sections.length === 0) return;
    const emptySchedule = Array(4).fill(null).map(() => ({
      fall: Array(3).fill(null),
      winter: Array(3).fill(null),
      spring: Array(3).fill(null),
    }));
    const updatedSchedule = processAuditForPlanner(parsedCourseData.sections, emptySchedule);
    setSchedule(updatedSchedule);
  }, [parsedCourseData, setSchedule]);

  const toggleYearCollapse = (yearIndex) => {
    const newState = [...collapsedYears];
    newState[yearIndex] = !newState[yearIndex];
    setCollapsedYears(newState);
  };

  const calculateTermUnits = (courses) =>
    courses.reduce((total, course) => total + (course ? course.credits : 0), 0);

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
    if (!targetYear || !targetYear[term]) return;
    const targetSlot = targetYear[term];
    const existingCourse = targetSlot[courseIndex];
    if (!isFromSidebar) {
      const sourceYearIndex = parseInt(e.dataTransfer.getData("sourceYearIndex"));
      const sourceTerm = e.dataTransfer.getData("sourceTerm");
      const sourceCourseIndex = parseInt(e.dataTransfer.getData("sourceCourseIndex"));
      if (sourceYearIndex === yearIndex && sourceTerm === term && sourceCourseIndex === courseIndex) return;
      if (existingCourse) {
        newSchedule[sourceYearIndex][sourceTerm][sourceCourseIndex] = existingCourse;
      } else {
        newSchedule[sourceYearIndex][sourceTerm][sourceCourseIndex] = null;
      }
    }
    targetSlot[courseIndex] = course;
    if (!targetSlot.some((c) => c === null)) targetSlot.push(null);
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
    termCourses[courseIndex] = null;
    const nullCount = termCourses.filter((c) => c === null).length;
    if (termCourses.length > 3 && nullCount > 1) {
      const trimmed = termCourses.filter((c) => c !== null);
      while (trimmed.length < 2) trimmed.push(null);
      trimmed.push(null);
      newSchedule[yearIndex][term] = trimmed;
    }
    setSchedule(newSchedule);
  };

  const getSlotClassName = (yearIndex, term, courseIndex) => {
    let className = "border rounded mb-2 p-2 ";
    if (
      dragTarget.yearIndex === yearIndex &&
      dragTarget.term === term &&
      dragTarget.courseIndex === courseIndex
    ) {
      className += invalidDrop
        ? "border-red-500 border-2 bg-red-50 "
        : "border-blue-500 border-2 bg-blue-50 ";
    }
    if (
      previewState &&
      previewState.targetYearIndex === yearIndex &&
      previewState.targetTerm === term &&
      previewState.targetCourseIndex === courseIndex
    ) {
      className += "border-yellow-400 border-2 bg-yellow-50 ";
    }
    return className;
  };

  const handleExportToSheets = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/export/google-sheets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule, yearLabels }),
      });
      const data = await response.json();
      if (data.success) {
        window.open(data.url, "_blank");
        alert("Schedule exported successfully! Opening Google Sheets...");
      } else {
        alert(`Export failed: ${data.error}`);
      }
    } catch {
      alert("Failed to export schedule. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
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
        onExportToSheets={handleExportToSheets}
        loading={loading}
        onCourseClick={onCourseClick}
      />
    </div>
  );
};

export default CoursePlannerContainer;
