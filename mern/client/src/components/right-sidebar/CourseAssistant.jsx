// import React, { useRef, useEffect } from "react";

// const CourseAssistant = ({
//     chatMessages,
//     currentMessage,
//     setCurrentMessage,
//     isLoading,
//     sendMessage,
//     chatEndRef,
//     onKeyPress
//   }) => {
//     return (
//       <div className="flex flex-col h-full bg-gray-100">
//         {/* Chat History Wrapper - Takes all available space and scrolls */}
//         <div className="flex-1 overflow-y-auto p-4">
//           {chatMessages.length === 0 ? (
//             <div className="text-center text-gray-500 mt-4">
//               <p>Ask me anything about courses!</p>
//               <p className="text-sm mt-2">For example:</p>
//               <ul className="text-sm mt-1 text-blue-500">
//                 <li className="cursor-pointer hover:underline" onClick={() => setCurrentMessage("What prerequisites do I need for DSC80?")}>
//                   What prerequisites do I need for DSC80?
//                 </li>
//                 <li className="cursor-pointer hover:underline mt-1" onClick={() => setCurrentMessage("Which terms is CCE1 offered in?")}>
//                   Which terms is CCE1 offered in?
//                 </li>
//                 <li className="cursor-pointer hover:underline mt-1" onClick={() => setCurrentMessage("Suggest courses for data science as a first year")}>
//                   Suggest courses for data science as a first year
//                 </li>
//               </ul>
//             </div>
//           ) : (
//             <div className="space-y-3">
//               {chatMessages.map((msg, index) => (
//                 <div
//                   key={index}
//                   className={`p-2 rounded-lg max-w-[85%] text-sm font-medium whitespace-pre-line ${
//                     msg.role === "user"
//                       ? "ml-auto bg-blue-100 text-blue-800"
//                       : "bg-gray-200 text-gray-800"
//                   }`}
//                 >
//                   {msg.content}
//                 </div>
//               ))}
//               {isLoading && (
//                 <div className="bg-gray-200 text-gray-800 p-2 rounded-lg max-w-[85%] text-sm font-medium whitespace-pre-line">
//                   <div className="flex space-x-2">
//                     <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce"></div>
//                     <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce delay-75"></div>
//                     <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce delay-150"></div>
//                   </div>
//                 </div>
//               )}
//               <div ref={chatEndRef} />
//             </div>
//           )}
//         </div>

//         {/* Chat Input Form - Fixed at bottom with natural height */}
//         <div className="p-2 border-t border-gray-300 bg-white">
//           <div className="flex">
//             <input
//               type="text"
//               placeholder="Type your question here..."
//               className="flex-grow p-2 border rounded-l focus:outline-none focus:ring-2 focus:ring-blue-500"
//               value={currentMessage}
//               onChange={(e) => setCurrentMessage(e.target.value)}
//               onKeyPress={onKeyPress}
//               disabled={isLoading}
//             />
//             <button
//               className={`px-4 py-2 rounded-r ${
//                 isLoading || !currentMessage.trim()
//                   ? "bg-gray-300 cursor-not-allowed"
//                   : "bg-blue-500 hover:bg-blue-600 text-white"
//               }`}
//               onClick={sendMessage}
//               disabled={isLoading || !currentMessage.trim()}
//             >
//               <svg
//                 xmlns="http://www.w3.org/2000/svg"
//                 className="h-5 w-5"
//                 fill="none"
//                 viewBox="0 0 24 24"
//                 stroke="currentColor"
//               >
//                 <path
//                   strokeLinecap="round"
//                   strokeLinejoin="round"
//                   strokeWidth={2}
//                   d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
//                 />
//               </svg>
//             </button>
//           </div>
//         </div>
//       </div>
//     );
//   };
  

// export default React.memo(CourseAssistant);
import React, { useEffect } from "react";

const CourseAssistant = ({
    chatMessages,
    currentMessage,
    setCurrentMessage,
    isLoading,
    sendMessage,
    chatEndRef,
    onKeyPress
  }) => {
    
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages, isLoading, chatEndRef]);

    return (
      // MAIN CONTAINER: flex flex-col and h-full are ESSENTIAL.
      // It will now correctly inherit the constrained height from its parent in ActionDrawer.
      <div className="flex flex-col h-full bg-gray-100 w-full max-w-full overflow-hidden">
        
        {/* HEADER: A non-growing part of the flex layout. */}
        <div className="p-3 bg-gray-50 border-b border-gray-200 flex-shrink-0">
          <h3 className="font-semibold text-gray-700">AI Assistant</h3>
        </div>

        {/* CHAT HISTORY WRAPPER: The growing, scrollable part. */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          <div className="space-y-3">
            {chatMessages.length === 0 ? (
              <div className="text-center text-gray-500 mt-4">
                <p>Ask me anything about courses!</p>
                <p className="text-sm mt-2">For example:</p>
                <ul className="text-sm mt-1 text-blue-500">
                  <li className="cursor-pointer hover:underline" onClick={() => setCurrentMessage("What prerequisites do I need for DSC80?")}>
                    What prerequisites do I need for DSC80?
                  </li>
                  <li className="cursor-pointer hover:underline mt-1" onClick={() => setCurrentMessage("Which terms is CCE1 offered in?")}>
                    Which terms is CCE1 offered in?
                  </li>
                  <li className="cursor-pointer hover:underline mt-1" onClick={() => setCurrentMessage("Suggest courses for data science as a first year")}>
                    Suggest courses for data science as a first year
                  </li>
                </ul>
              </div>
            ) : (
              chatMessages.map((msg, index) => (
                <div
                  key={index}
                  className={`p-2 rounded-lg max-w-[85%] text-sm font-medium whitespace-pre-line ${
                    msg.role === "user"
                      ? "ml-auto bg-blue-100 text-blue-800"
                      : "bg-gray-200 text-gray-800"
                  }`}
                >
                  {msg.content}
                </div>
              ))
            )}
            {isLoading && (
              <div className="bg-gray-200 text-gray-800 p-2 rounded-lg max-w-[85%] text-sm font-medium whitespace-pre-line">
                <div className="flex space-x-2">
                  <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce"></div>
                  <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce delay-75"></div>
                  <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce delay-150"></div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* CHAT INPUT FORM: The non-growing footer. */}
        <div className="p-2 border-t border-gray-300 bg-white flex-shrink-0 w-full">
          <div className="flex w-full max-w-full">
            <input
              type="text"
              placeholder="Type your question here..."
              className="flex-grow p-2 border rounded-l focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
              value={currentMessage}
              onChange={(e) => setCurrentMessage(e.target.value)}
              onKeyPress={onKeyPress}
              disabled={isLoading}
            />
            <button
              className={`px-3 py-2 rounded-r flex-shrink-0 ${
                isLoading || !currentMessage.trim()
                  ? "bg-gray-300 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600 text-white"
              }`}
              onClick={sendMessage}
              disabled={isLoading || !currentMessage.trim()}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  };
  
export default React.memo(CourseAssistant);