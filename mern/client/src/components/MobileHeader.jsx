import React from 'react';
import { useMobileUI } from '../context/MobileUIContext';

const MobileHeader = () => {
  const { toggleLeftSidebar } = useMobileUI();

  return (
    <div className="block md:hidden sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="flex items-center justify-between px-4 py-3">
        {/* Left hamburger menu */}
        <button
          onClick={toggleLeftSidebar}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Toggle degree audit sidebar"
        >
          <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* App title */}
        <h1 className="text-lg font-semibold text-gray-800">
          Triton Planner
        </h1>

        {/* Empty space to maintain center alignment */}
        <div className="w-10"></div>
      </div>
    </div>
  );
};

export default MobileHeader;