import React, { useRef, useEffect } from "react";

const CourseAssistant = ({
    chatMessages,
    currentMessage,
    setCurrentMessage,
    isLoading,
    sendMessage,
    chatEndRef,
    onKeyPress
  }) => {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="bg-blue-500 text-white p-2">
          <h3 className="font-bold ml-2">Course Assistant</h3>
        </div>
  
        {/* Scrollable chat messages */}
        <div className="flex-grow p-3 overflow-y-auto bg-gray-50">
          {chatMessages.length === 0 ? (
            <div className="text-center text-gray-500 mt-4">
              <p>Ask me anything about courses!</p>
              <p className="text-sm mt-2">For example:</p>
              <ul className="text-sm mt-1 text-blue-500">
                <li className="cursor-pointer hover:underline" onClick={() => setCurrentMessage("What prerequisites do I need for CS301?")}>
                  What prerequisites do I need for CS301?
                </li>
                <li className="cursor-pointer hover:underline mt-1" onClick={() => setCurrentMessage("Which terms is Math 201 offered in?")}>
                  Which terms is Math 201 offered in?
                </li>
                <li className="cursor-pointer hover:underline mt-1" onClick={() => setCurrentMessage("Suggest courses for data science as a first year")}>
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
  
        {/* Input area */}
        <div className="p-2 border-t">
          <div className="flex">
            <input
              type="text"
              placeholder="Type your question here..."
              className="flex-grow p-2 border rounded-l focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={currentMessage}
              onChange={(e) => setCurrentMessage(e.target.value)}
              onKeyPress={onKeyPress}
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
    );
  };
  

export default React.memo(CourseAssistant);
