import React from "react";

const SUGGESTED_PROMPTS = [
  "What prereqs do I need for CSE 101?",
  "Which terms is MATH 20C offered?",
  "Suggest courses for a data science major",
];

const CourseAssistant = ({
  chatMessages,
  currentMessage,
  setCurrentMessage,
  isLoading,
  sendMessage,
  chatEndRef,
  onKeyPress,
}) => {
  return (
    <div className="flex flex-col h-full" style={{ background: '#f8fafc' }}>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {chatMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 pb-4">
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#e0f0ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0066cc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#003366', marginBottom: '2px' }}>Triton Assistant</div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Ask anything about UCSD courses</div>
            </div>
            <div className="flex flex-col gap-2 w-full">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setCurrentMessage(prompt)}
                  style={{
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    fontSize: '11px',
                    color: '#0066cc',
                    textAlign: 'left',
                    cursor: 'pointer',
                    lineHeight: 1.4,
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {chatMessages.map((msg, index) => (
              <div
                key={index}
                className="flex"
                style={{ justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
              >
                <div
                  style={msg.role === 'user' ? {
                    background: '#003366',
                    color: 'white',
                    borderRadius: '14px 14px 4px 14px',
                    padding: '8px 12px',
                    fontSize: '12px',
                    maxWidth: '82%',
                    lineHeight: 1.5,
                  } : {
                    background: 'white',
                    color: '#1e293b',
                    border: '1px solid #e2e8f0',
                    borderRadius: '14px 14px 14px 4px',
                    padding: '8px 12px',
                    fontSize: '12px',
                    maxWidth: '82%',
                    lineHeight: 1.5,
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex" style={{ justifyContent: 'flex-start' }}>
                <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '14px 14px 14px 4px', padding: '10px 14px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                  {[0, 150, 300].map((delay) => (
                    <div key={delay} style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#7db8e8', animation: `bounce 1s ${delay}ms infinite` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: '10px 10px 12px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '6px 6px 6px 12px' }}>
          <textarea
            rows={1}
            placeholder="Ask about courses…"
            value={currentMessage}
            onChange={(e) => {
              setCurrentMessage(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 96) + 'px';
            }}
            onKeyDown={onKeyPress}
            disabled={isLoading}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontSize: '12px',
              color: '#1e293b',
              background: 'transparent',
              lineHeight: 1.5,
              paddingTop: '2px',
              minHeight: '22px',
              maxHeight: '96px',
              overflow: 'auto',
            }}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !currentMessage.trim()}
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '8px',
              border: 'none',
              cursor: isLoading || !currentMessage.trim() ? 'not-allowed' : 'pointer',
              background: isLoading || !currentMessage.trim() ? '#e2e8f0' : '#003366',
              color: isLoading || !currentMessage.trim() ? '#94a3b8' : 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'background 0.15s',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default React.memo(CourseAssistant);
