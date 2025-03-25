import React, { useState, useEffect, useRef } from "react";

const ChatBox = ({ chatHeight, setChatHeight, isChatMinimized, setIsChatMinimized }) => {

    // Chat feature state
    const [chatMessages, setChatMessages] = useState([]);
    const [currentMessage, setCurrentMessage] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const chatEndRef = useRef(null);
    const dragHandleRef = useRef(null);

    // Scroll to bottom of chat when new messages arrive
    useEffect(() => {
        if (chatEndRef.current) {
        chatEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [chatMessages]);

    // Toggle chat minimize/maximize
    const toggleChatMinimize = () => {
        setIsChatMinimized(!isChatMinimized);
    };

    // Simple function to increase chat height
    const increaseHeight = () => {
        setChatHeight((prev) => Math.min(prev + 50, 800));
    };

    // Simple function to decrease chat height
    const decreaseHeight = () => {
        setChatHeight((prev) => Math.max(prev - 50, 100));
    };

    // Send message to FastAPI backend
    const sendMessage = async () => {
    if (!currentMessage.trim()) return;

    const userMessage = { role: "user", content: currentMessage };
    setChatMessages((prevMessages) => [...prevMessages, userMessage]);
    setCurrentMessage("");
    setIsLoading(true);

    try {
        // Call the FastAPI backend
        const response = await fetch("http://0.0.0.0:8000/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            message: currentMessage,
            thread_id: "default-thread",
        }),
        });

        if (!response.ok) {
        throw new Error("Failed to get response from assistant");
        }

        // Parse the response from the API
        const data = await response.json();

        // Process the response based on the structure from your API
        let assistantContent = "";

        // If the response is in the format you showed in the example
        if (data.messages && Array.isArray(data.messages)) {
        // Find the last AI message in the messages array
        const aiMessages = data.messages.filter((msg) => msg.type === "ai");
        if (aiMessages.length > 0) {
            // Get the content from the last AI message
            assistantContent = aiMessages[aiMessages.length - 1].content;
        }
        } else {
        // Fallback for other response formats
        assistantContent =
            data.content || data.response || JSON.stringify(data);
        }

        const assistantMessage = {
        role: "assistant",
        content: assistantContent,
        };

        setChatMessages((prevMessages) => [...prevMessages, assistantMessage]);
    } catch (error) {
        console.error("Error communicating with backend:", error);
        setChatMessages((prevMessages) => [
        ...prevMessages,
        {
            role: "assistant",
            content: "Sorry, I encountered an error. Please try again later.",
        },
        ]);
    } finally {
        setIsLoading(false);
    }
    };

    // Handle key press in chat input
    const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
    };

    return (
        <div className="fixed bottom-0 left-0 w-full z-50 bg-white border-t border-gray-300 shadow-lg">
        {/* Resize handle - Direct implementation with inline event handlers */}
        {!isChatMinimized && (
        <div
            className="w-full h-10 bg-gray-300 hover:bg-blue-200 cursor-ns-resize flex flex-col items-center justify-center transition-colors select-none border-b border-gray-400"
            onMouseDown={(e) => {
            const startY = e.clientY;
            const startHeight = chatHeight;

            const handleMouseMove = (moveEvent) => {
                const deltaY = startY - moveEvent.clientY;
                const newHeight = Math.max(
                100,
                Math.min(800, startHeight + deltaY)
                );
                setChatHeight(newHeight);
            };

            const handleMouseUp = () => {
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
            };

            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
            }}
        >
            <div className="flex flex-col items-center justify-center">
            <div className="w-32 h-2 bg-blue-600 rounded-full mb-1"></div>
            <div className="text-xs font-bold text-gray-600">
                DRAG TO RESIZE
            </div>
            </div>
        </div>
        )}

        <div
        className="flex items-center justify-between bg-blue-500 text-white p-2 cursor-pointer"
        onClick={toggleChatMinimize}
        >
        <h3 className="font-bold ml-2">Course Assistant</h3>
        <div className="flex items-center">
            <span className="mr-2">
            {isChatMinimized ? "Show Chat" : "Minimize"}
            </span>
            <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-5 w-5 transform ${
                isChatMinimized ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
            />
            </svg>
        </div>
        </div>

        {!isChatMinimized && (
        <div className="flex flex-col" style={{ height: `${chatHeight}px` }}>
            <div className="flex-grow p-3 overflow-y-auto bg-gray-50">
            {chatMessages.length === 0 ? (
                <div className="text-center text-gray-500 mt-4">
                <p>Ask me anything about courses!</p>
                <p className="text-sm mt-2">For example:</p>
                <ul className="text-sm mt-1 text-blue-500">
                    <li
                    className="cursor-pointer hover:underline"
                    onClick={() =>
                        setCurrentMessage(
                        "What prerequisites do I need for CS301?"
                        )
                    }
                    >
                    What prerequisites do I need for CS301?
                    </li>
                    <li
                    className="cursor-pointer hover:underline mt-1"
                    onClick={() =>
                        setCurrentMessage("Which terms is Math 201 offered in?")
                    }
                    >
                    Which terms is Math 201 offered in?
                    </li>
                    <li
                    className="cursor-pointer hover:underline mt-1"
                    onClick={() =>
                        setCurrentMessage(
                        "Suggest courses for data science as a first year"
                        )
                    }
                    >
                    Suggest courses for data science as a first year
                    </li>
                </ul>
                </div>
            ) : (
                <div className="space-y-3">
                {chatMessages.map((msg, index) => (
                    <div
                    key={index}
                    className={`p-2 rounded-lg max-w-[85%] ${
                        msg.role === "user"
                        ? "ml-auto bg-blue-100 text-blue-800"
                        : "bg-gray-200 text-gray-800"
                    }`}
                    >
                    {msg.content}
                    </div>
                ))}
                {isLoading && (
                    <div className="bg-gray-200 text-gray-800 p-2 rounded-lg max-w-[85%]">
                    <div className="flex space-x-2">
                        <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce"></div>
                        <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce delay-75"></div>
                        <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce delay-150"></div>
                    </div>
                    </div>
                )}
                <div ref={chatEndRef} />
                </div>
            )}
            </div>

            <div className="p-2 border-t">
            <div className="flex">
                <input
                type="text"
                placeholder="Type your question here..."
                className="flex-grow p-2 border rounded-l focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={currentMessage}
                onChange={(e) => setCurrentMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={isLoading}
                />
                <button
                className={`px-4 py-2 rounded-r ${
                    isLoading || !currentMessage.trim()
                    ? "bg-gray-300 cursor-not-allowed"
                    : "bg-blue-500 hover:bg-blue-600 text-white"
                }`}
                onClick={sendMessage}
                disabled={isLoading || !currentMessage.trim()}
                >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                </svg>
                </button>
            </div>
            </div>
        </div>
        )}
      </div>
    );
};

export default ChatBox;
