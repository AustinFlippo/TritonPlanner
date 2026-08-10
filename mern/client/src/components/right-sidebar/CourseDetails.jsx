import React, { useEffect, useState } from "react";
import ProfessorInfo from "./ProfessorInfo";
import { KeyRound, Maximize2, Minimize2 } from "lucide-react";

const CourseDetails = ({
  course,
  onBack,
  onSelectCourseId,
  apiUrl,
  expandState,
  onToggleExpand,
}) => {
  const [graph, setGraph] = useState(null);

  useEffect(() => {
    if (!course?.course_id || !apiUrl) return;
    let cancelled = false;
    setGraph(null);
    fetch(
      `${apiUrl}/search-courses/graph?course_id=${encodeURIComponent(course.course_id)}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setGraph(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [course?.course_id, apiUrl]);

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
    description = description.replace(/\.$/, "").trim();

    return description || "No description available.";
  };

  const hasParsedPrereqs = graph?.requires?.length > 0;

  return (
    <div className="h-full flex flex-col">
      {/* Panel header — mirrors the other sidebar panels so this view
          collapses to a clean h-11 bar when the assistant is maximized */}
      <div className="h-11 px-4 flex items-center gap-2 border-b border-slate-200 flex-shrink-0">
        <button
          onClick={onBack}
          className="text-navy-500 hover:text-navy-600 hover:underline text-sm font-medium flex-shrink-0"
          title="Back to search"
        >
          ←
        </button>
        <h2 className="panel-heading truncate flex-1">{course.course_id}</h2>
        {onToggleExpand && (
          <button
            type="button"
            className="p-1 rounded text-slate-400 hover:text-navy-600 hover:bg-slate-100 transition-colors flex-shrink-0"
            onClick={onToggleExpand}
            title={
              expandState === "expanded"
                ? "Restore side panel (Esc)"
                : "Expand course search"
            }
          >
            {expandState === "expanded" ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>

      <div className="p-4 space-y-3 flex-1 overflow-y-auto">
      <h1 className="text-xl font-semibold text-slate-900">{course.course_id}</h1>
      <h2 className="text-sm text-slate-600">{course.course_name}</h2>

      <div className="text-sm text-slate-600 space-y-1">
        <p><span className="font-semibold">Credits:</span> {course.credits}</p>
        <p><span className="font-semibold">Offered:</span>{" "}
          {Array.isArray(course.offerings) && course.offerings.length > 0
            ? course.offerings.join(", ")
            : "Unknown"}
        </p>
        {hasParsedPrereqs ? (
          <div>
            <span className="font-semibold">Prerequisites:</span>
            <ul className="mt-1 space-y-1">
              {graph.requires.map((group, idx) => (
                <li key={idx} className="text-[13px]">
                  {group.length > 1 && (
                    <span className="text-slate-400 mr-1">one of</span>
                  )}
                  {group.map((id, i) => (
                    <React.Fragment key={id}>
                      {i > 0 && <span className="text-slate-400"> / </span>}
                      <button
                        className="text-navy-500 hover:text-navy-600 hover:underline font-medium"
                        onClick={() => onSelectCourseId?.(id)}
                      >
                        {id}
                      </button>
                    </React.Fragment>
                  ))}
                </li>
              ))}
            </ul>
            {graph.confidence === "partial" && (
              <p className="text-[11px] text-slate-400 mt-1">
                May be satisfiable other ways — full text: {course.prerequisites}
              </p>
            )}
          </div>
        ) : (
          <p><span className="font-semibold">Prerequisites:</span>{" "}
            {course.prerequisites && course.prerequisites.trim() !== ""
              ? course.prerequisites
              : "None"}
          </p>
        )}
        <p><span className="font-semibold">Description:</span> {getCleanDescription(course)}</p>
      </div>

      {/* What this course is a prerequisite for */}
      {graph?.unlocks?.length > 0 && (
        <div className="pt-1">
          <h3 className="flex items-center gap-1.5 font-semibold text-sm text-slate-800 mb-1.5">
            <KeyRound className="w-3.5 h-3.5 text-navy-500" />
            Unlocks {graph.unlocks.length} course{graph.unlocks.length === 1 ? "" : "s"}
          </h3>
          <div className="flex flex-wrap gap-1">
            {graph.unlocks.map((u) => (
              <button
                key={u.course_id}
                className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 hover:bg-navy-100 hover:text-navy-700 transition-colors"
                onClick={() => onSelectCourseId?.(u.course_id)}
                title={u.course_name}
              >
                {u.course_id}
              </button>
            ))}
          </div>
        </div>
      )}

      {course.professors && course.professors.length > 0 && (
        <div className="mt-4">
            <h3 className="font-semibold text-md mb-2">Professors:</h3>
            {course.professors.map((prof, idx) => (
            <ProfessorInfo key={idx} professor={prof} />
            ))}
        </div>
        )}
      </div>
    </div>
  );
};

export default CourseDetails;
