import React from "react";
import ProfessorInfo from "./ProfessorInfo";

const CourseDetails = ({ course, onBack }) => {
  if (!course) return null;

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
          {Array.isArray(course.prerequisites) && course.prerequisites.length > 0
            ? course.prerequisites.join(", ")
            : "None"}
        </p>
        <p><span className="font-semibold">Offered:</span>{" "}
          {Array.isArray(course.offerings) && course.offerings.length > 0
            ? course.offerings.join(", ")
            : "Unknown"}
        </p>
        <p><span className="font-semibold">Description:</span> {course.description || "No description available."}</p>
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
