import React, { useState, useEffect, useRef } from "react";

const CourseSearch = ({ allCourses, handleDragStart, handleDragEnd, chatHeight }) => {

    const [searchTerm, setSearchTerm] = useState("");
    const [filteredCourses, setFilteredCourses] = useState(allCourses);

      // Update filtered courses when search term changes
      useEffect(() => {
        const filtered = allCourses.filter(
          (course) =>
            course.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            course.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
            course.department.toLowerCase().includes(searchTerm.toLowerCase())
        );
        setFilteredCourses(filtered);
      }, [searchTerm, allCourses]);

    
    return (
        //<div className="w-full md:w-1/4 p-4 bg-white rounded-lg shadow" style={{ height: `calc(100vh - ${chatHeight}px)` }}>
            <div className="flex flex-col h-full">
            <h2 className="text-xl font-bold mb-4">Course Search</h2>
            <input
                type="text"
                placeholder="Search courses..."
                className="w-full p-2 mb-4 border border-gray-300 rounded"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />

            {/* Scrollable list */}
            <div
                className="overflow-y-auto space-y-2"
                style={{ maxHeight: `calc(100vh - ${chatHeight}px - 207px)` }}
            >
                {filteredCourses.map((course) => (
                <div
                    key={course.id}
                    className="p-2 bg-gray-50 border border-gray-200 rounded-lg cursor-move hover:bg-gray-100"
                    draggable
                    onDragStart={(e) => handleDragStart(e, course, true)}
                    onDragEnd={handleDragEnd}
                >
                    <div className="flex justify-between items-center">
                    <span className="font-bold text-sm">{course.name}</span>
                    <span className="bg-gray-300 text-gray-700 rounded-full px-2 py-1 text-xs">
                        {course.units.toFixed(1)}
                    </span>
                    </div>
                    <div className="text-xs text-gray-600">
                    <span>
                        {course.id} • {course.department}
                    </span>
                    <span className="ml-2 text-amber-600">
                        Prereq:
                        <span className="text-gray-600 ml-1">
                        {course.prerequisites && course.prerequisites.length > 0
                            ? course.prerequisites.join(", ")
                            : "None"}
                        </span>
                    </span>
                    <span className="ml-2 text-green-600">
                        Offered:
                        {course.offeredIn.includes("fall") && (
                        <span className="ml-1 mr-1">F</span>
                        )}
                        {course.offeredIn.includes("winter") && (
                        <span className="mr-1">W</span>
                        )}
                        {course.offeredIn.includes("spring") && <span>S</span>}
                    </span>
                    </div>
                </div>
                ))}
            </div>
            </div>
        //</div>
    );
}

export default CourseSearch;