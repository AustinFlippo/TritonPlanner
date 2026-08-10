import React, { useState } from "react";
import { SendHorizonal, Check, TriangleAlert, Sparkles, Maximize2, Minimize2 } from "lucide-react";

const SUGGESTIONS = [
  "What are the prerequisites for CSE 100?",
  "Which quarters is DSC 80 offered?",
  "Plan out my remaining requirements",
];

const CourseAssistant = ({
    chatMessages,
    currentMessage,
    setCurrentMessage,
    isLoading,
    sendMessage,
    chatEndRef,
    onKeyPress,
    onApplyPlan,
    expandState,
    onToggleExpand
  }) => {
    // Indexes of messages whose plan has been applied to the grid
    const [appliedPlans, setAppliedPlans] = useState(new Set());

    const handleApply = (msg, index) => {
      if (onApplyPlan && msg.proposedSchedule) {
        onApplyPlan(msg.proposedSchedule);
        setAppliedPlans((prev) => new Set(prev).add(index));
      }
    };
    return (
      <div className="flex flex-col h-full bg-white">
        {/* Panel header */}
        <div className="h-11 px-4 flex items-center justify-between border-b border-slate-200 flex-shrink-0">
          <h3 className="panel-heading">Course Assistant</h3>
          <button
            className="p-1 rounded text-slate-400 hover:text-navy-600 hover:bg-slate-100 transition-colors"
            onClick={onToggleExpand}
            title={expandState === "expanded" ? "Restore side panel (Esc)" : "Expand assistant"}
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
                  <div className="whitespace-pre-wrap">{msg.content}</div>

                  {/* Proposed schedule preview + apply */}
                  {msg.placements?.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 text-slate-500">
                        Proposed schedule
                      </div>
                      {msg.placements.map((p) => (
                        <div key={p.label} className="text-xs mb-1 text-slate-600">
                          <span className="font-semibold text-slate-700">{p.label}:</span>{" "}
                          {p.courses.join(", ")}
                        </div>
                      ))}
                      {msg.warnings?.length > 0 && (
                        <div className="mt-1.5 space-y-1">
                          {msg.warnings.map((w, wi) => (
                            <div key={wi} className="flex items-start gap-1 text-xs text-amber-700">
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
                </div>
              ))}
              {isLoading && (
                <div className="bg-white border border-slate-200 px-3 py-2.5 rounded-xl rounded-bl-sm max-w-[85%] shadow-card">
                  <div className="flex space-x-1.5">
                    <div className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-bounce"></div>
                    <div className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-bounce delay-75"></div>
                    <div className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-bounce delay-150"></div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="p-3 border-t border-slate-200 bg-white">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Ask about courses…"
              className="flex-grow px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-navy-400 focus:ring-2 focus:ring-navy-100 transition-colors"
              value={currentMessage}
              onChange={(e) => setCurrentMessage(e.target.value)}
              onKeyPress={onKeyPress}
              disabled={isLoading}
            />
            <button
              className={`flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 ${
                isLoading || !currentMessage.trim()
                  ? "bg-slate-100 text-slate-300 cursor-not-allowed"
                  : "bg-navy-700 hover:bg-navy-600 text-white"
              }`}
              onClick={sendMessage}
              disabled={isLoading || !currentMessage.trim()}
              aria-label="Send message"
            >
              <SendHorizonal className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  };


export default React.memo(CourseAssistant);
