// Course card component for displaying individual courses in the planner
import { X, TriangleAlert } from "lucide-react";

const CourseCard = ({
  course,
  onRemove,
  onDragStart,
  onDragEnd,
  isPreviewing = false,
  warning = null,
}) => {
  if (!course) return null;

  // Status maps to a left accent + small label, keeping the card itself white
  const getStatusStyling = (status) => {
    switch (status) {
      case 'completed':
        return { accent: 'border-l-emerald-500', label: 'Completed', labelStyle: 'text-emerald-600' };
      case 'current':
        return { accent: 'border-l-amber-500', label: 'In progress', labelStyle: 'text-amber-600' };
      case 'planned':
        return { accent: 'border-l-navy-500', label: 'Planned', labelStyle: 'text-navy-500' };
      default:
        return { accent: 'border-l-slate-300', label: null, labelStyle: '' };
    }
  };

  const styling = getStatusStyling(course.status);

  return (
    <div
      className={`group flex justify-between items-center gap-2 cursor-grab active:cursor-grabbing px-3 py-2 rounded-lg bg-white border border-slate-200 border-l-[3px] ${styling.accent} shadow-card hover:shadow-panel hover:border-slate-300 transition-all ${
        isPreviewing ? 'opacity-50' : ''
      }`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-slate-800 truncate">
          {course.course_id}
          {isPreviewing && (
            <span className="ml-2 text-gold-600 text-xs font-normal">(moving)</span>
          )}
        </div>
        <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
          {styling.label && (
            <span className={`font-medium ${styling.labelStyle}`}>
              {styling.label}
            </span>
          )}
          {course.grade && course.status === 'completed' && (
            <span>· {course.grade}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {warning && (
          <span
            title={`${warning.message} Based on past schedules — not a guarantee.`}
            className="cursor-help"
            aria-label={warning.message}
          >
            <TriangleAlert className="w-3.5 h-3.5 text-amber-500" />
          </span>
        )}
        <span className="text-xs tabular-nums text-slate-500">
          {course.credits.toFixed(1)} u
        </span>
        <button
          onClick={onRemove}
          className="p-0.5 rounded text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-red-400"
          title="Remove course"
          aria-label={`Remove ${course.course_id}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default CourseCard;
