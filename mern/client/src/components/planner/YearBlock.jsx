import { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import TermBlock from "./TermBlock";
import { isFutureYear, yearHasPlannedCourses } from "../../utils/scheduleOps";
import { hasUnknownCredits } from "../../utils/courseCredits";

const YearBlock = ({
  year,
  yearIndex,
  yearLabel,
  collapsed,
  toggleCollapse,
  calculateAnnualUnits,
  calculateTermUnits,
  handleDragOver,
  handleDrop,
  handleDragStart,
  handleDragEnd,
  handleRemoveCourse,
  handleClearYear,
  getSlotClassName,
  previewState,
  dragTarget,
  dropWarning,
  getCourseWarning,
  onOpenCourse,
}) => {
  const annualUnits = calculateAnnualUnits(yearIndex);
  // Mirrors TermBlock: courses with no published unit count are left out of the
  // total, so name them rather than letting the number imply they are worth 0.
  const unknownUnitCourses = ["fall", "winter", "spring"].reduce(
    (n, term) =>
      n + (year?.[term] || []).filter((c) => c && hasUnknownCredits(c)).length,
    0
  );
  const canClear =
    typeof handleClearYear === "function" &&
    isFutureYear(year) &&
    yearHasPlannedCourses(year);

  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef(null);
  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  // Drop confirm state when the year becomes non-clearable (e.g. already wiped)
  useEffect(() => {
    if (!canClear) setConfirming(false);
  }, [canClear]);

  const startConfirm = (e) => {
    e.stopPropagation();
    setConfirming(true);
    clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirming(false), 4000);
  };

  const cancelConfirm = (e) => {
    e.stopPropagation();
    clearTimeout(confirmTimer.current);
    setConfirming(false);
  };

  const confirmClear = (e) => {
    e.stopPropagation();
    clearTimeout(confirmTimer.current);
    setConfirming(false);
    handleClearYear(yearIndex);
  };

  return (
    <div className="mb-4 bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
      {/* Year header */}
      <div className="w-full px-4 py-3 flex justify-between items-center bg-white border-b border-slate-200">
        <button
          type="button"
          className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 rounded"
          onClick={() => toggleCollapse(yearIndex)}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
          )}
          <span className="text-sm font-semibold text-slate-800">
            Year {yearIndex + 1}
          </span>
          <span className="text-sm text-slate-400 truncate">{yearLabel}</span>
        </button>

        <div className="flex items-center gap-3 flex-shrink-0">
          {canClear &&
            (confirming ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={confirmClear}
                  className="px-2 py-1 text-xs font-medium rounded-md text-white bg-red-600 hover:bg-red-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                >
                  Clear year?
                </button>
                <button
                  type="button"
                  onClick={cancelConfirm}
                  className="px-2 py-1 text-xs font-medium rounded-md text-slate-500 hover:bg-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={startConfirm}
                className="px-2 py-1 text-xs font-medium rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                title={`Clear all courses from Year ${yearIndex + 1}`}
                aria-label={`Clear Year ${yearIndex + 1}`}
              >
                Clear
              </button>
            ))}
          <span
            className={`text-xs tabular-nums ${
              annualUnits > 0 ? "font-medium text-slate-600" : "text-slate-400"
            }`}
          >
            {annualUnits.toFixed(1)} units
            {unknownUnitCourses > 0 && (
              <span
                className="ml-1 text-amber-600"
                title={`${unknownUnitCourses} course${
                  unknownUnitCourses === 1 ? "" : "s"
                } this year have no published unit count, so they aren't in this total.`}
              >
                + {unknownUnitCourses} ?
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Terms */}
      {!collapsed && (
        <div className="flex flex-col md:flex-row md:divide-x divide-slate-100">
          {['fall', 'winter', 'spring'].map((term) => (
            <TermBlock
              key={term}
              termKey={term}
              termName={term.charAt(0).toUpperCase() + term.slice(1)}
              courses={year[term]}
              yearIndex={yearIndex}
              calculateTermUnits={calculateTermUnits}
              handleDragOver={handleDragOver}
              handleDrop={handleDrop}
              handleDragStart={handleDragStart}
              handleDragEnd={handleDragEnd}
              handleRemoveCourse={handleRemoveCourse}
              getSlotClassName={getSlotClassName}
              previewState={previewState}
              dragTarget={dragTarget}
              dropWarning={dropWarning}
              getCourseWarning={getCourseWarning}
              onOpenCourse={onOpenCourse}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default YearBlock;
