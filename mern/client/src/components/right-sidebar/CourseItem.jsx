import React from "react";
import { GripVertical } from "lucide-react";

// Which terms a course is offered in, rendered as compact chips
const TERM_CHIPS = [
  { code: "FA", label: "F" },
  { code: "WI", label: "W" },
  { code: "SP", label: "S" },
];

// prereqsMet (optional): true = prereqs satisfied by plan, false = missing,
// null/undefined = unknown or not applicable — no badge shown
const CourseItem = ({ course, onDragStart, onDragEnd, onDoubleClick, prereqsMet }) => {
  const prereqs = Array.isArray(course.prerequisites)
    ? course.prerequisites.length > 0
      ? course.prerequisites.join(", ")
      : "None"
    : typeof course.prerequisites === "string" && course.prerequisites.trim() !== ""
      ? course.prerequisites
      : "None";

  return (
    <div
      className="group px-2.5 py-2 bg-white border border-slate-200 rounded-lg cursor-grab active:cursor-grabbing shadow-card hover:border-navy-300 hover:shadow-panel transition-all"
      draggable
      onDragStart={(e) => onDragStart(e, course)}
      onDragEnd={onDragEnd}
      onDoubleClick={() => onDoubleClick?.(course)}
      title="Drag into your plan · double-click for details"
    >
      <div className="flex items-center gap-1.5">
        <GripVertical className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-400 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex justify-between items-baseline gap-2">
            <span className="text-[13px] font-semibold text-slate-800 truncate">
              {course.course_id}
            </span>
            <span className="flex items-center gap-1 flex-shrink-0">
              {prereqsMet === true && (
                <span
                  className="px-1.5 py-px rounded-full text-[9px] font-semibold bg-emerald-50 text-emerald-600"
                  title="Prerequisites satisfied by your plan"
                >
                  Ready
                </span>
              )}
              {prereqsMet === false && (
                <span
                  className="px-1.5 py-px rounded-full text-[9px] font-semibold bg-amber-50 text-amber-600"
                  title="Missing prerequisites — check the course details"
                >
                  Prereqs
                </span>
              )}
              <span className="text-[11px] tabular-nums text-slate-500">
                {course.credits ? Number(course.credits).toFixed(1) : "0.0"} u
              </span>
            </span>
          </div>
          <div className="text-xs text-slate-500 truncate">
            {course.course_name}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="flex items-center gap-0.5">
              {TERM_CHIPS.map(({ code, label }) => {
                const offered = course.offerings?.includes(code);
                return (
                  <span
                    key={code}
                    className={`w-4 h-4 flex items-center justify-center rounded text-[10px] font-semibold ${
                      offered
                        ? "bg-navy-100 text-navy-600"
                        : "bg-slate-50 text-slate-300"
                    }`}
                    title={offered ? `Offered ${label}` : `Not offered ${label}`}
                  >
                    {label}
                  </span>
                );
              })}
            </span>
            <span className="text-[11px] text-slate-400 truncate">
              Prereq: {prereqs}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CourseItem;
