import { CornerDownRight, Plus } from "lucide-react";
import CourseCard from "./CourseCard";
import { hasUnknownCredits } from "../../utils/courseCredits";

const TermBlock = ({
  termName,
  termKey,
  courses,
  yearIndex,
  calculateTermUnits,
  handleDragOver,
  handleDrop,
  handleDragStart,
  handleDragEnd,
  handleRemoveCourse,
  getSlotClassName,
  previewState,
  dragTarget,
  dropWarning,
  getCourseWarning,
  getPrereqWarning,
  onOpenCourse,
  compact = false,
  placementCourse = null,
  onPlaceInTerm,
  onMoveCourse,
  // (course, yearIndex, termKey) → handler or null. Null everywhere except the
  // enrollment quarter, so the enrolled toggle only appears where it means
  // something.
  enrolledToggleFor,
}) => {
  const termUnits = calculateTermUnits(courses);
  // While a course is armed, the whole quarter is one big target. Individual
  // slots are ~44px stacked three deep — a coin toss under a thumb, and their
  // order carries no meaning, so the term is the honest unit to aim at.
  const isPlacementTarget = Boolean(placementCourse && onPlaceInTerm);
  // Courses the catalog has no unit count for are excluded from the total on
  // purpose — say so, rather than letting the total imply they're worth zero.
  const unknownUnitCourses = (courses || []).filter(
    (course) => course && hasUnknownCredits(course)
  ).length;

  return (
    <div className="flex-1 px-3 py-3">
      {/* Term header — single line, quiet units */}
      <div className="flex justify-between items-baseline mb-2 px-1">
        <span className="text-[13px] font-semibold text-slate-700">
          {termName}
        </span>
        <span
          className={`text-xs tabular-nums ${
            termUnits > 0 ? "font-medium text-slate-600" : "text-slate-400"
          }`}
        >
          {termUnits.toFixed(1)} units
          {unknownUnitCourses > 0 && (
            <span
              className="ml-1 text-amber-600"
              title={`${unknownUnitCourses} course${
                unknownUnitCourses === 1 ? "" : "s"
              } here have no published unit count, so they aren't in this total.`}
            >
              + {unknownUnitCourses} ?
            </span>
          )}
        </span>
      </div>

      {isPlacementTarget && (
        <button
          type="button"
          onClick={() => onPlaceInTerm(yearIndex, termKey)}
          className="w-full mb-2 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border-2 border-dashed border-navy-400 bg-navy-50 text-[13px] font-medium text-navy-700 active:bg-navy-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
        >
          <CornerDownRight className="w-3.5 h-3.5" />
          Place in {termName}
        </button>
      )}

      {/* Course slots. While a placement is armed the empty placeholders are
          noise around the one real target, so only real cards render. */}
      {courses.map((course, courseIndex) => (
        isPlacementTarget && !course ? null : (
        <div
          key={courseIndex}
          className={`mb-2 ${getSlotClassName(yearIndex, termKey, courseIndex)}`}
          onDragOver={(e) => handleDragOver(e, yearIndex, termKey, courseIndex)}
          onDrop={(e) => handleDrop(e, yearIndex, termKey, courseIndex)}
        >
          {course ? (
            <CourseCard
              course={course}
              warning={getCourseWarning ? getCourseWarning(course, termKey) : null}
              prereqWarning={
                getPrereqWarning
                  ? getPrereqWarning(course, termKey, yearIndex)
                  : null
              }
              isPreviewing={
                previewState &&
                previewState.sourceYearIndex === yearIndex &&
                previewState.sourceTerm === termKey &&
                previewState.sourceCourseIndex === courseIndex
              }
              onDragStart={(e) =>
                handleDragStart(e, course, false, yearIndex, termKey, courseIndex)
              }
              onDragEnd={handleDragEnd}
              onRemove={() => handleRemoveCourse(yearIndex, termKey, courseIndex)}
              onOpen={onOpenCourse}
              compact={compact}
              onMove={
                onMoveCourse
                  ? () => onMoveCourse(course, yearIndex, termKey, courseIndex)
                  : undefined
              }
              onToggleEnrolled={
                enrolledToggleFor
                  ? enrolledToggleFor(course, yearIndex, termKey) || undefined
                  : undefined
              }
            />
          ) : (
            <div className="h-11 flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 text-slate-300">
              {dropWarning &&
              dragTarget &&
              dragTarget.yearIndex === yearIndex &&
              dragTarget.term === termKey &&
              dragTarget.courseIndex === courseIndex ? (
                <span
                  className={`text-xs px-2 text-center ${
                    dropWarning.type === "not-live"
                      ? "text-red-600"
                      : "text-amber-600"
                  }`}
                >
                  {dropWarning.type === "prereq"
                    ? "Missing prerequisites"
                    : dropWarning.type === "quarter" || dropWarning.type === "no-history"
                    ? `May not be offered in ${termName}`
                    : dropWarning.message}
                </span>
              ) : previewState &&
                previewState.targetYearIndex === yearIndex &&
                previewState.targetTerm === termKey &&
                previewState.targetCourseIndex === courseIndex ? (
                <span className="text-xs text-gold-600">
                  {previewState.course.course_name} (preview)
                </span>
              ) : (
                <Plus className="w-4 h-4" aria-label="Empty course slot" />
              )}
            </div>
          )}
        </div>
        )
      ))}
    </div>
  );
};

export default TermBlock;
