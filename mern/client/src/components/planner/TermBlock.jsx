import React from "react";
import CourseCard from "./CourseCard";

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
  return (
    <div className="flex-1 p-2">
      {/* Term header with units */}
      <div className="bg-stone-100 p-2 mb-2 flex justify-between items-center rounded">
        <span className="font-semibold">{termName}</span>
        <div className="flex items-center">
          <span className="text-sm mr-2">term units</span>
          <span className="bg-blue-500 text-white rounded-full px-2 py-1 text-sm font-bold">
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
            <div className="border border-gray-300 rounded p-4 text-gray-400 text-center bg-gray-50">
              {invalidDrop &&
              dragTarget.yearIndex === yearIndex &&
              dragTarget.term === termKey &&
              dragTarget.courseIndex === courseIndex ? (
                <div className="text-red-600">
                  Course not offered in {termName}
                </div>
              ) : previewState &&
                previewState.targetYearIndex === yearIndex &&
                previewState.targetTerm === termKey &&
                previewState.targetCourseIndex === courseIndex ? (
                <div className="text-yellow-600">
                  {previewState.course.course_name} (Preview)
                </div>
              ) : (
                "Drop course here"
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default TermBlock;