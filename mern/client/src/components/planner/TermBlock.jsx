import React from "react";
import CourseCard from "./CourseCard";

const TermBlock = ({
  termName, termKey, courses, yearIndex,
  calculateTermUnits, handleDragOver, handleDrop,
  handleDragStart, handleDragEnd, handleRemoveCourse,
  getSlotClassName, previewState, dragTarget, invalidDrop,
  onCourseClick,
}) => {
  return (
    <div className="flex-1" style={{ padding: '8px' }}>
      <div className="flex justify-between items-center" style={{ marginBottom: '8px' }}>
        <span style={{ fontSize: '7px', fontWeight: 700, letterSpacing: '0.5px', color: '#003366', textTransform: 'uppercase', opacity: 0.6 }}>
          {termName}
        </span>
        <span style={{ background: '#e0f0ff', color: '#0066cc', borderRadius: '999px', padding: '1px 7px', fontSize: '10px', fontWeight: 600 }}>
          {calculateTermUnits(courses).toFixed(1)}u
        </span>
      </div>

      {courses.map((course, courseIndex) => (
        <div
          key={courseIndex}
          className={`mb-2 ${getSlotClassName(yearIndex, termKey, courseIndex)}`}
          onDragOver={(e) => handleDragOver(e, yearIndex, termKey, courseIndex)}
          onDrop={(e) => handleDrop(e, yearIndex, termKey, courseIndex)}
          style={{ marginBottom: '5px' }}
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
              onDragStart={(e) => handleDragStart(e, course, false, yearIndex, termKey, courseIndex)}
              onDragEnd={handleDragEnd}
              onRemove={() => handleRemoveCourse(yearIndex, termKey, courseIndex)}
              onCourseClick={onCourseClick}
            />
          ) : (
            <div style={{
              border: '1px dashed #cbd5e1',
              borderRadius: '6px',
              padding: '10px 8px',
              textAlign: 'center',
              background: '#f1f5f9',
              fontSize: '10px',
              color: '#94a3b8',
            }}>
              {invalidDrop && dragTarget.yearIndex === yearIndex && dragTarget.term === termKey && dragTarget.courseIndex === courseIndex ? (
                <span style={{ color: '#dc2626' }}>Not offered in {termName}</span>
              ) : previewState && previewState.targetYearIndex === yearIndex && previewState.targetTerm === termKey && previewState.targetCourseIndex === courseIndex ? (
                <span style={{ color: '#ca8a04' }}>{previewState.course.course_name} (Preview)</span>
              ) : (
                'drag here'
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default TermBlock;
