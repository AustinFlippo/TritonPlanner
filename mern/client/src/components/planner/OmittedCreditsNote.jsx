import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { parseCredits, hasUnknownCredits } from "../../utils/courseCredits";
import { SHOW_GRADES } from "../../utils/courseGrades";

/**
 * Note under the planner grid for transfer/AP credit that falls outside the
 * student's plan window. Those courses still count in the sidebar and for
 * prereqs — they just have no UCSD term to sit in.
 */
const OmittedCreditsNote = ({ courses }) => {
  const [expanded, setExpanded] = useState(false);

  if (!courses?.length) return null;

  // Credits can legitimately be unknown (the audit row carried no hours), which
  // is different from zero. Counting unknowns as 0 would advertise "0 transfer
  // credits" for a student who has them.
  const known = courses.filter((c) => !hasUnknownCredits(c));
  const unknownCount = courses.length - known.length;
  const credits = known.reduce((sum, c) => sum + parseCredits(c.credits, 0), 0);
  const creditLabel = credits === 1 ? "credit" : "credits";
  const summary = known.length
    ? `${credits} transfer/AP ${creditLabel}${
        unknownCount ? ` (plus ${unknownCount} with no published unit count)` : ""
      }`
    : `${courses.length} transfer/AP course${
        courses.length === 1 ? "" : "s"
      } with no published unit count`;

  return (
    <div className="mt-4 mb-2 px-1">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-600 leading-snug">
          {summary} aren&apos;t shown here — they have no UCSD term.
        </p>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex items-center gap-1 flex-shrink-0 text-xs font-medium text-navy-700 hover:text-navy-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 focus-visible:ring-offset-2 rounded"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          {expanded ? "Hide courses" : "Show courses"}
        </button>
      </div>

      {expanded && (
        <ul className="mt-2 space-y-1 text-sm text-slate-600">
          {courses.map((course) => {
            const detail = [course.term, SHOW_GRADES ? course.grade : null]
              .filter(Boolean)
              .join(", ");
            return (
              <li key={course.course_id}>
                <span className="font-medium text-slate-700">
                  {course.course_id}
                </span>
                {course.course_name ? ` — ${course.course_name}` : ""}
                {detail ? ` (${detail})` : ""}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default OmittedCreditsNote;
