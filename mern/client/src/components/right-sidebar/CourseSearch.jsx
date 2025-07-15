import React from "react";
import CourseItem from "./CourseItem";
import LoadingSpinner from "../LoadingSpinner";

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
  return (
    <div className="flex flex-col h-full">
      {/* Fixed header section */}
      <div className="p-4 flex-shrink-0">
        <div className="flex items-center mb-4">
          <h2 className="text-xl font-bold">Course Search</h2>
          <div className="relative ml-2 group">
            <div className="w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold cursor-help">
              ?
            </div>
            <div className="absolute left-1/2 transform -translate-x-1/2 top-full mt-2 w-64 bg-gray-800 text-white text-sm rounded-lg p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-[9999]">
              Search courses, drag them into the course planner, double click to view more information about the course.
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-800"></div>
            </div>
          </div>
        </div>
        <input
          type="text"
          placeholder="Search courses..."
          className="w-full p-2 border border-gray-300 rounded"
          value={searchTerm}
          onChange={(e) => {
            const newQuery = e.target.value;
            setSearchTerm(newQuery);
            debouncedSearch(newQuery); // 🔥 triggers search on every keystroke
          }}
        />
      </div>

      {/* Scrollable results section */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
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
