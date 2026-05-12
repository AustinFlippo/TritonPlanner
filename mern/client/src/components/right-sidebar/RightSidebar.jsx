import { useState, useRef, useEffect } from "react";
import CourseSearch from "./CourseSearch";
import CourseAssistant from "./CourseAssistant";
import CourseDetails from "./CourseDetails";
import CourseDetailOverlay from "../planner/CourseDetailOverlay";
import { debounce } from "lodash";

const SectionHeader = ({ label }) => (
  <div
    className="flex items-center px-3 flex-shrink-0"
    style={{ height: '34px', background: '#003366' }}
  >
    <span style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '0.5px', color: 'white' }}>
      {label}
    </span>
  </div>
);

const RightSidebar = ({ selectedCourse, onDismissDetail, parsedCourseData }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isCourseLoading, setIsCourseLoading] = useState(false);
  const [selectedSearchCourse, setSelectedSearchCourse] = useState(null);

  const [currentMessage, setCurrentMessage] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const [rightSidebarWidth, setRightSidebarWidth] = useState(300);
  const [searchHeight, setSearchHeight] = useState(window.innerHeight * 0.55);

  const chatEndRef = useRef(null);

  const handleSearch = async (query) => {
    if (!query.trim()) { setSearchResults([]); return; }
    try {
      setIsCourseLoading(true);
      const response = await fetch("http://localhost:5050/search-courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const data = await response.json();
      setSearchResults(data.results.map((course) => ({
        ...course,
        credits: isNaN(Number(course.credits)) ? 0 : Number(course.credits),
      })));
    } catch (error) {
    } finally {
      setIsCourseLoading(false);
    }
  };

  const debouncedSearch = debounce(handleSearch, 500);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleDragStart = (e, course) => {
    e.dataTransfer.setData("course", JSON.stringify(course));
    e.dataTransfer.setData("isFromSidebar", "true");
  };

  const sendMessage = async () => {
    if (!currentMessage.trim()) return;
    const userMessage = { role: "user", content: currentMessage };
    setChatMessages((prev) => [...prev, userMessage]);
    setCurrentMessage("");
    setIsLoading(true);
    try {
      const response = await fetch("http://localhost:5050/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: currentMessage, thread_id: "default-thread" }),
      });
      const data = await response.json();
      let assistantContent;
      if (data.error) {
        assistantContent = `Error: ${data.error}`;
      } else if (data.messages?.length > 0) {
        const aiMessage = data.messages.filter((msg) => msg.type === "ai").pop();
        assistantContent = aiMessage?.content || "No response";
      } else if (data.content) {
        assistantContent = data.content;
      } else if (data.response) {
        assistantContent = data.response;
      } else {
        assistantContent = "No response received";
      }
      setChatMessages((prev) => [...prev, { role: "assistant", content: assistantContent }]);
    } catch (err) {
      setChatMessages((prev) => [...prev, { role: "assistant", content: "Sorry, something went wrong." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div className="relative bg-white flex flex-col h-full flex-shrink-0" style={{ width: `${rightSidebarWidth}px` }}>
      {/* Resize handle on left edge */}
      <div
        className="absolute top-0 left-0 h-full w-1 bg-gray-300 hover:bg-gray-400 cursor-ew-resize z-10"
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startWidth = rightSidebarWidth;
          const onMove = (moveEvent) => {
            const delta = startX - moveEvent.clientX;
            setRightSidebarWidth(Math.max(250, Math.min(500, startWidth + delta)));
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
      />

      {/* Course detail overlay — shown when a planner card is clicked */}
      {selectedCourse && (
        <CourseDetailOverlay
          course={selectedCourse}
          parsedCourseData={parsedCourseData}
          onDismiss={onDismissDetail}
        />
      )}

      {/* Search panel */}
      <div className="flex flex-col flex-shrink-0" style={{ height: `${searchHeight}px` }}>
        <SectionHeader label="COURSE SEARCH" />
        <div className="overflow-y-auto flex-1">
          {selectedSearchCourse ? (
            <CourseDetails course={selectedSearchCourse} onBack={() => setSelectedSearchCourse(null)} />
          ) : (
            <CourseSearch
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              setSearchResults={setSearchResults}
              searchResults={searchResults}
              handleDragStart={handleDragStart}
              handleDragEnd={() => {}}
              isCourseLoading={isCourseLoading}
              debouncedSearch={debouncedSearch}
              onCourseDoubleClick={(course) => setSelectedSearchCourse(course)}
            />
          )}
        </div>
      </div>

      {/* Divider / resize handle between search and chat */}
      <div
        className="flex-shrink-0 cursor-row-resize flex items-center justify-center"
        style={{ height: '6px', background: '#e2e8f0' }}
        onMouseDown={(e) => {
          e.preventDefault();
          const startY = e.clientY;
          const startHeight = searchHeight;
          const onMove = (moveEvent) => {
            const delta = moveEvent.clientY - startY;
            setSearchHeight(Math.max(100, Math.min(500, startHeight + delta)));
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
          };
          document.body.style.cursor = 'row-resize';
          document.body.style.userSelect = 'none';
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
      >
        <div style={{ width: '24px', height: '2px', borderRadius: '1px', background: '#94a3b8' }} />
      </div>

      {/* Chat panel */}
      <div className="flex flex-col flex-1 min-h-0">
        <SectionHeader label="AI ASSISTANT" />
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <CourseAssistant
            chatMessages={chatMessages}
            currentMessage={currentMessage}
            setCurrentMessage={setCurrentMessage}
            isLoading={isLoading}
            sendMessage={sendMessage}
            chatEndRef={chatEndRef}
            onKeyPress={handleKeyPress}
          />
        </div>
      </div>
    </div>
  );
};

export default RightSidebar;
