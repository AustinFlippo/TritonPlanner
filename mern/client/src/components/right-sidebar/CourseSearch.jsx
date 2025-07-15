// In /src/components/right-sidebar/CourseSearch.jsx

import React, { useRef, useEffect } from "react";
import CourseItem from "./CourseItem";
import LoadingSpinner from "../LoadingSpinner";
import CustomScrollbar from "./CustomScrollbar";
import { shouldUseDndKit } from "../../utils/deviceDetection";

const CourseSearch = ({
  searchTerm,
  searchResults,
  setSearchTerm,
  handleDragStart,
  handleDragEnd,
  debouncedSearch,
  isCourseLoading,
  onCourseDoubleClick
}) => {
  const useDndKit = shouldUseDndKit();
  const viewportRef = useRef(null);
  const contentRef = useRef(null);

  // Limit search results for mobile to prevent crashes
  const displayResults = useDndKit 
    ? searchResults.slice(0, 10) // Mobile: max 10 results
    : searchResults; // Desktop: all results

  const totalResults = searchResults.length;
  const isLimited = useDndKit && totalResults > 10;

  // Disable all native scrolling methods for mobile
  useEffect(() => {
    if (!useDndKit || !viewportRef.current) return;

    const viewport = viewportRef.current;

    // Prevent wheel scrolling (mouse wheel and trackpad)
    const preventWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // Prevent touch scrolling (finger swipes) - but allow course dragging
    const preventTouchMove = (e) => {
      // Only prevent if it's a scrolling gesture (not a drag from a course item)
      if (e.target.closest('.custom-scrollbar') || e.target.closest('[data-draggable]')) {
        return; // Allow scrollbar and course dragging
      }
      e.preventDefault();
      e.stopPropagation();
    };

    // Prevent keyboard scrolling (arrow keys, page up/down, space)
    const preventKeyboard = (e) => {
      const scrollKeys = [
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'PageUp', 'PageDown', 'Home', 'End', 'Space'
      ];
      if (scrollKeys.includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Add event listeners
    viewport.addEventListener('wheel', preventWheel, { passive: false });
    viewport.addEventListener('touchmove', preventTouchMove, { passive: false });
    viewport.addEventListener('keydown', preventKeyboard);

    return () => {
      viewport.removeEventListener('wheel', preventWheel);
      viewport.removeEventListener('touchmove', preventTouchMove);
      viewport.removeEventListener('keydown', preventKeyboard);
    };
  }, [useDndKit, viewportRef]);
  
  return (
    // The main container is already flex-col and h-full from ActionDrawer, which is correct.
    <div className="flex flex-col h-full">
      
      {/* Fixed header section - This part is correct and remains unchanged. */}
      <div className="p-4 flex-shrink-0">
        <div className="flex items-center mb-4">
          <h2 className="text-lg font-bold">Course Search</h2>
          {/* Tooltip '?' icon ... */}
        </div>
        <input
          type="text"
          placeholder="Search courses..."
          className="w-full p-2 border border-gray-300 rounded text-sm"
          value={searchTerm}
          onChange={(e) => {
            const newQuery = e.target.value;
            setSearchTerm(newQuery);
            debouncedSearch(newQuery);
          }}
        />
      </div>

      {/* 
        * RESULTS SECTION: Conditional scrolling based on device type
        * - Mobile (useDndKit): Custom scrollbar with explicit viewport/content architecture
        * - Desktop: Keep existing scroll behavior with styled scrollbar
      */}
      <div className={`flex-1 px-4 pb-4 ${useDndKit ? 'relative min-h-0' : ''}`}>
        {useDndKit ? (
          // Mobile: Explicit viewport/content architecture
          <>
            {/* Viewport - the visible scrollable area */}
            <div 
              ref={viewportRef}
              className="overflow-y-scroll scrollbar-hide pr-6"
              style={{ 
                height: '100%', 
                maxHeight: '100%', 
                minHeight: '0',
                touchAction: 'none',
                overscrollBehavior: 'contain'
              }}
            >
              {/* Content - the actual scrollable content */}
              <div ref={contentRef}>
                {isCourseLoading ? (
                  <div className="flex justify-center py-4">
                    <LoadingSpinner size="6" color="blue-500" />
                  </div>
                ) : searchTerm.trim() === "" ? (
                  <div className="text-gray-500 text-xs text-center py-4">Enter in a course!</div>
                ) : displayResults.length === 0 ? (
                  <div className="text-gray-500 text-xs text-center py-4">No results found.</div>
                ) : (
                  <div className="space-y-2">
                    {/* Results limit notification for mobile */}
                    {isLimited && (
                      <div className="text-blue-600 text-xs text-center py-2 bg-blue-50 rounded border border-blue-200">
                        Showing first 10 of {totalResults} results (mobile limit)
                      </div>
                    )}
                    {displayResults.map((course) => (
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
            
            {/* Custom scrollbar for mobile */}
            <CustomScrollbar viewportRef={viewportRef} contentRef={contentRef} />
          </>
        ) : (
          // Desktop: Original scroll behavior
          <div className="overflow-y-auto scrollbar-thin scrollbar-thumb-blue-500 scrollbar-track-gray-200 scrollbar-thumb-rounded-full">
            {isCourseLoading ? (
              <div className="flex justify-center py-4">
                <LoadingSpinner size="6" color="blue-500" />
              </div>
            ) : searchTerm.trim() === "" ? (
              <div className="text-gray-500 text-xs text-center py-4">Enter in a course!</div>
            ) : displayResults.length === 0 ? (
              <div className="text-gray-500 text-xs text-center py-4">No results found.</div>
            ) : (
              <div className="space-y-2">
                {displayResults.map((course) => (
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
        )}
      </div>
    </div>
  );
};

export default CourseSearch;