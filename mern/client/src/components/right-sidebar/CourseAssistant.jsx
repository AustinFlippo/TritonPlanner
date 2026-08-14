import React, {
  useEffect,
  useMemo,
  useState,
  Children,
  isValidElement,
  cloneElement,
} from "react";
import ReactMarkdown from "react-markdown";
import {
  SendHorizonal,
  Square,
  Check,
  TriangleAlert,
  Maximize2,
  Minimize2,
} from "lucide-react";
import ChatCourseMention from "./ChatCourseMention";
import {
  extractCourseMentions,
  splitCourseMentions,
} from "../../utils/chatCourseMentions";

const SUGGESTIONS = [
  "What are the prerequisites for CSE 100?",
  "Which quarters is DSC 80 offered?",
  "Plan out my remaining requirements",
  "Fix my section time conflicts — avoid Fridays if possible",
];

// Rotating status copy while the model is working — not wired to real tool
// steps, just keeps the wait feeling alive instead of bare bouncing dots.
const THINKING_STATUSES = [
  "Thinking",
  "Planning",
  "Checking courses",
  "Looking up prereqs",
  "Considering options",
  "Almost there",
];

function ThinkingIndicator() {
  const [statusIndex, setStatusIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setStatusIndex((i) => (i + 1) % THINKING_STATUSES.length);
    }, 3500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="bg-white border border-slate-200 px-3 py-2.5 rounded-xl rounded-bl-sm max-w-[85%] shadow-card">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span key={statusIndex} className="animate-pulse">
          {THINKING_STATUSES[statusIndex]}
        </span>
        <span className="flex space-x-1">
          <span className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-bounce" />
          <span className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-bounce delay-75" />
          <span className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-bounce delay-150" />
        </span>
      </div>
    </div>
  );
}

const DAY_ORDER = ["M", "T", "W", "R", "F", "S"];

function formatMeetings(meetings) {
  if (!Array.isArray(meetings) || !meetings.length) return "times TBA";
  return meetings
    .map((m) => {
      const days = (Array.isArray(m.days) ? m.days : [])
        .slice()
        .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b))
        .join("");
      const time =
        m.start && m.end ? `${m.start}–${m.end}` : m.start || "TBA";
      const component = m.component ? `${m.component} ` : "";
      return `${component}${days || "?"} ${time}`.trim();
    })
    .join("; ");
}

function formatSeats(selection) {
  const avail = selection?.seatsAvailable;
  const total = selection?.seatsTotal;
  if (Number.isFinite(avail) && Number.isFinite(total)) {
    return `${avail}/${total} seats`;
  }
  return selection?.status || "seats unknown";
}

function formatInstructors(selection) {
  const list = selection?.instructors || [];
  if (!list.length) return "instructor TBA";
  return list.join(", ");
}

/** Replace course-code strings with draggable chips when the catalog resolved them. */
function linkifyChildren(children, courseLookup, mentionProps) {
  return Children.map(children, (child, index) => {
    if (typeof child === "string") {
      return splitCourseMentions(child).map((part, partIndex) => {
        if (part.type !== "course") {
          return (
            <React.Fragment key={`${index}-${partIndex}`}>
              {part.value}
            </React.Fragment>
          );
        }
        const course = courseLookup?.(part.value);
        const raw = part.raw || part.value;
        if (!course?.course_id) {
          return (
            <React.Fragment key={`${index}-${partIndex}`}>
              {raw}
            </React.Fragment>
          );
        }
        return (
          <ChatCourseMention
            key={`${index}-${partIndex}-${course.course_id}`}
            course={course}
            fallback={raw}
            {...mentionProps}
          />
        );
      });
    }
    if (isValidElement(child)) {
      // Already a chip, or code — leave alone.
      if (
        child.type === ChatCourseMention ||
        child.type === "code" ||
        child.props?.className?.includes("language-")
      ) {
        return child;
      }
      if (child.props?.children == null) return child;
      return cloneElement(child, {
        ...child.props,
        key: child.key ?? index,
        children: linkifyChildren(
          child.props.children,
          courseLookup,
          mentionProps
        ),
      });
    }
    return child;
  });
}

const buildMarkdownComponents = (courseLookup, mentionProps) => {
  const withMentions = (Tag, className) => {
    const Comp = ({ children, ...rest }) => (
      <Tag className={className} {...rest}>
        {linkifyChildren(children, courseLookup, mentionProps)}
      </Tag>
    );
    Comp.displayName = `ChatMd(${typeof Tag === "string" ? Tag : "el"})`;
    return Comp;
  };

  return {
    h1: withMentions(
      "h1",
      "text-base font-semibold text-slate-800 mt-2 mb-1 first:mt-0"
    ),
    h2: withMentions(
      "h2",
      "text-sm font-semibold text-slate-800 mt-2.5 mb-1 first:mt-0"
    ),
    h3: withMentions(
      "h3",
      "text-sm font-semibold text-slate-800 mt-2 mb-1 first:mt-0"
    ),
    p: withMentions("p", "my-1.5 first:mt-0 last:mb-0 leading-relaxed"),
    ul: ({ children }) => (
      <ul className="my-1.5 ml-4 list-disc space-y-1 marker:text-slate-400">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-1.5 ml-4 list-decimal space-y-1 marker:text-slate-400">
        {children}
      </ol>
    ),
    li: withMentions("li", "leading-relaxed pl-0.5"),
    strong: withMentions("strong", "font-semibold text-slate-800"),
    em: withMentions("em", "italic"),
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-navy-600 underline underline-offset-2 hover:text-navy-700"
      >
        {children}
      </a>
    ),
    code: ({ children }) => (
      <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em] text-slate-800">
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="my-1.5 overflow-x-auto rounded-lg bg-slate-100 px-2.5 py-2 text-xs">
        {children}
      </pre>
    ),
  };
};

const LinkedPlainText = ({ text, courseLookup, mentionProps }) => (
  <>
    {splitCourseMentions(text).map((part, index) => {
      if (part.type !== "course") {
        return <React.Fragment key={index}>{part.value}</React.Fragment>;
      }
      const course = courseLookup?.(part.value);
      const raw = part.raw || part.value;
      if (!course?.course_id) {
        return <React.Fragment key={index}>{raw}</React.Fragment>;
      }
      return (
        <ChatCourseMention
          key={`${index}-${course.course_id}`}
          course={course}
          fallback={raw}
          {...mentionProps}
        />
      );
    })}
  </>
);

const CourseAssistant = ({
  chatMessages,
  currentMessage,
  setCurrentMessage,
  isLoading,
  sendMessage,
  stopMessage,
  chatEndRef,
  onKeyPress,
  onApplyPlan,
  onApplySectionProposal,
  expandState,
  onToggleExpand,
  courseLookup = null,
  onCourseDragStart,
  onCourseDragEnd,
  onOpenCourse,
}) => {
  // Indexes of messages whose plan has been applied to the grid
  const [appliedPlans, setAppliedPlans] = React.useState(new Set());
  const [appliedSections, setAppliedSections] = React.useState(new Set());
  const [sectionApplyError, setSectionApplyError] = React.useState({});
  const [sectionApplying, setSectionApplying] = React.useState(null);

  const mentionProps = useMemo(
    () => ({
      variant: "assistant",
      onDragStart: onCourseDragStart,
      onDragEnd: onCourseDragEnd,
      onOpen: onOpenCourse,
    }),
    [onCourseDragStart, onCourseDragEnd, onOpenCourse]
  );

  const userMentionProps = useMemo(
    () => ({ ...mentionProps, variant: "user" }),
    [mentionProps]
  );

  const markdownComponents = useMemo(
    () => buildMarkdownComponents(courseLookup, mentionProps),
    [courseLookup, mentionProps]
  );

  const handleApply = (msg, index) => {
    if (onApplyPlan && msg.proposedSchedule) {
      onApplyPlan(msg.proposedSchedule);
      setAppliedPlans((prev) => new Set(prev).add(index));
    }
  };

  const handleApplySections = async (msg, index) => {
    if (!onApplySectionProposal || !msg.proposedSections) return;
    setSectionApplying(index);
    setSectionApplyError((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    try {
      await onApplySectionProposal(msg.proposedSections);
      setAppliedSections((prev) => new Set(prev).add(index));
    } catch (err) {
      setSectionApplyError((prev) => ({
        ...prev,
        [index]:
          err?.message ||
          "Couldn't apply section changes — ask the assistant to refresh.",
      }));
    } finally {
      setSectionApplying(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Panel header */}
      <div className="h-11 px-4 flex items-center justify-between border-b border-slate-200 flex-shrink-0">
        <h3 className="panel-heading">Course Assistant</h3>
        <button
          type="button"
          className="p-1 rounded text-slate-400 hover:text-navy-600 hover:bg-slate-100 transition-colors"
          onClick={onToggleExpand}
          title={
            expandState === "expanded"
              ? "Restore side panel (Esc)"
              : "Expand assistant"
          }
        >
          {expandState === "expanded" ? (
            <Minimize2 className="w-3.5 h-3.5" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Scrollable chat messages */}
      <div className="flex-grow p-3 overflow-y-auto bg-slate-50">
        {chatMessages.length === 0 ? (
          <div className="mt-4">
            <p className="text-sm text-slate-600 text-center mb-3">
              Ask anything about courses and planning
            </p>
            <div className="space-y-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setCurrentMessage(s)}
                  className="block w-full text-left text-xs text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2 hover:border-navy-300 hover:text-navy-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {chatMessages.map((msg, index) => (
              <div
                key={index}
                className={`px-3 py-2 text-sm max-w-[85%] ${
                  msg.role === "user"
                    ? "ml-auto bg-navy-700 text-white rounded-xl rounded-br-sm"
                    : "bg-white text-slate-700 border border-slate-200 rounded-xl rounded-bl-sm shadow-card"
                }`}
              >
                {msg.role === "user" ? (
                  <div className="whitespace-pre-wrap">
                    <LinkedPlainText
                      text={msg.content}
                      courseLookup={courseLookup}
                      mentionProps={userMentionProps}
                    />
                  </div>
                ) : (
                  <div className="chat-markdown">
                    <ReactMarkdown components={markdownComponents}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                )}

                {/* Proposed schedule preview + apply */}
                {msg.placements?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-200">
                    <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 text-slate-500">
                      Proposed schedule
                    </div>
                    {msg.placements.map((p) => (
                      <div
                        key={p.label}
                        className="text-xs mb-1 text-slate-600"
                      >
                        <span className="font-semibold text-slate-700">
                          {p.label}:
                        </span>{" "}
                        {p.courses.map((courseId, ci) => {
                          // Placement labels are "DSC 100 (4u)" (or bare ids for
                          // removals) — look up by the embedded course code.
                          const mention =
                            extractCourseMentions(courseId)[0] || courseId;
                          const course = courseLookup?.(mention);
                          return (
                            <React.Fragment key={`${p.label}-${ci}`}>
                              {ci > 0 ? ", " : null}
                              {course?.course_id ? (
                                <ChatCourseMention
                                  course={course}
                                  fallback={courseId}
                                  {...mentionProps}
                                />
                              ) : (
                                courseId
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    ))}
                    {msg.warnings?.length > 0 && !msg.proposedSections && (
                      <div className="mt-1.5 space-y-1">
                        {msg.warnings.map((w, wi) => (
                          <div
                            key={wi}
                            className="flex items-start gap-1 text-xs text-amber-700"
                          >
                            <TriangleAlert className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            {w}
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => handleApply(msg, index)}
                      disabled={appliedPlans.has(index)}
                      className={`mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 ${
                        appliedPlans.has(index)
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default"
                          : "bg-navy-700 hover:bg-navy-600 text-white"
                      }`}
                    >
                      {appliedPlans.has(index) && <Check className="w-3 h-3" />}
                      {appliedPlans.has(index)
                        ? "Applied to planner"
                        : "Apply to planner"}
                    </button>
                  </div>
                )}

                {/* Proposed section package changes + apply to Quarter View */}
                {msg.proposedSections?.selections?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-200">
                    <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 text-slate-500">
                      Proposed section changes
                    </div>
                    <div className="text-[11px] text-slate-500 mb-1.5">
                      {msg.proposedSections.termLabel || "Enrollment quarter"}
                      {" · "}
                      {msg.proposedSections.live
                        ? "live seats"
                        : `snapshot${
                            msg.proposedSections.source
                              ? ` (${msg.proposedSections.source})`
                              : ""
                          }`}
                    </div>
                    {msg.proposedSections.selections.map((sel) => {
                      const course = courseLookup?.(sel.courseId);
                      const from = sel.previousPackageId || "none";
                      const to = sel.packageId;
                      return (
                        <div
                          key={`${sel.courseId}-${sel.packageId}`}
                          className="text-xs mb-2 text-slate-600"
                        >
                          <div className="font-semibold text-slate-700">
                            {course ? (
                              <ChatCourseMention
                                course={course}
                                {...mentionProps}
                              />
                            ) : (
                              sel.courseId
                            )}
                            {sel.changed ? (
                              <span className="font-normal text-slate-500">
                                {" "}
                                {from} → {to}
                              </span>
                            ) : (
                              <span className="font-normal text-slate-500">
                                {" "}
                                (unchanged {to})
                              </span>
                            )}
                          </div>
                          <div className="text-slate-500 mt-0.5">
                            {formatInstructors(sel)} · {formatMeetings(sel.meetings)}{" "}
                            · {formatSeats(sel)}
                          </div>
                        </div>
                      );
                    })}
                    {msg.proposedSections.afterConflicts?.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {msg.proposedSections.afterConflicts.map((c, ci) => (
                          <div
                            key={ci}
                            className="flex items-start gap-1 text-xs text-amber-700"
                          >
                            <TriangleAlert className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            Unresolved conflict: {c}
                          </div>
                        ))}
                      </div>
                    )}
                    {msg.warnings?.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {msg.warnings.map((w, wi) => (
                          <div
                            key={wi}
                            className="flex items-start gap-1 text-xs text-amber-700"
                          >
                            <TriangleAlert className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            {w}
                          </div>
                        ))}
                      </div>
                    )}
                    {sectionApplyError[index] && (
                      <div className="mt-1.5 text-xs text-rose-700">
                        {sectionApplyError[index]}
                      </div>
                    )}
                    <button
                      onClick={() => handleApplySections(msg, index)}
                      disabled={
                        appliedSections.has(index) ||
                        sectionApplying === index ||
                        !onApplySectionProposal
                      }
                      className={`mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 ${
                        appliedSections.has(index)
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default"
                          : "bg-navy-700 hover:bg-navy-600 text-white disabled:opacity-60"
                      }`}
                    >
                      {appliedSections.has(index) && (
                        <Check className="w-3 h-3" />
                      )}
                      {appliedSections.has(index)
                        ? "Applied to Quarter View"
                        : sectionApplying === index
                          ? "Validating…"
                          : "Apply to Quarter View"}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {isLoading && <ThinkingIndicator />}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-slate-200 bg-white">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={
              isLoading ? "Generating… Esc to stop" : "Ask about courses…"
            }
            className="flex-grow px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-navy-400 focus:ring-2 focus:ring-navy-100 transition-colors"
            value={currentMessage}
            onChange={(e) => setCurrentMessage(e.target.value)}
            onKeyDown={onKeyPress}
          />
          {isLoading ? (
            <button
              type="button"
              className="flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 bg-navy-700 hover:bg-navy-600 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
              onClick={stopMessage}
              aria-label="Stop generating"
              title="Stop generating (Esc)"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              className={`flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 ${
                !currentMessage.trim()
                  ? "bg-slate-100 text-slate-300 cursor-not-allowed"
                  : "bg-navy-700 hover:bg-navy-600 text-white"
              }`}
              onClick={sendMessage}
              disabled={!currentMessage.trim()}
              aria-label="Send message"
            >
              <SendHorizonal className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(CourseAssistant);
