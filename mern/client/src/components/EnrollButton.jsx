// "I already registered for this on WebReg" — the toggle behind the planner's
// Enrolled mark (scheduleOps.setCourseEnrolled).
//
// A labelled pill rather than an icon: a lone check mark read as decoration,
// and hidden-until-hover meant nobody found it. The label always names the
// action the click performs, so the enrolled state offers "Unenroll" and the
// planned state offers "Enroll". Marking is a fact about the student, not a
// registration — WebReg does the enrolling — and the tooltip says so.
// size "xs" is for calendar blocks: a 50-minute lecture is ~47px tall, and
// title + time + the default 20px pill overflowed it by a few pixels, so the
// bottom of the pill was clipped. 14px tall keeps the whole row visible.
const EnrollButton = ({
  courseId,
  enrolled,
  onToggle,
  className = "",
  size = "sm",
}) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onToggle?.();
    }}
    aria-pressed={enrolled}
    className={`inline-flex items-center whitespace-nowrap rounded border text-[9px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
      size === "xs" ? "px-1 py-0 leading-3" : "px-1.5 py-px leading-4"
    } ${
      enrolled
        ? "border-slate-200 bg-white text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
        : "border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50"
    } ${className}`}
    title={
      enrolled
        ? `Unenroll: you dropped ${courseId} (or want its seat warnings back). This only updates the planner.`
        : `Enroll: you already registered for ${courseId} on WebReg, so the planner should stop flagging its seats. This only updates the planner.`
    }
    aria-label={
      enrolled
        ? `Unmark ${courseId} as enrolled`
        : `Mark ${courseId} as enrolled`
    }
  >
    {enrolled ? "Unenroll" : "Enroll"}
  </button>
);

export default EnrollButton;
