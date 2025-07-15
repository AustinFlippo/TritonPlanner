import React, { useState, useRef, useEffect } from 'react';
import { useMobileUI } from '../context/MobileUIContext';
import CourseSearch from './right-sidebar/CourseSearch';
import CourseAssistant from './right-sidebar/CourseAssistant';
import CourseDetails from './right-sidebar/CourseDetails';
import { debounce } from 'lodash';
import { EXPRESS_URL } from '../config.js';

const ActionDrawer = () => {
  const { isActionDrawerOpen, closeAllOverlays } = useMobileUI();
  
  // Course search state
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isCourseLoading, setIsCourseLoading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState(null);

  // Chat state
  const [currentMessage, setCurrentMessage] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef(null);

  // Search functionality
  const handleSearch = async (query) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      setIsCourseLoading(true);
      const response = await fetch(`${EXPRESS_URL}/search-courses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        await response.text();
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
      console.error('Search error:', error);
    } finally {
      setIsCourseLoading(false);
    }
  };

  const debouncedSearch = debounce(handleSearch, 500);

  // Chat functionality
  const sendMessage = async () => {
    if (!currentMessage.trim()) return;

    const userMessage = { role: "user", content: currentMessage };
    setChatMessages((prev) => [...prev, userMessage]);
    setCurrentMessage("");
    setIsLoading(true);

    try {
      const response = await fetch(`${EXPRESS_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: currentMessage,
          thread_id: "default-thread",
        }),
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

  const handleDragStart = (e, course) => {
    e.dataTransfer.setData("course", JSON.stringify(course));
    e.dataTransfer.setData("isFromSidebar", "true");
  };

  const handleDragEnd = () => {};


  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages]);

  return (
    <div
      className={`
        fixed bottom-0 left-0 right-0 w-full h-1/2 bg-white border-t border-gray-200 shadow-2xl
        transform transition-transform duration-300 ease-in-out z-40
        flex flex-col /* Make the whole drawer a flex column */
        ${isActionDrawerOpen ? 'translate-y-0' : 'translate-y-full'}
        md:hidden
      `}
    >
      {/* Header with close button - This is the first flex item, it does not grow */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
        <h2 className="text-lg font-semibold text-gray-800">Course Search & Assistant</h2>
        <button
          onClick={closeAllOverlays}
          className="p-2 rounded-lg hover:bg-gray-200 transition-colors"
          aria-label="Close action drawer"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 
        * MAIN CONTENT AREA: This is the second flex item.
        * - `flex-1` makes it take up ALL remaining vertical space in the drawer.
        * - `flex` makes it a flex container for its two children columns.
        * - `min-h-0` is the critical fix to allow its children to scroll properly.
        * - DndContext is now handled at MainLayout level
      */}
      <div className="flex flex-1 min-h-0 w-full">
        
        {/* 
          * Left Column - Passes props directly to CourseAssistant.
          * The component itself will now handle its own layout.
          * `min-w-0` is added to prevent content overflow issues in flex children.
        */}
        <div className="w-1/2 border-r border-gray-200 min-w-0 overflow-hidden">
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

        {/* 
          * Right Column - Manages CourseSearch and CourseDetails visibility.
          * It is a flex column to correctly manage its children.
          * `min-w-0` is added here as well.
        */}
        <div className="w-1/2 flex flex-col min-w-0 overflow-hidden">
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
    </div>
  );
};

export default ActionDrawer;