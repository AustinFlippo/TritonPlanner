// Inline course chip inside chat bubbles. Looks like a hyperlink, drags with
// the same dataTransfer payload as Course Search, and shows a CourseCard-like
// ghost while dragging into the planner / quarter view.

import { useRef } from "react";

const makeDragGhost = (course) => {
  const ghost = document.createElement("div");
  ghost.className =
    "pointer-events-none flex justify-between items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 border-l-[3px] border-l-navy-500 shadow-panel";
  ghost.style.cssText =
    "position:absolute; top:-1000px; left:-1000px; width:180px; font-family:inherit;";
  ghost.innerHTML = `
    <div style="min-width:0">
      <div style="font-size:13px;font-weight:600;color:#1e293b">${escapeHtml(
        course.course_id || ""
      )}</div>
      <div style="font-size:11px;color:#64748b;margin-top:1px">
        <span style="font-weight:500;color:#1e3a5f">Planned</span>
        ${
          course.course_name
            ? ` · ${escapeHtml(String(course.course_name).slice(0, 28))}`
            : ""
        }
      </div>
    </div>
    <div style="font-size:11px;color:#64748b;flex-shrink:0">
      ${course.credits ? Number(course.credits).toFixed(1) : "0.0"} u
    </div>
  `;
  document.body.appendChild(ghost);
  return ghost;
};

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * @param {{
 *   course: object,
 *   variant?: "assistant" | "user",
 *   onDragStart: (e: DragEvent, course: object) => void,
 *   onDragEnd?: () => void,
 *   onOpen?: (course: object) => void,
 * }} props
 */
const ChatCourseMention = ({
  course,
  variant = "assistant",
  onDragStart,
  onDragEnd,
  onOpen,
  fallback = null,
}) => {
  const ghostRef = useRef(null);
  const label = course?.course_id || fallback;

  // Never swallow the mention — callers pass fallback text when the catalog
  // stub is incomplete so the code stays visible in the bubble.
  if (!label) return null;

  const chipClass =
    variant === "user"
      ? "inline-flex items-center px-1.5 py-px mx-0.5 rounded bg-white/15 text-white font-semibold underline underline-offset-2 decoration-white/50 hover:bg-white/25 cursor-grab active:cursor-grabbing"
      : "inline-flex items-center px-1.5 py-px mx-0.5 rounded bg-navy-50 text-navy-700 font-semibold underline underline-offset-2 decoration-navy-300 hover:bg-navy-100 hover:text-navy-800 cursor-grab active:cursor-grabbing";

  return (
    <span
      role="link"
      tabIndex={0}
      draggable
      className={chipClass}
      title={`${label}${
        course?.course_name ? ` — ${course.course_name}` : ""
      }\nDrag into your plan · click for details`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (course?.course_id) onOpen?.(course);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (course?.course_id) onOpen?.(course);
        }
      }}
      onDragStart={(e) => {
        e.stopPropagation();
        if (!course?.course_id) {
          e.preventDefault();
          return;
        }
        const ghost = makeDragGhost(course);
        ghostRef.current = ghost;
        try {
          e.dataTransfer.setDragImage(ghost, 16, 16);
        } catch {
          /* some browsers reject custom images; native chip still works */
        }
        e.dataTransfer.effectAllowed = "copyMove";
        onDragStart?.(e, course);
      }}
      onDragEnd={() => {
        if (ghostRef.current?.parentNode) {
          ghostRef.current.parentNode.removeChild(ghostRef.current);
        }
        ghostRef.current = null;
        onDragEnd?.();
      }}
    >
      {label}
    </span>
  );
};

export default ChatCourseMention;
