import React, { useState, useRef, useEffect, useCallback } from 'react';

const CustomScrollbar = ({ viewportRef, contentRef }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [thumbPosition, setThumbPosition] = useState(0);
  const [thumbHeight, setThumbHeight] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  const dragStartRef = useRef(null);
  const resizeObserverRef = useRef(null);

  // Calculate thumb dimensions and position based on viewport vs content
  const updateThumbDimensions = useCallback(() => {
    if (!viewportRef.current || !contentRef.current) {
      return;
    }

    const viewport = viewportRef.current;
    const content = contentRef.current;
    
    const viewportHeight = viewport.clientHeight;
    const contentHeight = content.scrollHeight;
    const contentClientHeight = content.clientHeight;
    const viewportScrollHeight = viewport.scrollHeight;
    
    // Debug logging - remove in production
    if (process.env.NODE_ENV === 'development') {
      console.log('CustomScrollbar Debug:', {
        viewportHeight,
        contentHeight,
        needsScrolling: contentHeight > viewportHeight
      });
    }
    
    if (contentHeight <= viewportHeight) {
      // Content fits in viewport - no scrolling needed
      setThumbHeight(0);
      setIsVisible(false);
      return;
    }
    
    // Content needs scrolling - show scrollbar
    setIsVisible(true);
    
    // Calculate thumb height after track is available
    setTimeout(() => {
      if (trackRef.current) {
        const trackHeight = trackRef.current.clientHeight;
        const thumbHeightRatio = viewportHeight / contentHeight;
        const calculatedThumbHeight = Math.max(trackHeight * thumbHeightRatio, 20); // Min height of 20px
        setThumbHeight(calculatedThumbHeight);
        
        // Calculate thumb position based on scroll position
        const maxScrollTop = contentHeight - viewportHeight;
        const scrollRatio = viewport.scrollTop / maxScrollTop;
        const maxThumbPosition = trackHeight - calculatedThumbHeight;
        setThumbPosition(scrollRatio * maxThumbPosition);
      }
    }, 10); // Small delay to ensure track is rendered
  }, [viewportRef, contentRef]);

  // Handle viewport scroll events
  const handleScroll = useCallback(() => {
    if (!viewportRef.current || !contentRef.current || !trackRef.current) return;
    
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const track = trackRef.current;
    
    const viewportHeight = viewport.clientHeight;
    const contentHeight = content.scrollHeight;
    const trackHeight = track.clientHeight;
    
    if (contentHeight <= viewportHeight) return;
    
    const maxScrollTop = contentHeight - viewportHeight;
    const scrollRatio = viewport.scrollTop / maxScrollTop;
    const maxThumbPosition = trackHeight - thumbHeight;
    setThumbPosition(scrollRatio * maxThumbPosition);
  }, [viewportRef, contentRef, thumbHeight]);

  // Set up scroll listener and ResizeObserver
  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    
    if (!viewport || !content) {
      return;
    }

    // Add scroll listener to viewport
    viewport.addEventListener('scroll', handleScroll);
    
    // Initial calculation
    const initialUpdate = () => {
      updateThumbDimensions();
    };
    
    // Try multiple times to ensure content is loaded
    setTimeout(initialUpdate, 50);
    setTimeout(initialUpdate, 200);
    setTimeout(initialUpdate, 500);
    setTimeout(initialUpdate, 1000);

    // Use ResizeObserver to watch for size changes in both viewport and content
    if (window.ResizeObserver) {
      resizeObserverRef.current = new ResizeObserver(() => {
        updateThumbDimensions();
      });
      
      resizeObserverRef.current.observe(viewport);
      resizeObserverRef.current.observe(content);
    }

    // Use MutationObserver to detect content changes
    const mutationObserver = new MutationObserver(() => {
      setTimeout(updateThumbDimensions, 50); // Small delay to let DOM settle
    });
    
    mutationObserver.observe(content, { 
      childList: true, 
      subtree: true, 
      attributes: true, 
      attributeFilter: ['style', 'class'] 
    });

    return () => {
      viewport.removeEventListener('scroll', handleScroll);
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      mutationObserver.disconnect();
    };
  }, [viewportRef, contentRef, updateThumbDimensions, handleScroll]);

  // Handle drag start
  const handleDragStart = useCallback((e) => {
    if (!viewportRef.current || !trackRef.current) return;

    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    const thumbRect = thumbRef.current.getBoundingClientRect();
    
    dragStartRef.current = {
      startY: clientY,
      startThumbTop: thumbRect.top,
      startScrollTop: viewportRef.current.scrollTop
    };
    
    // Drag started
  }, [viewportRef]);

  // Handle drag move
  const handleDragMove = useCallback((e) => {
    if (!isDragging || !dragStartRef.current || !viewportRef.current || !contentRef.current || !trackRef.current) return;

    e.preventDefault();
    
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    const deltaY = clientY - dragStartRef.current.startY;
    
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const track = trackRef.current;
    
    const trackHeight = track.clientHeight;
    const contentHeight = content.scrollHeight;
    const viewportHeight = viewport.clientHeight;
    
    if (contentHeight <= viewportHeight) return;
    
    // Calculate new scroll position
    const maxScrollTop = contentHeight - viewportHeight;
    const maxThumbPosition = trackHeight - thumbHeight;
    const scrollRatio = deltaY / maxThumbPosition;
    const newScrollTop = Math.max(0, Math.min(maxScrollTop, 
      dragStartRef.current.startScrollTop + (scrollRatio * maxScrollTop)
    ));
    
    viewport.scrollTop = newScrollTop;
  }, [isDragging, thumbHeight, viewportRef, contentRef]);

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  // Set up global event listeners for drag
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => handleDragMove(e);
    const handleMouseUp = () => handleDragEnd();
    const handleTouchMove = (e) => handleDragMove(e);
    const handleTouchEnd = () => handleDragEnd();

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  // Render scrollbar with different states
  
  return (
    <div className="absolute top-0 right-0 h-full w-4 z-50 bg-transparent pointer-events-auto">
      {/* Scrollbar Track - always rendered */}
      <div
        ref={trackRef}
        className={`h-full w-full rounded-full border shadow-sm ${
          isVisible && thumbHeight > 0 
            ? 'bg-gray-300 border-gray-400' 
            : 'bg-red-200 border-red-400 opacity-50'
        }`}
        style={{ minHeight: '100px' }}
      >
        {isVisible && thumbHeight > 0 ? (
          /* Active Scrollbar Thumb */
          <div
            ref={thumbRef}
            className={`w-full bg-blue-500 rounded-full transition-colors cursor-pointer border border-blue-600 shadow-md ${
              isDragging ? 'bg-blue-700 border-blue-800' : 'hover:bg-blue-600'
            }`}
            style={{
              height: `${thumbHeight}px`,
              transform: `translateY(${thumbPosition}px)`,
              touchAction: 'none',
              minHeight: '20px',
              userSelect: 'none'
            }}
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
          />
        ) : (
          /* Debug indicator */
          <div className="text-xs text-red-600 p-1 text-center">No scroll</div>
        )}
      </div>
    </div>
  );
};

export default CustomScrollbar;