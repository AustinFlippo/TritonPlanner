// In /src/components/right-sidebar/CourseItem.jsx

import React, { useState } from "react";
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { shouldUseDndKit } from '../../utils/deviceDetection';

const CourseItem = ({ course, onDragStart, onDragEnd, onDoubleClick }) => {
  const [isDragging, setIsDragging] = useState(false);
  const useDndKit = shouldUseDndKit();

  // Dnd Kit draggable hook (only for mobile)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging: dndIsDragging,
  } = useDraggable({
    id: course.course_id,
    data: {
      course: course,
      isFromSidebar: true
    },
    disabled: !useDndKit // Disable Dnd Kit for desktop
  });

  // Debug logging
  React.useEffect(() => {
    if (dndIsDragging) {
      console.log('Dnd Kit drag started for course:', course.course_id);
    }
  }, [dndIsDragging, course.course_id]);

  // Handle info button click
  const handleInfoClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Info button clicked for course:', course.course_id);
    if (onDoubleClick) {
      onDoubleClick(course);
    }
  };

  // Debug double-click (for desktop)
  const handleDoubleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Double-click detected on course:', course.course_id);
    if (onDoubleClick) {
      onDoubleClick(course);
    }
  };

  // HTML5 drag handlers (for desktop)
  const handleDragStart = (e) => {
    if (!useDndKit) {
      setIsDragging(true);
      console.log('HTML5 drag started for course:', course.course_id);
      onDragStart(e, course);
    }
  };

  const handleDragEnd = (e) => {
    if (!useDndKit) {
      setIsDragging(false);
      onDragEnd(e);
    }
  };

  // Style for transform during drag
  const style = useDndKit ? {
    transform: CSS.Translate.toString(transform),
    touchAction: 'none'
  } : {};

  // Determine drag state
  const isCurrentlyDragging = useDndKit ? dndIsDragging : isDragging;

  return (
    <div
      ref={useDndKit ? setNodeRef : undefined}
      className={`p-2 bg-gray-50 border rounded-lg transition-all duration-200 flex items-center space-x-2 cursor-move relative ${
        isCurrentlyDragging 
          ? 'border-blue-500 border-2 bg-blue-50 opacity-50 shadow-lg' // Reduce opacity when dragging
          : 'border-gray-200'
      }`}
      style={style}
      onDoubleClick={!useDndKit ? handleDoubleClick : undefined}
      // HTML5 drag props (desktop only)
      draggable={!useDndKit}
      onDragStart={!useDndKit ? handleDragStart : undefined}
      onDragEnd={!useDndKit ? handleDragEnd : undefined}
      // Dnd Kit props (mobile only)
      {...(useDndKit ? listeners : {})}
      {...(useDndKit ? attributes : {})}
    >
      {/* Mobile info button - positioned at top left of THIS card */}
      {useDndKit && (
        <button
          onClick={handleInfoClick}
          disabled={dndIsDragging}
          className={`absolute top-1 left-1 p-1 rounded-full transition-colors z-10 ${
            dndIsDragging 
              ? 'opacity-50 cursor-not-allowed' 
              : 'hover:bg-blue-100 bg-blue-50 border border-blue-200'
          }`}
          style={{ touchAction: 'manipulation' }}
          aria-label="View course details"
        >
          <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      )}
      
      {/* Course Info Container */}
      <div className="flex-grow pl-8">
        <div className="flex justify-between items-center">
          <span className="font-bold text-xs">{course.course_name}</span>
          <div className="flex items-center space-x-2">
            <span className="bg-gray-300 text-gray-700 rounded-full px-2 py-1 text-xs">
              {course.credits ? Number(course.credits).toFixed(1): "0.0"}
            </span>
          </div>
        </div>
        <div className="text-xs text-gray-600">
          <span className="text-xs">
            {course.course_id}
          </span>
          <span className="ml-2 text-amber-600 text-xs">
            Prereq:
            <span className="text-gray-600 ml-1 text-xs">
              {Array.isArray(course.prerequisites)
                ? course.prerequisites.length > 0
                  ? course.prerequisites.join(", ")
                  : "None"
                : typeof course.prerequisites === 'string'
                  ? course.prerequisites
                  : "None"}
            </span>
          </span>
          <span className="ml-2 text-green-600 text-xs">
            Offered:
            <span className="text-gray-600 ml-1 text-xs">
            {course.offerings.includes("FA") && (
              <span className="ml-1 mr-1">F</span>
            )}
            {course.offerings.includes("WI") && <span className="mr-1">W</span>}
            {course.offerings.includes("SP") && <span>S</span>}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
};

export default CourseItem;