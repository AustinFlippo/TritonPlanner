import React from "react";

const CourseCard = ({
  course,
  onRemove,
  onDragStart,
  onDragEnd,
  isPreviewing = false,
}) => {
  if (!course) return null;

  return (
    <div
      className="flex justify-between items-center cursor-move"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <span>
        {course.course_id}
        {isPreviewing && (
          <span className="ml-2 text-yellow-600 text-xs">(Moving)</span>
        )}
      </span>
      <div className="flex items-center">
        <span className="bg-gray-300 text-gray-700 rounded-full px-2 py-1 text-xs mr-2">
          {course.credits.toFixed(1)}
        </span>
        <button
          onClick={onRemove}
          className="text-red-500 hover:text-red-700 text-xs"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default CourseCard;
