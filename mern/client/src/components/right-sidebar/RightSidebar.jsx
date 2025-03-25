import React, { useState, useRef, useEffect } from "react";
import CourseSearch from "./CourseSearch";
import CourseAssistant from "./CourseAssistant";

const RightSidebar = () => {

    const allCourses = [
        {
          id: "cs101",
          name: "Introduction to Computer Science",
          units: 4.0,
          department: "CS",
          prerequisites: [],
          offeredIn: ["fall", "winter", "spring"],
        },
        {
          id: "cs201",
          name: "Data Structures",
          units: 4.0,
          department: "CS",
          prerequisites: ["cs101"],
          offeredIn: ["winter", "spring"],
        },
        {
          id: "cs301",
          name: "Algorithms",
          units: 4.0,
          department: "CS",
          prerequisites: ["cs201", "math201"],
          offeredIn: ["fall", "spring"],
        },
        {
          id: "math101",
          name: "Calculus I",
          units: 4.0,
          department: "MATH",
          prerequisites: [],
          offeredIn: ["fall", "winter", "spring"],
        },
        {
          id: "math201",
          name: "Linear Algebra",
          units: 4.0,
          department: "MATH",
          prerequisites: ["math101"],
          offeredIn: ["winter"],
        },
        {
          id: "eng101",
          name: "Composition",
          units: 4.0,
          department: "ENG",
          prerequisites: [],
          offeredIn: ["fall", "winter", "spring"],
        },
        {
          id: "hist101",
          name: "World History",
          units: 4.0,
          department: "HIST",
          prerequisites: [],
          offeredIn: ["fall", "spring"],
        },
        {
          id: "phys101",
          name: "Physics I",
          units: 4.0,
          department: "PHYS",
          prerequisites: ["math101"],
          offeredIn: ["fall", "winter"],
        },
        {
          id: "chem101",
          name: "Chemistry I",
          units: 4.0,
          department: "CHEM",
          prerequisites: [],
          offeredIn: ["fall", "spring"],
        },
        {
          id: "bio101",
          name: "Biology I",
          units: 4.0,
          department: "BIO",
          prerequisites: [],
          offeredIn: ["winter", "spring"],
        },
        {
          id: "ld-bdaas",
          name: "LD BDAAS CORE",
          units: 4.0,
          department: "CORE",
          prerequisites: [],
          offeredIn: ["fall"],
        },
        {
          id: "breadth-ge",
          name: "Breadth GE",
          units: 4.0,
          department: "GE",
          prerequisites: [],
          offeredIn: ["fall", "winter", "spring"],
        },
        {
          id: "dei",
          name: "DEI",
          units: 4.0,
          department: "DEI",
          prerequisites: [],
          offeredIn: ["fall", "winter", "spring"],
        },
        {
          id: "cce1",
          name: "CCE 1",
          units: 4.0,
          department: "CCE",
          prerequisites: [],
          offeredIn: ["spring"],
        },
        {
          id: "elective",
          name: "Elective",
          units: 4.0,
          department: "ELEC",
          prerequisites: [],
          offeredIn: ["fall", "winter", "spring"],
        },
      ];

    useEffect(() => {
        localStorage.setItem("allCourses", JSON.stringify(allCourses));
      }, []);


  const [searchTerm, setSearchTerm] = useState("");
  const [filteredCourses, setFilteredCourses] = useState(allCourses);

  const [currentMessage, setCurrentMessage] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchSectionHeight, setSearchSectionHeight] = useState(50);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    const allCourses = JSON.parse(localStorage.getItem("allCourses")) || [];
    const filtered = allCourses.filter(
      (course) =>
        course.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        course.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        course.department.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredCourses(filtered);
  }, [searchTerm]);

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
        body: JSON.stringify({ message: currentMessage, thread_id: "default-thread" })
      });

      const data = await response.json();
      const assistantMessage = {
        role: "assistant",
        content: data.messages?.filter((msg) => msg.type === "ai").pop()?.content || "No response"
      };

      setChatMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, something went wrong. Try again later." }
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
      className="relative bg-white rounded-lg shadow"
      style={{ width: `${rightSidebarWidth}px` }}
    >
      {/* Resize handle on the left side */}
      <div
        className="absolute top-0 left-0 h-full w-2 bg-gray-300 hover:bg-blue-300 cursor-ew-resize z-10"
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

      <div className="flex flex-col h-screen">
        {/* Course search area */}
        <div style={{ height: `${searchSectionHeight}%` }} className="flex-shrink-0">
          <div className="h-full overflow-y-auto">
            <CourseSearch
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              filteredCourses={filteredCourses}
              handleDragStart={handleDragStart}
              handleDragEnd={handleDragEnd}
            />
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
