import { Plus } from "lucide-react";
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
  onOpenCourse,
}) => {
  const termUnits = calculateTermUnits(courses);
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

      {/* Course slots */}
      {courses.map((course, courseIndex) => (
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
            />
          ) : (
            <div className="h-11 flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 text-slate-300">
              {dropWarning &&
              dragTarget &&
              dragTarget.yearIndex === yearIndex &&
              dragTarget.term === termKey &&
              dragTarget.courseIndex === courseIndex ? (
                <span className="text-xs text-amber-600 px-2 text-center">
                  May not be offered in {termName}
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
      ))}
    </div>
  );
};

export default TermBlock;
