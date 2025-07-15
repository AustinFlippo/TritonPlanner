import React from "react";
import { useDroppable } from '@dnd-kit/core';
import CourseCard from "./CourseCard";
import { shouldUseDndKit } from "../../utils/deviceDetection";

// Component for empty course slots with mobile drop zone functionality
const EmptySlot = ({ useDndKit, yearIndex, termKey, courseIndex, termName, invalidDrop, dragTarget, previewState }) => {
  // Create unique drop zone ID for each course slot
  const dropZoneId = `course-slot-${yearIndex}-${termKey}-${courseIndex}`;
  
  // Mobile droppable zone
  const { isOver, setNodeRef } = useDroppable({
    id: dropZoneId,
    data: {
      yearIndex,
      termKey,
      courseIndex,
      termName
    },
    disabled: !useDndKit // Only enable for mobile devices
  });

  return (
    <div 
      ref={useDndKit ? setNodeRef : undefined}
      className={`border border-gray-300 rounded-lg p-4 md:p-4 text-gray-400 text-center bg-gray-50 min-h-[60px] flex items-center justify-center transition-all duration-200 ${
        useDndKit && isOver ? 'border-blue-500 border-2 bg-blue-50' : ''
      }`}
    >
      {invalidDrop &&
      dragTarget.yearIndex === yearIndex &&
      dragTarget.term === termKey &&
      dragTarget.courseIndex === courseIndex ? (
        <div className="text-red-600 text-sm">
          Course not offered in {termName}
        </div>
      ) : previewState &&
        previewState.targetYearIndex === yearIndex &&
        previewState.targetTerm === termKey &&
        previewState.targetCourseIndex === courseIndex ? (
        <div className="text-yellow-600 text-sm">
          {previewState.course.course_name} (Preview)
        </div>
      ) : (
        <span className="text-sm">Drop course here</span>
      )}
    </div>
  );
};

const TermBlock = ({
  termName,
  termKey,
  courses,
  yearIndex,
  calculateTermUnits,
  handleDragOver,
  handleDrop,
  handleDragStart,
  handleDragEnd,
  handleRemoveCourse,
  getSlotClassName,
  previewState,
  dragTarget,
  invalidDrop,
}) => {
  const useDndKit = shouldUseDndKit();
  return (
    <div className="flex-1 p-2 md:p-2">
      {/* Term header with units */}
      <div className="bg-stone-100 p-3 mb-3 flex justify-between items-center rounded-lg">
        <span className="font-semibold text-sm md:text-base">{termName}</span>
        <div className="flex items-center">
          <span className="text-xs md:text-sm mr-2">term units</span>
          <span className="bg-blue-500 text-white rounded-full px-2 py-1 text-xs md:text-sm font-bold">
            {calculateTermUnits(courses).toFixed(1)}
          </span>
        </div>
      </div>

      {/* Course slots */}
      {courses.map((course, courseIndex) => (
        <div
          key={courseIndex}
          className={`mb-2 ${getSlotClassName(yearIndex, termKey, courseIndex)}`}
          onDragOver={(e) => handleDragOver(e, yearIndex, termKey, courseIndex)}
          onDrop={(e) => handleDrop(e, yearIndex, termKey, courseIndex)}
        >
          {course ? (
            <CourseCard
              course={course}
              isPreviewing={
                previewState &&
                previewState.sourceYearIndex === yearIndex &&
                previewState.sourceTerm === termKey &&
                previewState.sourceCourseIndex === courseIndex
              }
              onDragStart={(e) =>
                handleDragStart(e, course, false, yearIndex, termKey, courseIndex)
              }
              onDragEnd={handleDragEnd}
              onRemove={() => handleRemoveCourse(yearIndex, termKey, courseIndex)}
            />
          ) : (
            <EmptySlot
              useDndKit={useDndKit}
              yearIndex={yearIndex}
              termKey={termKey}
              courseIndex={courseIndex}
              termName={termName}
              invalidDrop={invalidDrop}
              dragTarget={dragTarget}
              previewState={previewState}
            />
          )}
        </div>
      ))}
    </div>
  );
};

export default TermBlock;