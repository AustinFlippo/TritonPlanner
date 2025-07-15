import { useState, useEffect } from "react";
import { useDroppable } from '@dnd-kit/core';
import CoursePlanner from "./CoursePlanner";
import { processAuditForPlanner } from "../../utils/auditCoursePlanner";
import { EXPRESS_URL, exportScheduleAsPdf } from "../../config.js";
import { shouldUseDndKit } from "../../utils/deviceDetection";

const CoursePlannerContainer = ({ parsedCourseData = { sections: [], metadata: {} } }) => {
  const useDndKit = shouldUseDndKit();
  
  // Droppable zone for mobile drag and drop (only enabled for mobile)
  const { isOver, setNodeRef } = useDroppable({
    id: 'planner-drop-zone',
    disabled: !useDndKit // Only enable for mobile devices
  });

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
  const [loading, setLoading] = useState(false);

  // Effect to populate courses from audit data
  useEffect(() => {
    if (!parsedCourseData.sections || parsedCourseData.sections.length === 0) {
      return; // No audit data to process
    }

    
    // Create fresh schedule
    const emptySchedule = Array(4).fill().map(() => ({
      fall: Array(3).fill(null),
      winter: Array(3).fill(null),
      spring: Array(3).fill(null),
    }));

    // Process audit sections and populate schedule
    const updatedSchedule = processAuditForPlanner(parsedCourseData.sections, emptySchedule);
    setSchedule(updatedSchedule);
  }, [parsedCourseData]);

  // Effect to handle course addition from mobile ActionDrawer (only for mobile devices)
  useEffect(() => {
    if (!useDndKit) return; // Only listen for mobile devices
    
    const handleAddCourse = (event) => {
      // console.log('CoursePlannerContainer received addCourseToPlanner event:', event.detail);
      const { course, isFromSidebar } = event.detail;
      
      if (isFromSidebar && course) {
        // console.log('Adding course to schedule:', course);
        // Add course to the first available slot in the first year, fall term
        const newSchedule = [...schedule];
        const firstYear = newSchedule[0];
        const fallTerm = firstYear.fall;
        
        // Find the first empty slot
        const emptySlotIndex = fallTerm.findIndex(slot => slot === null);
        
        if (emptySlotIndex !== -1) {
          // Add course to the empty slot
          fallTerm[emptySlotIndex] = course;
          
          // Ensure there's always an empty slot at the end
          if (!fallTerm.some(slot => slot === null)) {
            fallTerm.push(null);
          }
          
          setSchedule(newSchedule);
        } else {
          // No empty slots, add to the end
          fallTerm.push(course);
          fallTerm.push(null); // Add empty slot
          setSchedule(newSchedule);
        }
      }
    };

    // Listen for the custom event
    document.addEventListener('addCourseToPlanner', handleAddCourse);
    
    // Cleanup listener on unmount
    return () => {
      document.removeEventListener('addCourseToPlanner', handleAddCourse);
    };
  }, [schedule, useDndKit]);

  const toggleYearCollapse = (yearIndex) => {
    const newState = [...collapsedYears];
    newState[yearIndex] = !newState[yearIndex];
    setCollapsedYears(newState);
  };

  const calculateTermUnits = (courses) => {
    return courses.reduce((total, course) => total + (course ? course.credits : 0), 0);
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
      
      if (
        sourceYearIndex === yearIndex &&
        sourceTerm === term &&
        sourceCourseIndex === courseIndex
      ) return;
  
      // const sourceCourse = newSchedule[sourceYearIndex]?.[sourceTerm]?.[sourceCourseIndex];
  
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
    let className = "border rounded mb-2 p-2 ";

    // Check if this is the current drag target
    if (
      dragTarget.yearIndex === yearIndex &&
      dragTarget.term === term &&
      dragTarget.courseIndex === courseIndex
    ) {
      // If invalid drop, show red highlight
      if (invalidDrop) {
        className += "border-red-500 border-2 bg-red-50 ";
      } else {
        className += "border-blue-500 border-2 bg-blue-50 ";
      }
    }

    // Check if this is the destination in a preview
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
      
      // Get student name from parsed course data
      const studentName = parsedCourseData?.metadata?.studentName || 'Student';
      
      const response = await fetch(`${EXPRESS_URL}/api/export/google-sheets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          schedule,
          yearLabels,
          studentName,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Open the Google Sheets URL in a new tab
        window.open(data.url, '_blank');
        alert('Schedule exported successfully! Opening Google Sheets...');
      } else {
        console.error('Export failed:', data.error);
        alert(`Export failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export schedule. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleExportToPdf = async () => {
    try {
      setLoading(true);
      
      // Get student name from parsed course data
      const studentName = parsedCourseData?.metadata?.studentName || 'Student';
      
      // Transform schedule data to match PDF backend expectations
      const transformedSchedule = yearLabels.map((yearLabel, yearIndex) => {
        const yearData = schedule[yearIndex];
        return {
          year: yearLabel,
          terms: [
            {
              term: `Fall ${yearLabel.split('-')[0]}`,
              courses: yearData.fall
                .filter(course => course !== null)
                .map(course => ({
                  id: course.course_id || course.code || '',
                  name: course.course_name || course.name || course.title || ''
                }))
            },
            {
              term: `Winter ${yearLabel.split('-')[0]}`,
              courses: yearData.winter
                .filter(course => course !== null)
                .map(course => ({
                  id: course.course_id || course.code || '',
                  name: course.course_name || course.name || course.title || ''
                }))
            },
            {
              term: `Spring ${yearLabel.split('-')[1]}`,
              courses: yearData.spring
                .filter(course => course !== null)
                .map(course => ({
                  id: course.course_id || course.code || '',
                  name: course.course_name || course.name || course.title || ''
                }))
            }
          ]
        };
      });

      const scheduleData = {
        studentName,
        schedule: transformedSchedule,
      };

      // Call the PDF export API
      const pdfBlob = await exportScheduleAsPdf(scheduleData);

      // Create a temporary URL for the blob
      const url = window.URL.createObjectURL(pdfBlob);

      // Create a temporary link element to trigger the download
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'academic-schedule.pdf');
      document.body.appendChild(link);
      
      // Programmatically click the link and clean up
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);

      alert('Schedule exported successfully as PDF!');
    } catch (error) {
      console.error('PDF export error:', error);
      alert('Failed to export PDF. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={useDndKit ? setNodeRef : undefined}
      className={`${useDndKit && isOver ? 'bg-blue-50 border-2 border-blue-500 border-dashed transition-all duration-200' : ''}`}
      style={useDndKit && isOver ? { zIndex: 1 } : {}}
    >
      {/* Button for saving
      <div className="flex justify-end p-3">
        <button className="bg-blue-500 text-white">Save</button>
      </div>
      */}

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
        onExportToPdf={handleExportToPdf}
        loading={loading}
      />
    </div>
  );
};

export default CoursePlannerContainer;
