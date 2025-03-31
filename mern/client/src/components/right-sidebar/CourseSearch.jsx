import React from "react";
import CourseItem from "./CourseItem";

const CourseSearch = ({
  searchTerm,
  searchResults,
  setSearchTerm,
  handleDragStart,
  handleDragEnd,
  debouncedSearch,
  isCourseLoading
}) => {
  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Course Search</h2>
      <input
        type="text"
        placeholder="Search courses..."
        className="w-full p-2 mb-4 border border-gray-300 rounded"
        value={searchTerm}
        onChange={(e) => {
          const newQuery = e.target.value;
          setSearchTerm(newQuery);
          debouncedSearch(newQuery); // 🔥 triggers search on every keystroke
        }}
      />
      {isCourseLoading ? (
        <div className="flex justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-500" />
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
          />
        ))}
      </div>
      )}
    </div>
  );
};

export default CourseSearch;
