import React from "react";
import CourseItem from "./CourseItem";

const CourseSearch = ({
  searchTerm,
  searchResults,
  setSearchTerm,
  handleDragStart,
  handleDragEnd,
  debouncedSearch,
  isCourseLoading,
  onCourseDoubleClick,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search input */}
      <div style={{ padding: '10px 10px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 10px' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search courses…"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              debouncedSearch(e.target.value);
            }}
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: '12px', color: '#1e293b', background: 'transparent' }}
          />
          {searchTerm && (
            <button
              onClick={() => { setSearchTerm(""); debouncedSearch(""); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, fontSize: '14px', lineHeight: 1 }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 10px' }}>
        {isCourseLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '24px' }}>
            <div style={{ width: '18px', height: '18px', border: '2px solid #e2e8f0', borderTopColor: '#0066cc', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : searchTerm.trim() === "" ? (
          <div style={{ textAlign: 'center', paddingTop: '28px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 8px' }}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Search by course ID or name</div>
            <div style={{ fontSize: '10px', color: '#cbd5e1', marginTop: '3px' }}>Drag results onto the planner</div>
          </div>
        ) : searchResults.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: '28px', fontSize: '11px', color: '#94a3b8' }}>
            No courses found for "{searchTerm}"
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '2px' }}>
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} — drag to planner or double-click for details
            </div>
            {searchResults.map((course) => (
              <CourseItem
                key={course.course_id}
                course={course}
                onDragStart={(e) => handleDragStart(e, course, true)}
                onDragEnd={handleDragEnd}
                onDoubleClick={onCourseDoubleClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CourseSearch;
