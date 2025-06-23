import React from "react";
import ProfessorInfo from "./ProfessorInfo";

const CourseDetails = ({ course, onBack }) => {
  if (!course) return null;

  // Extract clean description without prerequisites
  const getCleanDescription = (course) => {
    if (!course.description) return "No description available.";
    
    // The description field contains both description and prerequisites
    // We need to remove the prerequisites part that starts with "Prerequisites:"
    let description = course.description;
    
    // Find where "Prerequisites:" starts (case insensitive)
    const prereqIndex = description.toLowerCase().indexOf("prerequisites:");
    
    if (prereqIndex !== -1) {
      // Extract only the part before "Prerequisites:"
      description = description.substring(0, prereqIndex).trim();
    }
    
    // Remove any trailing periods or whitespace and clean up
    description = description.replace(/\.$/, '').trim();
    
    return description || "No description available.";
  };

  return (
    <div className="p-4 space-y-3">
      <button
        onClick={onBack}
        className="text-blue-600 hover:underline text-sm"
      >
        ← Back to search
      </button>

      <h1 className="text-2xl font-bold">{course.course_id}</h1>
      <h2 className="text-lg text-gray-700">{course.course_name}</h2>

      <div className="text-sm text-gray-700 space-y-1">
        <p><span className="font-semibold">Credits:</span> {course.credits}</p>
        <p><span className="font-semibold">Prerequisites:</span>{" "}
          {course.prerequisites && course.prerequisites.trim() !== ""
            ? course.prerequisites
            : "None"}
        </p>
        <p><span className="font-semibold">Offered:</span>{" "}
          {Array.isArray(course.offerings) && course.offerings.length > 0
            ? course.offerings.join(", ")
            : "Unknown"}
        </p>
        <p><span className="font-semibold">Description:</span> {getCleanDescription(course)}</p>
      </div>
      {course.professors && course.professors.length > 0 && (
        <div className="mt-4">
            <h3 className="font-semibold text-md mb-2">Professors:</h3>
            {course.professors.map((prof, idx) => (
            <ProfessorInfo key={idx} professor={prof} />
            ))}
        </div>
        )}
    </div>
  );
};

export default CourseDetails;
