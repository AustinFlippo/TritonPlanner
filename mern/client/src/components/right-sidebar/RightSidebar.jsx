import React, { useState, useRef, useEffect, useMemo } from "react";
import CourseSearch from "./CourseSearch";
import CourseAssistant from "./CourseAssistant";
import CourseDetails from "./CourseDetails";
import { debounce } from "lodash";
import { useAuth } from "../../context/AuthContext";
import {
  extractUnmetRequirements,
  extractTakenCourses,
} from "../../utils/recommendations";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5050";

const RightSidebar = ({
  parsedCourseData,
  schedule,
  onApplyPlan,
  expandedPanel = null,
  onExpandedPanelChange,
  layoutExpanded = false,
}) => {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchError, setSearchError] = useState(null);
  const [isCourseLoading, setIsCourseLoading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState(null);
  // Grad courses hidden by default — they're 40% of the catalog and noise
  // for most planners
  const [filters, setFilters] = useState({
    levels: ["lower", "upper"],
    quarters: [],
    depts: [],
  });
  const [departments, setDepartments] = useState([]);

  const [currentMessage, setCurrentMessage] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchSectionHeight, setSearchSectionHeight] = useState(50);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const chatEndRef = useRef(null);
  // Sync guard — isLoading state alone can miss a double Enter/click
  const isSendingRef = useRef(false);

  const toggleExpandedPanel = (panel) => {
    if (!onExpandedPanelChange) return;
    onExpandedPanelChange((current) => (current === panel ? null : panel));
  };

  // Latest filters live in a ref so the stable debounced function always
  // searches with current filter state
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const handleSearch = async (query) => {
    const activeFilters = filtersRef.current;
    // Nothing typed and no department picked -> department browser is shown
    if (!query.trim() && activeFilters.depts.length === 0) {
      setSearchResults([]);
      setSearchTotal(0);
      return;
    }
    try {
      setIsCourseLoading(true);
      setSearchError(null);

      const response = await fetch(`${API_URL}/search-courses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, filters: activeFilters }),
      });

      if (!response.ok) {
        await response.text(); // grab server error content
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      setSearchTotal(data.total ?? data.results.length);
      setSearchResults(
        data.results.map((course) => ({
          ...course,
          credits: isNaN(Number(course.credits)) ? 0 : Number(course.credits),
        }))
      );
    } catch (error) {
      setSearchResults([]);
      setSearchTotal(0);
      setSearchError("Course search is unavailable right now.");
    } finally {
      setIsCourseLoading(false);
    }
  };

  // Stable debouncer (recreating it per render meant no keystroke was ever
  // actually debounced); reads handleSearch through a ref for fresh state
  const handleSearchRef = useRef(handleSearch);
  handleSearchRef.current = handleSearch;
  const debouncedSearch = useMemo(
    () => debounce((q) => handleSearchRef.current(q), 300),
    []
  );
  useEffect(() => () => debouncedSearch.cancel(), [debouncedSearch]);

  // Filter changes re-run the current search immediately (no debounce)
  const searchTermRef = useRef(searchTerm);
  searchTermRef.current = searchTerm;
  useEffect(() => {
    handleSearchRef.current(searchTermRef.current);
  }, [filters]);

  // Department list for the browse view; counts respect the level filter
  useEffect(() => {
    const levels = filters.levels.join(",");
    fetch(`${API_URL}/search-courses/departments?levels=${levels}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => setDepartments(data.departments || []))
      .catch(() => setDepartments([]));
  }, [filters.levels]);

  // "Recommended for you": unmet audit requirements resolved to real catalog
  // courses (minus anything taken or already planned), refreshed whenever the
  // audit or the planner grid changes
  const [recommendations, setRecommendations] = useState([]);
  useEffect(() => {
    const unmet = extractUnmetRequirements(parsedCourseData?.sections);
    const withCodes = unmet.filter((r) => r.codes.length > 0);
    if (withCodes.length === 0) {
      setRecommendations([]);
      return;
    }
    const taken = extractTakenCourses(parsedCourseData?.sections, schedule);
    const allCodes = [...new Set(withCodes.flatMap((r) => r.codes))];
    let cancelled = false;
    fetch(`${API_URL}/search-courses/recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: allCodes, taken }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (cancelled) return;
        // Group resolved courses back under their requirement titles
        const byToken = new Map();
        for (const res of data.results || []) {
          if (!byToken.has(res.token)) byToken.set(res.token, []);
          // Same credits normalization the search path applies ("N/A" -> 0)
          byToken.get(res.token).push({
            ...res,
            course: {
              ...res.course,
              credits: isNaN(Number(res.course.credits))
                ? 0
                : Number(res.course.credits),
            },
          });
        }
        setRecommendations(
          withCodes
            .map((req) => ({
              title: req.title,
              needs: req.needs,
              courses: req.codes.flatMap((code) => byToken.get(code) || []),
            }))
            .filter((req) => req.courses.length > 0)
        );
      })
      .catch(() => {
        if (!cancelled) setRecommendations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [parsedCourseData, schedule]);

  // Open the details pane for a course we only know by id (unlocks chips)
  const openCourseById = async (courseId) => {
    try {
      const response = await fetch(`${API_URL}/search-courses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: courseId, filters: {} }),
      });
      const data = await response.json();
      const match =
        data.results?.find((c) => c.course_id === courseId) || data.results?.[0];
      if (match) setSelectedCourse(match);
    } catch {
      // details pane just stays where it is
    }
  };

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages]);

  const handleDragStart = (e, course) => {
    e.dataTransfer.setData("course", JSON.stringify(course));
    e.dataTransfer.setData("isFromSidebar", "true");
  };

  const handleDragEnd = () => {};

  const sendMessage = async () => {
    if (!currentMessage.trim() || isSendingRef.current) return;

    const messageText = currentMessage;
    const userMessage = { role: "user", content: messageText };
    isSendingRef.current = true;
    setChatMessages((prev) => [...prev, userMessage]);
    setCurrentMessage("");
    setIsLoading(true);

    try {
      // Include planner context (audit + current grid) so the backend can
      // answer personally and propose schedules for the grid
      const hasAudit = parsedCourseData?.sections?.length > 0;
      const hasCourses =
        Array.isArray(schedule) &&
        schedule.some((year) =>
          ["fall", "winter", "spring"].some((term) =>
            (year?.[term] || []).some((c) => c && c.course_id)
          )
        );

      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: messageText,
          // Per-user chat thread when signed in, so conversations don't mix
          thread_id: user ? `user-${user.id}` : "default-thread",
          ...(hasAudit || hasCourses
            ? { audit_sections: parsedCourseData?.sections || [], schedule }
            : {}),
        }),
      });

      const data = await response.json();

      // Extract the actual content from the response
      let assistantContent;
      let aiMessage = null;
      if (data.error) {
        assistantContent = `Error: ${data.error}`;
      } else if (data.messages?.length > 0) {
        // Find the last AI message
        aiMessage = data.messages.filter((msg) => msg.type === "ai").pop();
        assistantContent = aiMessage?.content || "No response";
      } else if (data.content) {
        assistantContent = data.content;
      } else if (data.response) {
        assistantContent = data.response;
      } else {
        assistantContent = "No response received";
      }

      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: assistantContent,
          // Present when the backend proposed a schedule for the grid
          proposedSchedule: aiMessage?.proposed_schedule || null,
          placements: aiMessage?.placements || null,
          warnings: aiMessage?.warnings || null,
        },
      ]);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Sorry, something went wrong. Is the Express server running on port 5050?",
        },
      ]);
    } finally {
      isSendingRef.current = false;
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Near-fullscreen fills the workspace; docked width stays user-chosen
  const effectiveSidebarWidth = layoutExpanded
    ? "100%"
    : rightSidebarWidth;

  // Height/width transitions fight the column takeover and look broken —
  // only animate the search/chat split while both panels stay docked.
  const animateSplit =
    !isResizing && !layoutExpanded && expandedPanel === null;

  return (
    <div
      className="relative bg-white border-l border-slate-200 h-full"
      style={{
        width:
          typeof effectiveSidebarWidth === "string"
            ? effectiveSidebarWidth
            : `${effectiveSidebarWidth}px`,
      }}
    >
      {/* Resize handle on the left side -- Divider between planner and Right Side Bar */}
      {!layoutExpanded && (
        <div
          className="absolute top-0 left-0 h-full w-1 hover:bg-navy-300 cursor-ew-resize z-10 transition-colors"
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = rightSidebarWidth;

            const handleMouseMove = (moveEvent) => {
              const deltaX = startX - moveEvent.clientX;
              const newWidth = Math.max(250, Math.min(500, startWidth + deltaX));
              setRightSidebarWidth(newWidth);
            };

            const handleMouseUp = () => {
              document.removeEventListener("mousemove", handleMouseMove);
              document.removeEventListener("mouseup", handleMouseUp);
              setIsResizing(false);
            };

            setIsResizing(true);
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
          }}
        ></div>
      )}

      <div className="flex flex-col h-full min-h-0">
        {/* Course search area — fills almost everything when maximized;
            collapses to its h-11 header when chat is maximized. */}
        <div
          style={{
            height:
              expandedPanel === "search"
                ? "calc(100% - 2.75rem)"
                : expandedPanel === "chat"
                  ? "2.75rem"
                  : `${searchSectionHeight}%`,
            transition: animateSplit ? "height 200ms ease-out" : "none",
          }}
          className="flex-shrink-0 overflow-hidden"
        >
          <div className="h-full overflow-hidden">
            {selectedCourse ? (
              <CourseDetails
                course={selectedCourse}
                onBack={() => setSelectedCourse(null)}
                onSelectCourseId={openCourseById}
                apiUrl={API_URL}
                expandState={expandedPanel === "search" ? "expanded" : null}
                onToggleExpand={() => toggleExpandedPanel("search")}
              />
            ) : (
              <CourseSearch
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                searchResults={searchResults}
                searchTotal={searchTotal}
                searchError={searchError}
                filters={filters}
                setFilters={setFilters}
                departments={departments}
                handleDragStart={handleDragStart}
                handleDragEnd={handleDragEnd}
                isCourseLoading={isCourseLoading}
                debouncedSearch={debouncedSearch}
                onCourseDoubleClick={(course) => setSelectedCourse(course)}
                recommendations={recommendations}
                hasAudit={parsedCourseData?.sections?.length > 0}
                expandState={expandedPanel === "search" ? "expanded" : null}
                onToggleExpand={() => toggleExpandedPanel("search")}
              />
            )}
          </div>
        </div>

        {/* Divider between search and chat (hidden while a panel is maximized) */}
        {expandedPanel === null && (
          <div
            className="bg-slate-200 hover:bg-navy-300 h-1 cursor-ns-resize transition-colors"
            title="Drag to resize · double-click to reset"
            onDoubleClick={() => setSearchSectionHeight(50)}
            onMouseDown={(e) => {
              e.preventDefault();
              const startY = e.clientY;
              const startHeight = searchSectionHeight;
              setIsResizing(true);

              const handleMouseMove = (moveEvent) => {
                const deltaY = moveEvent.clientY - startY;
                const containerHeight = e.target.parentElement.offsetHeight;
                const newHeightPercent = Math.max(
                  20,
                  Math.min(80, startHeight + (deltaY / containerHeight) * 100)
                );
                setSearchSectionHeight(newHeightPercent);
              };

              const handleMouseUp = () => {
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
                setIsResizing(false);
              };

              document.addEventListener("mousemove", handleMouseMove);
              document.addEventListener("mouseup", handleMouseUp);
            }}
          />
        )}

        {/* Course assistant chat area — fills whatever the search area leaves,
            so it animates along with it. Collapsed = its h-11 header. */}
        <div className="flex flex-col flex-grow min-h-0 overflow-hidden">
          <CourseAssistant
            chatMessages={chatMessages}
            currentMessage={currentMessage}
            setCurrentMessage={setCurrentMessage}
            isLoading={isLoading}
            sendMessage={sendMessage}
            chatEndRef={chatEndRef}
            onKeyPress={handleKeyPress}
            onApplyPlan={onApplyPlan}
            expandState={expandedPanel === "chat" ? "expanded" : null}
            onToggleExpand={() => toggleExpandedPanel("chat")}
          />
        </div>
      </div>
    </div>
  );
};

export default RightSidebar;
