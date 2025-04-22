import React, { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, CheckCircleIcon, AlertTriangle } from "lucide-react";

import completedData from "../jsons/completedCourses.json";
import requirementData from "../jsons/requiredCourses.json";

const CourseCard = ({ course, completed }) => {
  const icon = completed ? (
    <CheckCircleIcon size={14} className="text-green-600 mr-2" />
  ) : (
    <AlertTriangle size={14} className="text-red-600 mr-2" />
  );

  return (
    <div className={`flex items-center justify-between text-sm px-2 py-1 rounded ${completed ? "bg-green-100 text-green-900" : "bg-red-100 text-red-900"}`}>
      <div className="flex items-center">
        {icon}
        <span>{course.term ? `${course.term} – ` : ""}{course.course}</span>
      </div>
      <div>
        {course.units && `${course.units}u`}
        {course.grade && `, ${course.grade}`}
      </div>
    </div>
  );
};

const CourseGroup = ({ title, courses, completed }) => {
  if (!Array.isArray(courses) || courses.length === 0) return null;
  return (
    <div className="mt-3">
      <h3 className="text-sm font-semibold px-1 mb-1">{title}</h3>
      <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
        {courses.map((course, idx) => (
          <CourseCard key={`${course.course}-${course.term || idx}`} course={course} completed={completed} />
        ))}
      </div>
    </div>
  );
};

const RequirementGroup = ({ category }) => {
  return (
    <div className="mt-4">
      <h2 className="text-sm font-bold text-red-800 mb-2">{category.category}</h2>
      {category.subcategories.map((sub, idx) => (
        <div key={`${category.category}-${sub.name}-${idx}`} className="ml-2 mb-2">
          <h4 className="text-sm font-medium text-red-700">{sub.name}</h4>
          {sub.required_courses && (
            <ul className="list-disc list-inside text-red-900 text-sm">
              {sub.required_courses.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
          {sub.in_progress && (
            <p className="text-xs text-red-600 italic mt-1">In Progress: {sub.in_progress.join(", ")}</p>
          )}
          {sub.notes && typeof sub.notes === "object" && (
            <ul className="list-disc list-inside text-red-900 text-sm">
              {Object.entries(sub.notes).map(([k, v], i) => (
                <li key={i}>{k}: {v}</li>
              ))}
            </ul>
          )}
          {sub.notes && typeof sub.notes === "string" && (
            <p className="text-sm text-red-900">{sub.notes}</p>
          )}
        </div>
      ))}
    </div>
  );
};

const LeftSidebar = () => {
  const [showCompleted, setShowCompleted] = useState(true);
  const [showNeeded, setShowNeeded] = useState(false);

  const totalUnits = completedData.completed_courses.reduce((sum, c) => sum + (c.units || 0), 0);

  return (
    <div className="bg-white border-r h-full w-64 p-4 flex flex-col overflow-y-auto">
      <h2 className="text-lg font-bold mb-4 text-gray-800">Your Progress</h2>

      {/* Completed Section */}
      <button onClick={() => setShowCompleted(!showCompleted)} className="flex justify-between items-center text-sm font-semibold w-full mb-2">
        ✅ Completed Courses
        {showCompleted ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
      </button>
      {showCompleted && (
        <>
          <CourseGroup
            title="Completed"
            courses={completedData.completed_courses.filter(c => c.source === "ucsd")}
            completed
          />
          <CourseGroup
            title="AP / Transfer Credit"
            courses={completedData.completed_courses.filter(c => c.source !== "ucsd")}
            completed
          />
          <CourseGroup
            title="Current Courses"
            courses={completedData.current_courses}
            completed
          />
          <div className="mt-2 text-green-700 text-sm font-semibold px-1">Total Units: {totalUnits}</div>
        </>
      )}

      {/* Requirements Section */}
      <button onClick={() => setShowNeeded(!showNeeded)} className="flex justify-between items-center text-sm font-semibold w-full mt-6 mb-2">
        📌 Remaining Requirements
        {showNeeded ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
      </button>
      {showNeeded && (
        <div>
          {requirementData.requirements.map((group, idx) => (
            <RequirementGroup key={idx} category={group} />
          ))}
        </div>
      )}
    </div>
  );
};

export default LeftSidebar;
