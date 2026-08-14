// Course card component for displaying individual courses in the planner
import { X, TriangleAlert } from "lucide-react";
import { useNextQuarterOfferings } from "../../context/NextQuarterOfferingsContext";
import { parseCredits, hasUnknownCredits } from "../../utils/courseCredits";
import { SHOW_GRADES } from "../../utils/courseGrades";

const CourseCard = ({
  course,
  onRemove,
  onDragStart,
  onDragEnd,
  onOpen,
  isPreviewing = false,
  warning = null,
  prereqWarning = null,
}) => {
  const { offeredNextChip, enrollmentQuarter, seatChipFor } =
    useNextQuarterOfferings();
  if (!course) return null;

  // Status maps to a left accent + small label, keeping the card itself white
  const getStatusStyling = (status) => {
    switch (status) {
      case 'completed':
        return { accent: 'border-l-emerald-500', label: 'Completed', labelStyle: 'text-emerald-600' };
      case 'current':
        return { accent: 'border-l-amber-500', label: 'In progress', labelStyle: 'text-amber-600' };
      case 'failed':
        // F / W / NP / I on the audit. Called out rather than hidden: this is
        // a requirement the student still owes, and it used to render as
        // "Completed".
        return { accent: 'border-l-red-500', label: 'Not passed', labelStyle: 'text-red-600' };
      case 'planned':
      default:
        // Catalog drops often omit status; treat them as planned so they match
        // audit-planned cards (navy accent + Planned label).
        return { accent: 'border-l-navy-500', label: 'Planned', labelStyle: 'text-navy-500' };
    }
  };

  const styling = getStatusStyling(course.status || 'planned');
  const nextChip = offeredNextChip(course.course_id);
  const seatChip = seatChipFor(course.course_id);
  // A course with no usable unit count — either flagged unverified by the
  // planner agent, or carrying credits the catalog never supplied. Reading it
  // straight through .toFixed() used to throw, so this also keeps a null from
  // taking the whole planner grid down.
  const unverified = course.unverified === true || hasUnknownCredits(course);
  const credits = parseCredits(course.credits);

  return (
    <div
      className={`group flex justify-between items-center gap-2 cursor-grab active:cursor-grabbing px-3 py-2 rounded-lg bg-white border border-slate-200 border-l-[3px] ${styling.accent} shadow-card hover:shadow-panel hover:border-slate-300 transition-all ${
        isPreviewing ? 'opacity-50' : ''
      }`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpen?.(course)}
      title="Drag to move · click for details"
    >
      {/* The course code is the card's whole identity — "MATH 2…" makes MATH
          20A and MATH 20B indistinguishable, which is worse than any other
          field wrapping. It never truncates; units/grade give way instead. */}
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-slate-800 break-words">
          {course.course_id}
          {isPreviewing && (
            <span className="ml-2 text-gold-600 text-xs font-normal">(moving)</span>
          )}
        </div>
        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
          {styling.label && (
            <span className={`font-medium ${styling.labelStyle}`}>
              {styling.label}
            </span>
          )}
          {SHOW_GRADES && course.grade &&
            (course.status === 'completed' || course.status === 'failed') && (
              <span className="whitespace-nowrap">· {course.grade}</span>
            )}
          {nextChip && (
            <span
              className="px-1.5 py-px rounded text-[9px] font-semibold bg-navy-100 text-navy-700"
              title={`Offered ${enrollmentQuarter.label} (shared schedule)`}
            >
              {nextChip}
            </span>
          )}
          {seatChip && (
            <span
              className={`px-1.5 py-px rounded text-[9px] font-semibold ${seatChip.className}`}
              title={`${seatChip.title} · ${enrollmentQuarter.label}`}
            >
              {seatChip.label}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0 self-start">
        {prereqWarning && (
          <span
            title={prereqWarning.message}
            className="cursor-help px-1.5 py-px rounded-full text-[9px] font-semibold bg-amber-50 text-amber-600"
            aria-label={prereqWarning.message}
          >
            Prereqs
          </span>
        )}
        {warning && (
          <span
            title={`${warning.message} Based on past schedules — not a guarantee.`}
            className="cursor-help"
            aria-label={warning.message}
          >
            <TriangleAlert className="w-3.5 h-3.5 text-amber-500" />
          </span>
        )}
        {/* The degree audit offers this course but the catalog has never
            published it, so its units and prerequisites are genuinely
            unknown. "? u" rather than "0.0 u": a confident zero would read
            as a real number and quietly shrink the unit totals. */}
        {unverified && (
          <span
            title={
              `${course.course_id} is listed by your degree audit but is not in ` +
              `the course catalog, so its unit count and prerequisites could ` +
              `not be checked. Confirm the units with your advisor.`
            }
            className="cursor-help px-1.5 py-px rounded text-[9px] font-semibold bg-amber-100 text-amber-700"
            aria-label={`${course.course_id} is unverified — not found in the course catalog`}
          >
            UNVERIFIED
          </span>
        )}
        <span
          className={`text-xs tabular-nums whitespace-nowrap ${
            unverified ? 'text-amber-600' : 'text-slate-500'
          }`}
        >
          {unverified ? '?' : credits.toFixed(1)} u
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
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
