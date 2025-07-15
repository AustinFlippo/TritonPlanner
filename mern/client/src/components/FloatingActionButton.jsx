import React from 'react';
import { useMobileUI } from '../context/MobileUIContext';

const FloatingActionButton = () => {
  // Fetch both the toggle function and the state
  const { toggleActionDrawer, isActionDrawerOpen } = useMobileUI();

  return (
    <button
      onClick={toggleActionDrawer}
      className="fixed bottom-4 right-4 md:hidden w-14 h-14 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-300 z-50 flex items-center justify-center active:scale-95"
      aria-label={isActionDrawerOpen ? "Close search and assistant" : "Open search and assistant"}
    >
      {/* Conditionally render the icon based on the drawer's state */}
      {isActionDrawerOpen ? (
        // "Close" Icon (X)
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      ) : (
        // "Search" Icon
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      )}
    </button>
  );
};

export default FloatingActionButton;