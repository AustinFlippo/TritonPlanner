import React from "react";

const CourseItem = ({ course, onDragStart, onDragEnd, onDoubleClick }) => {
  return (
    <div
      className="p-2 bg-gray-50 border border-gray-200 rounded-lg cursor-move hover:bg-gray-100"
      draggable
      onDragStart={(e) => onDragStart(e, course)}
      onDragEnd={onDragEnd}
      onDoubleClick={() => onDoubleClick?.(course)}
    >
      <div className="flex justify-between items-center">
        <span className="font-bold text-sm">{course.course_name}</span>
        <span className="bg-gray-300 text-gray-700 rounded-full px-2 py-1 text-xs">
          {course.credits ? Number(course.credits).toFixed(1): "0.0"}
        </span>
      </div>
      <div className="text-xs text-gray-600">
        <span>
          {course.course_id}
        </span>
        <span className="ml-2 text-amber-600">
          Prereq:
          <span className="text-gray-600 ml-1">
            {Array.isArray(course.prerequisites)
  ? course.prerequisites.length > 0
    ? course.prerequisites.join(", ")
    : "None"
  : typeof course.prerequisites === "string"
    ? course.prerequisites
    : "None"}
          </span>
        </span>
        <span className="ml-2 text-green-600">
          Offered:
          <span className="text-gray-600 ml-1">
          {course.offerings.includes("FA") && (
            <span className="ml-1 mr-1">F</span>
          )}
          {course.offerings.includes("WI") && <span className="mr-1">W</span>}
          {course.offerings.includes("SP") && <span>S</span>}
          </span>
        </span>
      </div>
    </div>
  );
};

export default CourseItem;
