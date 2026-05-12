# TritonPlanner UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain default UI with a cohesive UCSD-branded design: navy/sky-blue color system, TritonPlanner header with trident logo, collapsible sidebars, restyled planner grid, and a course detail overlay on course click.

**Architecture:** CSS-only polish on most components plus three targeted structural additions — left sidebar collapse toggle, right sidebar stacked collapsible panels, and a new `CourseDetailOverlay` component wired through `MainLayout`. No changes to drag-and-drop, audit parsing, or backend.

**Tech Stack:** React 18, Tailwind CSS, Vite dev server (`cd mern/client && npm run dev` → http://localhost:5173)

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `src/components/Header.jsx` | TritonPlanner wordmark + trident SVG |
| Modify | `src/components/LeftSidebar.jsx` | Add collapse/expand state + collapsed strip |
| Modify | `src/components/MainLayout.jsx` | Add `selectedCourse` state, wire `onCourseClick` + dismiss |
| Modify | `src/components/right-sidebar/RightSidebar.jsx` | Replace current layout with stacked collapsible Search + Chat |
| Modify | `src/components/planner/CourseCard.jsx` | Restyle + add `onCourseClick` prop |
| Modify | `src/components/planner/TermBlock.jsx` | Restyle empty slots + pass `onCourseClick` to cards |
| Modify | `src/components/planner/YearBlock.jsx` | Restyle year header + pass `onCourseClick` down |
| Modify | `src/components/planner/CoursePlanner.jsx` | Pass `onCourseClick` down to YearBlock |
| Modify | `src/components/planner/CoursePlannerContainer.jsx` | Accept + forward `onCourseClick` prop |
| Create | `src/components/planner/CourseDetailOverlay.jsx` | Course detail panel shown on card click |

---

## Task 1: Header — TritonPlanner branding

**Files:**
- Modify: `mern/client/src/components/Header.jsx`

- [ ] **Step 1: Start the dev server**

```bash
cd mern/client && npm run dev
```

Open http://localhost:5173 and confirm the current blue header with "4-Year Planner" is visible.

- [ ] **Step 2: Rewrite Header.jsx**

Replace the entire file with:

```jsx
const Header = () => {
  return (
    <header className="flex items-center px-4 flex-shrink-0" style={{ height: '44px', background: '#003366' }}>
      <svg width="22" height="28" viewBox="0 0 22 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="11,0 8.5,5.5 13.5,5.5" fill="white"/>
        <polygon points="2.5,3.5 0,9 5,9" fill="#7db8e8" opacity="0.85"/>
        <polygon points="19.5,3.5 17,9 22,9" fill="#7db8e8" opacity="0.85"/>
        <rect x="9" y="4" width="4" height="21" rx="2" fill="white"/>
        <rect x="0.5" y="7" width="3.5" height="15" rx="1.75" fill="#7db8e8"/>
        <rect x="18" y="7" width="3.5" height="15" rx="1.75" fill="#7db8e8"/>
        <rect x="0.5" y="8.5" width="21" height="2.5" rx="1.25" fill="#7db8e8" opacity="0.6"/>
        <rect x="9" y="25" width="4" height="3" rx="1" fill="#7db8e8" opacity="0.5"/>
      </svg>
      <div className="ml-3">
        <span style={{ color: 'white', fontSize: '17px', fontWeight: 800, letterSpacing: '-0.3px' }}>Triton</span>
        <span style={{ color: 'white', fontSize: '17px', fontWeight: 300, letterSpacing: '-0.3px' }}>Planner</span>
      </div>
    </header>
  );
};

export default Header;
```

- [ ] **Step 3: Verify visually**

In the browser, confirm:
- Header is navy (`#003366`), height ~44px
- Trident SVG with white center prong and sky-blue side prongs is visible on the left
- "Triton" is bold white, "Planner" is light white, side by side
- No more "4-Year Planner" text in the header

- [ ] **Step 4: Commit**

```bash
git add mern/client/src/components/Header.jsx
git commit -m "feat: rebrand header to TritonPlanner with trident logo"
```

---

## Task 2: Left sidebar — collapsible

**Files:**
- Modify: `mern/client/src/components/LeftSidebar.jsx`

- [ ] **Step 1: Replace LeftSidebar.jsx**

Replace the entire file with:

```jsx
import React, { useState, useRef } from "react";
import SidebarAuditTracker from "./audit/SidebarAuditTracker";

const LeftSidebar = ({ onParsedDataUpdate }) => {
  const [auditData, setAuditData] = useState({ sections: [], metadata: {} });
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const sidebarRef = useRef(null);

  const handleAuditDataUpdate = (newAuditData) => {
    setAuditData(newAuditData);
    if (onParsedDataUpdate) onParsedDataUpdate(newAuditData);
  };

  const handleMouseDown = (e) => {
    setIsResizing(true);
    e.preventDefault();
  };

  const handleMouseMove = React.useCallback((e) => {
    if (!isResizing) return;
    const newWidth = e.clientX;
    if (newWidth >= 250 && newWidth <= 600) setSidebarWidth(newWidth);
  }, [isResizing]);

  const handleMouseUp = () => setIsResizing(false);

  React.useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove]);

  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center h-full cursor-pointer flex-shrink-0"
        style={{ width: '28px', background: '#003366' }}
        onClick={() => setCollapsed(false)}
        title="Expand requirements"
      >
        <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '10px', marginTop: '10px' }}>▶</span>
        <span style={{
          writingMode: 'vertical-lr',
          transform: 'rotate(180deg)',
          fontSize: '7px',
          fontWeight: 700,
          letterSpacing: '0.5px',
          color: 'rgba(255,255,255,0.4)',
          marginTop: '10px',
        }}>REQUIREMENTS</span>
      </div>
    );
  }

  return (
    <div
      ref={sidebarRef}
      className="bg-white border-r border-gray-200 h-full flex flex-col overflow-hidden relative flex-shrink-0"
      style={{ width: `${sidebarWidth}px` }}
    >
      {/* Section header with collapse button */}
      <div
        className="flex items-center px-3 flex-shrink-0"
        style={{ height: '36px', background: '#003366' }}
      >
        <span style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '0.5px', color: 'white', flex: 1 }}>
          REQUIREMENTS
        </span>
        <button
          onClick={() => setCollapsed(true)}
          style={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
          title="Collapse"
        >
          ◀
        </button>
      </div>

      <SidebarAuditTracker
        auditData={auditData}
        onAuditDataUpdate={handleAuditDataUpdate}
      />

      <div
        className="absolute top-0 right-0 w-1 h-full bg-gray-300 hover:bg-blue-400 cursor-col-resize opacity-0 hover:opacity-100 transition-opacity"
        onMouseDown={handleMouseDown}
        title="Drag to resize sidebar"
      />
    </div>
  );
};

export default LeftSidebar;
```

- [ ] **Step 2: Verify visually**

In the browser, confirm:
- Left sidebar now has a navy header bar reading "REQUIREMENTS" with a `◀` button on the right
- Clicking `◀` collapses the sidebar to a 28px navy strip with `▶` arrow and vertical "REQUIREMENTS" label
- Clicking the strip expands it back to full width
- Resize handle still works when expanded

- [ ] **Step 3: Commit**

```bash
git add mern/client/src/components/LeftSidebar.jsx
git commit -m "feat: make left audit sidebar collapsible"
```

---

## Task 3: Right sidebar — stacked collapsible Search + Chat

**Files:**
- Modify: `mern/client/src/components/right-sidebar/RightSidebar.jsx`

- [ ] **Step 1: Replace RightSidebar.jsx**

Replace the entire file with the following. The search and chat logic is identical to the current version — only the layout changes.

```jsx
import { useState, useRef, useEffect } from "react";
import CourseSearch from "./CourseSearch";
import CourseAssistant from "./CourseAssistant";
import CourseDetails from "./CourseDetails";
import { debounce } from "lodash";

const SectionHeader = ({ label, collapsed, onToggle }) => (
  <div
    className="flex items-center px-3 flex-shrink-0 cursor-pointer"
    style={{ height: '34px', background: '#003366' }}
    onClick={onToggle}
  >
    <span style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '0.5px', color: 'white', flex: 1 }}>
      {label}
    </span>
    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '10px', transition: 'transform 0.15s', display: 'inline-block', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
      ▾
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
  const [searchCollapsed, setSearchCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);

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
      <div className="flex flex-col flex-shrink-0" style={{ borderBottom: '1px solid #e2e8f0' }}>
        <SectionHeader
          label="COURSE SEARCH"
          collapsed={searchCollapsed}
          onToggle={() => setSearchCollapsed((v) => !v)}
        />
        {!searchCollapsed && (
          <div className="overflow-y-auto" style={{ maxHeight: '45vh' }}>
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
        )}
      </div>

      {/* Chat panel */}
      <div className="flex flex-col flex-1 min-h-0">
        <SectionHeader
          label="AI ASSISTANT"
          collapsed={chatCollapsed}
          onToggle={() => setChatCollapsed((v) => !v)}
        />
        {!chatCollapsed && (
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
        )}
      </div>
    </div>
  );
};

export default RightSidebar;
```

> Note: `CourseDetailOverlay` is imported above but doesn't exist yet — it will be created in Task 5. The import will cause a build error until then. Either skip this step until after Task 5, or add a temporary stub: create `src/components/planner/CourseDetailOverlay.jsx` with `const CourseDetailOverlay = () => null; export default CourseDetailOverlay;` before running this task.

- [ ] **Step 2: Add the import line at the top of RightSidebar.jsx**

Add this import after the existing imports:

```jsx
import CourseDetailOverlay from "../planner/CourseDetailOverlay";
```

- [ ] **Step 3: Verify visually**

In the browser, confirm:
- Right sidebar shows two section headers: "COURSE SEARCH" and "AI ASSISTANT", both navy
- Each has a `▾` chevron that rotates when collapsed
- Clicking the Search header collapses/expands the search area
- Clicking the Chat header collapses/expands the chat area
- Drag-to-planner from search results still works
- Double-clicking a search result still opens course details

- [ ] **Step 4: Commit**

```bash
git add mern/client/src/components/right-sidebar/RightSidebar.jsx
git commit -m "feat: replace right sidebar tabs with stacked collapsible search and chat panels"
```

---

## Task 4: Planner grid — aesthetic polish

**Files:**
- Modify: `mern/client/src/components/planner/CourseCard.jsx`
- Modify: `mern/client/src/components/planner/TermBlock.jsx`
- Modify: `mern/client/src/components/planner/YearBlock.jsx`

### 4a: CourseCard

- [ ] **Step 1: Replace CourseCard.jsx**

```jsx
const CourseCard = ({ course, onRemove, onDragStart, onDragEnd, isPreviewing = false, onCourseClick }) => {
  if (!course) return null;

  const statusStyles = {
    completed: { bg: '#dcfce7', border: '#16a34a', text: '#166534' },
    current:   { bg: '#fef9c3', border: '#ca8a04', text: '#854d0e' },
    planned:   { bg: '#e0f0ff', border: '#0066cc', text: '#003366' },
  };

  const style = statusStyles[course.status] || { bg: '#f1f5f9', border: '#cbd5e1', text: '#475569' };

  return (
    <div
      className="flex justify-between items-center cursor-move rounded"
      style={{
        padding: '5px 8px',
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderLeft: `3px solid ${style.border}`,
        opacity: isPreviewing ? 0.55 : 1,
        borderRadius: '6px',
      }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        e.stopPropagation();
        if (onCourseClick) onCourseClick(course);
      }}
    >
      <div>
        <div style={{ fontSize: '12px', fontWeight: 600, color: style.text }}>
          {course.course_id}
          {isPreviewing && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#ca8a04' }}>(Moving)</span>}
        </div>
        {course.grade && course.status === 'completed' && (
          <div style={{ fontSize: '10px', color: style.text, opacity: 0.7 }}>Grade: {course.grade}</div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <span style={{ background: style.border, color: 'white', borderRadius: '999px', padding: '1px 7px', fontSize: '10px', fontWeight: 600 }}>
          {course.credits.toFixed(1)}u
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ color: '#94a3b8', fontSize: '14px', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}
          title="Remove"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default CourseCard;
```

### 4b: TermBlock

- [ ] **Step 2: Replace TermBlock.jsx**

```jsx
import React from "react";
import CourseCard from "./CourseCard";

const TermBlock = ({
  termName, termKey, courses, yearIndex,
  calculateTermUnits, handleDragOver, handleDrop,
  handleDragStart, handleDragEnd, handleRemoveCourse,
  getSlotClassName, previewState, dragTarget, invalidDrop,
  onCourseClick,
}) => {
  return (
    <div className="flex-1" style={{ padding: '8px' }}>
      <div className="flex justify-between items-center mb-2" style={{ marginBottom: '8px' }}>
        <span style={{ fontSize: '7px', fontWeight: 700, letterSpacing: '0.5px', color: '#003366', textTransform: 'uppercase', opacity: 0.6 }}>
          {termName}
        </span>
        <span style={{ background: '#e0f0ff', color: '#0066cc', borderRadius: '999px', padding: '1px 7px', fontSize: '10px', fontWeight: 600 }}>
          {calculateTermUnits(courses).toFixed(1)}u
        </span>
      </div>

      {courses.map((course, courseIndex) => (
        <div
          key={courseIndex}
          className={`mb-2 ${getSlotClassName(yearIndex, termKey, courseIndex)}`}
          onDragOver={(e) => handleDragOver(e, yearIndex, termKey, courseIndex)}
          onDrop={(e) => handleDrop(e, yearIndex, termKey, courseIndex)}
          style={{ marginBottom: '5px' }}
        >
          {course ? (
            <CourseCard
              course={course}
              isPreviewing={
                previewState &&
                previewState.sourceYearIndex === yearIndex &&
                previewState.sourceTerm === termKey &&
                previewState.sourceCourseIndex === courseIndex
              }
              onDragStart={(e) => handleDragStart(e, course, false, yearIndex, termKey, courseIndex)}
              onDragEnd={handleDragEnd}
              onRemove={() => handleRemoveCourse(yearIndex, termKey, courseIndex)}
              onCourseClick={onCourseClick}
            />
          ) : (
            <div style={{
              border: '1px dashed #cbd5e1',
              borderRadius: '6px',
              padding: '10px 8px',
              textAlign: 'center',
              background: '#f1f5f9',
              fontSize: '10px',
              color: '#94a3b8',
            }}>
              {invalidDrop && dragTarget.yearIndex === yearIndex && dragTarget.term === termKey && dragTarget.courseIndex === courseIndex ? (
                <span style={{ color: '#dc2626' }}>Not offered in {termName}</span>
              ) : previewState && previewState.targetYearIndex === yearIndex && previewState.targetTerm === termKey && previewState.targetCourseIndex === courseIndex ? (
                <span style={{ color: '#ca8a04' }}>{previewState.course.course_name} (Preview)</span>
              ) : (
                'drag here'
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default TermBlock;
```

### 4c: YearBlock

- [ ] **Step 3: Replace YearBlock.jsx**

```jsx
import React from "react";
import TermBlock from "./TermBlock";

const YearBlock = ({
  year, yearIndex, yearLabel, collapsed, toggleCollapse,
  calculateAnnualUnits, calculateTermUnits,
  handleDragOver, handleDrop, handleDragStart, handleDragEnd,
  handleRemoveCourse, getSlotClassName, previewState, dragTarget, invalidDrop,
  onCourseClick,
}) => {
  return (
    <div style={{ marginBottom: '16px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div
        className="flex justify-between items-center cursor-pointer"
        style={{ background: '#003366', padding: '8px 14px' }}
        onClick={() => toggleCollapse(yearIndex)}
      >
        <div className="flex items-center gap-2">
          <svg
            width="12" height="12" viewBox="0 0 12 12"
            style={{ transition: 'transform 0.2s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', flexShrink: 0 }}
          >
            <path d="M2 4 L6 8 L10 4" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
          <span style={{ fontWeight: 700, fontSize: '13px', color: 'white' }}>{yearLabel}</span>
        </div>
        <span style={{ background: 'rgba(255,255,255,0.15)', color: 'white', borderRadius: '999px', padding: '2px 10px', fontSize: '11px', fontWeight: 600 }}>
          {calculateAnnualUnits(yearIndex).toFixed(1)}u
        </span>
      </div>

      {!collapsed && (
        <div className="flex flex-col md:flex-row" style={{ background: '#f8fafc' }}>
          {['fall', 'winter', 'spring'].map((term) => (
            <TermBlock
              key={term}
              termKey={term}
              termName={term.charAt(0).toUpperCase() + term.slice(1)}
              courses={year[term]}
              yearIndex={yearIndex}
              calculateTermUnits={calculateTermUnits}
              handleDragOver={handleDragOver}
              handleDrop={handleDrop}
              handleDragStart={handleDragStart}
              handleDragEnd={handleDragEnd}
              handleRemoveCourse={handleRemoveCourse}
              getSlotClassName={getSlotClassName}
              previewState={previewState}
              dragTarget={dragTarget}
              invalidDrop={invalidDrop}
              onCourseClick={onCourseClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default YearBlock;
```

- [ ] **Step 4: Verify visually**

In the browser, confirm:
- Year headers are navy with white text and an SVG chevron that rotates on collapse
- Term labels are small uppercase navy text
- Unit badges are sky-blue pills
- Course cards have colored left borders matching their status, no emoji indicators
- Empty slots are light grey with dashed border and "drag here" text
- Drag-and-drop still works

- [ ] **Step 5: Commit**

```bash
git add mern/client/src/components/planner/CourseCard.jsx \
        mern/client/src/components/planner/TermBlock.jsx \
        mern/client/src/components/planner/YearBlock.jsx
git commit -m "feat: restyle planner grid with UCSD navy/blue design tokens"
```

---

## Task 5: CourseDetailOverlay — new component

**Files:**
- Create: `mern/client/src/components/planner/CourseDetailOverlay.jsx`

- [ ] **Step 1: Create CourseDetailOverlay.jsx**

```jsx
import ProfessorInfo from "../right-sidebar/ProfessorInfo";

const CourseDetailOverlay = ({ course, parsedCourseData, onDismiss }) => {
  if (!course) return null;

  const matchedRequirements = (parsedCourseData?.sections || []).filter((section) =>
    (section.items || []).some(
      (item) => item.courseId?.replace(/\s+/g, ' ').trim().toLowerCase() === course.course_id?.toLowerCase()
    )
  );

  const getCleanDescription = (desc) => {
    if (!desc) return null;
    const idx = desc.toLowerCase().indexOf("prerequisites:");
    return (idx !== -1 ? desc.substring(0, idx) : desc).replace(/\.$/, '').trim() || null;
  };

  const description = getCleanDescription(course.description);

  return (
    <div
      className="absolute inset-0 flex flex-col bg-white z-10 overflow-y-auto"
      style={{ borderLeft: '3px solid #0066cc', animation: 'slideInRight 0.18s ease-out' }}
    >
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-start justify-between flex-shrink-0" style={{ padding: '12px 14px 10px', borderBottom: '1px solid #e2e8f0' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 800, color: '#003366' }}>{course.course_id}</div>
          {course.course_name && (
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{course.course_name}</div>
          )}
          <div className="flex flex-wrap gap-1 mt-2">
            {course.credits != null && (
              <span style={{ background: '#e0f0ff', color: '#0066cc', fontSize: '10px', padding: '2px 7px', borderRadius: '999px', fontWeight: 600 }}>
                {course.credits} units
              </span>
            )}
            {Array.isArray(course.offerings) && course.offerings.map((q) => (
              <span key={q} style={{ background: '#e0f0ff', color: '#0066cc', fontSize: '10px', padding: '2px 7px', borderRadius: '999px' }}>
                {q}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={onDismiss}
          style={{ color: '#94a3b8', fontSize: '16px', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', marginLeft: '8px', flexShrink: 0 }}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Requirements satisfied */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#003366', marginBottom: '6px', letterSpacing: '0.3px' }}>REQUIREMENTS</div>
        {matchedRequirements.length > 0 ? (
          <div className="flex flex-col gap-1">
            {matchedRequirements.map((section, i) => (
              <div key={i} style={{ background: '#dcfce7', borderRadius: '5px', padding: '5px 8px', fontSize: '11px', color: '#166534', fontWeight: 500 }}>
                ✓ {section.title}
              </div>
            ))}
          </div>
        ) : parsedCourseData?.sections?.length > 0 ? (
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>No requirements matched.</div>
        ) : (
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>Upload an audit to see requirement matches.</div>
        )}
      </div>

      {/* Prerequisites */}
      {course.prerequisites && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#003366', marginBottom: '6px', letterSpacing: '0.3px' }}>PREREQUISITES</div>
          <div style={{ fontSize: '11px', color: '#475569' }}>
            {course.prerequisites.trim() === '' ? 'None' : course.prerequisites}
          </div>
        </div>
      )}

      {/* Top professors */}
      {course.professors && course.professors.length > 0 && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#003366', marginBottom: '6px', letterSpacing: '0.3px' }}>TOP PROFESSORS</div>
          {course.professors.slice(0, 2).map((prof, idx) => (
            <ProfessorInfo key={idx} professor={prof} />
          ))}
        </div>
      )}

      {/* Description */}
      {description && (
        <div style={{ padding: '10px 14px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#003366', marginBottom: '6px', letterSpacing: '0.3px' }}>DESCRIPTION</div>
          <div style={{ fontSize: '11px', color: '#475569', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {description}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 'auto', padding: '8px 14px', borderTop: '1px solid #e2e8f0', fontSize: '10px', color: '#94a3b8', textAlign: 'center' }}>
        Click planner to dismiss
      </div>
    </div>
  );
};

export default CourseDetailOverlay;
```

- [ ] **Step 2: Verify component renders without errors**

The overlay won't be visible yet (no trigger). Check the browser console for any import errors. If the stub from Task 3 exists, replace it with this file.

- [ ] **Step 3: Commit**

```bash
git add mern/client/src/components/planner/CourseDetailOverlay.jsx
git commit -m "feat: add CourseDetailOverlay component"
```

---

## Task 6: Wire selectedCourse state end-to-end

**Files:**
- Modify: `mern/client/src/components/MainLayout.jsx`
- Modify: `mern/client/src/components/planner/CoursePlannerContainer.jsx`
- Modify: `mern/client/src/components/planner/CoursePlanner.jsx`

### 6a: MainLayout

- [ ] **Step 1: Replace MainLayout.jsx**

```jsx
import { useState } from "react";
import RightSidebar from "./right-sidebar/RightSidebar";
import LeftSidebar from "./LeftSidebar";
import CoursePlannerContainer from "./planner/CoursePlannerContainer";
import Header from "./Header";

const MainLayout = () => {
  const [parsedCourseData, setParsedCourseData] = useState({ sections: [], metadata: {} });
  const [selectedCourse, setSelectedCourse] = useState(null);

  return (
    <div className="flex h-screen flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar onParsedDataUpdate={setParsedCourseData} />

        {/* Main planner — clicking dismisses any open course detail */}
        <div
          className="flex-grow overflow-y-auto"
          style={{ padding: '16px', background: '#f8fafc' }}
          onClick={() => setSelectedCourse(null)}
        >
          <CoursePlannerContainer
            parsedCourseData={parsedCourseData}
            onCourseClick={(course) => setSelectedCourse(course)}
          />
        </div>

        <RightSidebar
          selectedCourse={selectedCourse}
          onDismissDetail={() => setSelectedCourse(null)}
          parsedCourseData={parsedCourseData}
        />
      </div>
    </div>
  );
};

export default MainLayout;
```

### 6b: CoursePlannerContainer

- [ ] **Step 2: Add `onCourseClick` prop to CoursePlannerContainer**

In `mern/client/src/components/planner/CoursePlannerContainer.jsx`, change the component signature from:

```jsx
const CoursePlannerContainer = ({ parsedCourseData = { sections: [], metadata: {} } }) => {
```

to:

```jsx
const CoursePlannerContainer = ({ parsedCourseData = { sections: [], metadata: {} }, onCourseClick }) => {
```

Then find the `<CoursePlanner` JSX near the bottom and add the `onCourseClick` prop:

```jsx
<CoursePlanner
  schedule={schedule}
  yearLabels={yearLabels}
  collapsedYears={collapsedYears}
  toggleYearCollapse={toggleYearCollapse}
  calculateAnnualUnits={calculateAnnualUnits}
  calculateTermUnits={calculateTermUnits}
  handleDragStart={handleDragStart}
  handleDragEnd={handleDragEnd}
  handleDragOver={handleDragOver}
  handleDrop={handleDrop}
  handleRemoveCourse={handleRemoveCourse}
  previewState={previewState}
  dragTarget={dragTarget}
  invalidDrop={invalidDrop}
  getSlotClassName={getSlotClassName}
  onExportToSheets={handleExportToSheets}
  loading={loading}
  onCourseClick={onCourseClick}
/>
```

### 6c: CoursePlanner

- [ ] **Step 3: Thread `onCourseClick` through CoursePlanner**

In `mern/client/src/components/planner/CoursePlanner.jsx`, add `onCourseClick` to the props destructuring:

```jsx
const CoursePlanner = ({
  schedule,
  yearLabels,
  collapsedYears,
  toggleYearCollapse,
  calculateAnnualUnits,
  calculateTermUnits,
  handleDragOver,
  handleDrop,
  handleDragStart,
  handleDragEnd,
  handleRemoveCourse,
  previewState,
  getSlotClassName,
  onExportToSheets,
  loading = false,
  onCourseClick,
}) => {
```

Then add `onCourseClick={onCourseClick}` to the `<YearBlock` render inside `schedule.map`:

```jsx
<YearBlock
  year={year}
  yearIndex={yearIndex}
  yearLabel={yearLabels[yearIndex]}
  collapsed={collapsedYears[yearIndex]}
  toggleCollapse={toggleYearCollapse}
  calculateAnnualUnits={calculateAnnualUnits}
  calculateTermUnits={calculateTermUnits}
  handleDragOver={handleDragOver}
  handleDrop={handleDrop}
  handleDragStart={handleDragStart}
  handleDragEnd={handleDragEnd}
  handleRemoveCourse={handleRemoveCourse}
  previewState={previewState}
  getSlotClassName={getSlotClassName}
  onCourseClick={onCourseClick}
/>
```

- [ ] **Step 4: Verify the full flow end-to-end**

In the browser:
1. Confirm the planner renders with navy year headers and restyled cards
2. Click any course card — the right sidebar should show the `CourseDetailOverlay` sliding in with a blue left border
3. Confirm the overlay shows course ID, units, and (if audit loaded) requirements matched
4. Click anywhere on the planner background — overlay dismisses
5. Click the `✕` button — overlay dismisses
6. Collapse/expand left sidebar and both right sidebar panels — verify all work independently
7. Drag a course from search to the planner — confirm drag-and-drop is unbroken

- [ ] **Step 5: Commit**

```bash
git add mern/client/src/components/MainLayout.jsx \
        mern/client/src/components/planner/CoursePlannerContainer.jsx \
        mern/client/src/components/planner/CoursePlanner.jsx
git commit -m "feat: wire selectedCourse state for course detail overlay"
```

---

## Self-Review Notes

- Header no longer receives `currentPage` prop — `MainLayout` no longer passes it. The old `pageTitles` map and `renderPage` switch are removed; the planner is the only rendered page. ✓
- `CourseStorage` and `QuarterlyView` are no longer rendered — consistent with spec scope. ✓
- `CourseDetailOverlay` is in `src/components/planner/` and imported into `RightSidebar` via a relative path (`../planner/CourseDetailOverlay`). ✓
- The `onCourseClick` prop chain: `MainLayout` → `CoursePlannerContainer` → `CoursePlanner` → `YearBlock` → `TermBlock` → `CourseCard`. All 5 levels covered in Tasks 4c, 6b, 6c. ✓
- `e.stopPropagation()` in `CourseCard` onClick prevents the planner wrapper's dismiss-onClick from firing on card click. ✓
- Requirements matching uses the same normalization pattern as the existing audit parser bug fix: `.replace(/\s+/g, ' ').trim()`. ✓
