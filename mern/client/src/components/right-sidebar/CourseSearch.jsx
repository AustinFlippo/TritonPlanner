// In /src/components/right-sidebar/CourseSearch.jsx

import React from "react";
import CourseItem from "./CourseItem";
import LoadingSpinner from "../LoadingSpinner";
import { shouldUseDndKit } from "../../utils/deviceDetection";

const CourseSearch = ({
  searchTerm,
  searchResults,
  setSearchTerm,
  handleDragStart,
  handleDragEnd,
  debouncedSearch,
  isCourseLoading,
  onCourseDoubleClick
}) => {
  const useDndKit = shouldUseDndKit();
  return (
    // The main container is already flex-col and h-full from ActionDrawer, which is correct.
    <div className="flex flex-col h-full">
      
      {/* Fixed header section - This part is correct and remains unchanged. */}
      <div className="p-4 flex-shrink-0">
        <div className="flex items-center mb-4">
          <h2 className="text-xl font-bold">Course Search</h2>
          {/* Tooltip '?' icon ... */}
        </div>
        <input
          type="text"
          placeholder="Search courses..."
          className="w-full p-2 border border-gray-300 rounded"
          value={searchTerm}
          onChange={(e) => {
            const newQuery = e.target.value;
            setSearchTerm(newQuery);
            debouncedSearch(newQuery);
          }}
        />
      </div>

      {/* 
        * RESULTS SECTION: Conditional scrolling based on device type
        * - Mobile (useDndKit): Remove scroll entirely, only drag functionality
        * - Desktop: Keep existing scroll behavior with styled scrollbar
      */}
      <div className={`flex-1 px-4 pb-4 ${
        useDndKit 
          ? 'overflow-hidden' // Mobile: no scroll, only drag
          : 'overflow-y-auto scrollbar-thin scrollbar-thumb-blue-500 scrollbar-track-gray-200 scrollbar-thumb-rounded-full' // Desktop: full scroll
      }`}>
        {isCourseLoading ? (
          <div className="flex justify-center py-4">
            <LoadingSpinner size="6" color="blue-500" />
          </div>
        ) : searchTerm.trim() === "" ? (
          <div className="text-gray-500 text-sm text-center py-4">Enter in a course!</div>
        ) : searchResults.length === 0 ? (
          <div className="text-gray-500 text-sm text-center py-4">No results found.</div>
        ) : (
          <div className="space-y-2">
            {searchResults.map((course) => (
              <CourseItem
                key={course.course_id}
                course={course}
                onDragStart={(e) => handleDragStart(e, course, true)}
                onDragEnd={handleDragEnd}
                onDoubleClick={onCourseDoubleClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CourseSearch;