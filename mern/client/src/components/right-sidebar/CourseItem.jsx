import { GripVertical, Plus } from "lucide-react";
import { useNextQuarterOfferings } from "../../context/NextQuarterOfferingsContext";
import {
  parseCredits,
  isUnverifiedCourse,
  isLiveOnlyCourse,
  hasUnknownCredits,
  unknownUnitsReason,
} from "../../utils/courseCredits";

// Which terms a course is offered in, rendered as compact chips
const TERM_CHIPS = [
  { code: "FA", label: "F" },
  { code: "WI", label: "W" },
  { code: "SP", label: "S" },
];

// prereqsMet (optional): true = prereqs satisfied by plan, false = missing,
// null/undefined = unknown or not applicable — no badge shown
// onAdd (phones): arms the course for tap-to-place. The drag handle is a
// desktop gesture; touch gets an explicit button in its place.
const CourseItem = ({
  course,
  onDragStart,
  onDragEnd,
  onClick,
  prereqsMet,
  onAdd,
  compact = false,
}) => {
  const { offeredNextChip, enrollmentQuarter, seatChipFor } =
    useNextQuarterOfferings();
  const nextChip = offeredNextChip(course?.course_id);
  const seatChip = seatChipFor(course?.course_id);
  // Vouched for by the degree audit but absent from the catalog — units,
  // prereqs and offered quarters are all unknown, so say so rather than
  // rendering an empty name and a confident "0.0 u".
  const unverified = isUnverifiedCourse(course);
  // A catalog course whose units failed to parse: everything else about it is
  // real, so show the name, prereqs and quarters — just not a fabricated unit
  // count.
  const unknownUnits = hasUnknownCredits(course);
  // On the live Class Planner schedule but never in the General Catalog: a
  // real course with a real name and staff, whose units and prereqs UCSD
  // simply hasn't published. Not unverified — just incompletely described.
  const liveOnly = isLiveOnlyCourse(course);
  const prereqs = liveOnly
    ? "unknown (not in the General Catalog)"
    : Array.isArray(course.prerequisites)
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
      onClick={() => onClick?.(course)}
      title="Drag into your plan · click for details"
    >
      <div className="flex items-center gap-1.5">
        <GripVertical className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-400 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex justify-between items-baseline gap-2">
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <span className="text-[13px] font-semibold text-slate-800 truncate">
                {course.course_id}
              </span>
              {nextChip && (
                <span
                  className="flex-shrink-0 px-1.5 py-px rounded text-[9px] font-semibold bg-navy-100 text-navy-700"
                  title={`Offered ${enrollmentQuarter.label} (shared schedule)`}
                >
                  {nextChip}
                </span>
              )}
              {seatChip && (
                <span
                  className={`flex-shrink-0 px-1.5 py-px rounded text-[9px] font-semibold ${seatChip.className}`}
                  title={`${seatChip.title} · ${enrollmentQuarter.label}`}
                >
                  {seatChip.label}
                </span>
              )}
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
              {unverified && (
                <span
                  className="flex-shrink-0 px-1.5 py-px rounded text-[9px] font-semibold bg-amber-100 text-amber-700"
                  title={`${course.course_id} is listed by your degree audit but is not in the course catalog, so its units, prerequisites and offered quarters are unknown. Confirm with your advisor.`}
                >
                  UNVERIFIED
                </span>
              )}
              <span
                className={`text-[11px] tabular-nums ${
                  unknownUnits ? "text-amber-600" : "text-slate-500"
                }`}
                title={unknownUnits && !unverified ? unknownUnitsReason(course) : undefined}
              >
                {unknownUnits ? "?" : parseCredits(course.credits).toFixed(1)} u
              </span>
            </span>
          </div>
          <div
            className={`text-xs truncate ${
              unverified ? "italic text-amber-600" : "text-slate-500"
            }`}
          >
            {unverified
              ? "Listed by your audit · not in the course catalog"
              : course.course_name}
            {liveOnly && (
              <span className="ml-1 text-slate-400 not-italic">
                · on the {course.live_term || "live"} schedule, not in the catalog
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {/* Greyed-out term chips mean "not offered". For an unverified
                course we simply don't know, and three grey chips would assert
                it runs in no quarter at all — so show nothing instead. */}
            {!unverified && (
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
                      title={
                        offered
                          ? liveOnly
                            ? `On the ${course.live_term || "live"} schedule`
                            : `Offered ${label}`
                          : liveOnly
                            ? "Unknown — not in the General Catalog"
                            : `Not offered ${label}`
                      }
                    >
                      {label}
                    </span>
                  );
                })}
              </span>
            )}
            <span className="text-[11px] text-slate-400 truncate">
              Prereq: {unverified ? "unknown" : prereqs}
            </span>
          </div>
        </div>

        {compact && onAdd && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAdd(course);
            }}
            className="flex-shrink-0 w-9 h-9 -mr-1 flex items-center justify-center rounded-lg border border-navy-200 text-navy-600 active:bg-navy-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
            aria-label={`Add ${course.course_id} to your plan`}
            title="Add to plan"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default CourseItem;
