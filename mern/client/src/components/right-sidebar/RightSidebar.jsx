import React, { useState, useRef, useEffect } from "react";
import CourseSearch from "./CourseSearch";
import CourseAssistant from "./CourseAssistant";
import CourseDetails from "./CourseDetails";
import { debounce } from "lodash";

const RightSidebar = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isCourseLoading, setIsCourseLoading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState(null);

  const [currentMessage, setCurrentMessage] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchSectionHeight, setSearchSectionHeight] = useState(50);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const chatEndRef = useRef(null);

  const handleSearch = async (query) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      setIsCourseLoading(true);

      const response = await fetch("http://localhost:5050/search-courses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        await response.text(); // grab server error content
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      setSearchResults(
        data.results.map((course) => ({
          ...course,
          credits: isNaN(Number(course.credits)) ? 0 : Number(course.credits),
        }))
      );
    } catch (error) {
    } finally {
      setIsCourseLoading(false);
    }
  };
  const debouncedSearch = debounce(handleSearch, 500);

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
    if (!currentMessage.trim()) return;

    const userMessage = { role: "user", content: currentMessage };
    setChatMessages((prev) => [...prev, userMessage]);
    setCurrentMessage("");
    setIsLoading(true);

    try {
      const response = await fetch("http://localhost:5050/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: currentMessage,
          thread_id: "default-thread",
        }),
      });

      const data = await response.json();

      // Extract the actual content from the response
      let assistantContent;
      if (data.error) {
        assistantContent = `Error: ${data.error}`;
      } else if (data.messages?.length > 0) {
        // Find the last AI message
        const aiMessage = data.messages.filter((msg) => msg.type === "ai").pop();
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
        },
      ]);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, something went wrong. Try again later.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div
      className="relative bg-white shadow"
      style={{ width: `${rightSidebarWidth}px` }}
    >
      {/* Resize handle on the left side -- Divider between planner and Right Side Bar */}
      <div
        className="absolute top-0 left-0 h-full w-1 bg-gray-300 hover:bg-gray-400 cursor-ew-resize z-10"
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

      <div className="flex flex-col h-full min-h-0">
        {/* Course search area */}
        <div
          style={{ height: `${searchSectionHeight}%` }}
          className="flex-shrink-0"
        >
          <div className="h-full overflow-y-auto">
            {selectedCourse ? (
              <CourseDetails
                course={selectedCourse}
                onBack={() => setSelectedCourse(null)}
              />
            ) : (
              <CourseSearch
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                setSearchResults={setSearchResults}
                searchResults={searchResults}
                handleDragStart={handleDragStart}
                handleDragEnd={handleDragEnd}
                isCourseLoading={isCourseLoading}
                debouncedSearch={debouncedSearch}
                onCourseDoubleClick={(course) => setSelectedCourse(course)}
              />
            )}
          </div>
        </div>

        {/* Divider between search and chat */}
        <div
          className="bg-gray-300 h-1 cursor-ns-resize"
          onMouseDown={(e) => {
            e.preventDefault();
            const startY = e.clientY;
            const startHeight = searchSectionHeight;

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
            };

            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
          }}
        />

        {/* Course assistant chat area */}
        <div className="flex flex-col flex-grow overflow-hidden">
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
