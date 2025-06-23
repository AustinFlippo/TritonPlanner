import React from "react";
import YearBlock from "./YearBlock";

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
}) => {
  
  return (
    <div className="[&>*]:m-4">
      {schedule.map((year, yearIndex) => (
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
        />
      ))}
      
      {/* Export to Google Sheets Button */}
      <div className="mt-6 px-4">
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 hover:bg-gray-50 transition-colors">
          <svg className="w-8 h-8 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <button
            onClick={onExportToSheets}
            disabled={loading}
            className={`px-6 py-3 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              loading 
                ? 'bg-gray-400 text-gray-700 cursor-not-allowed' 
                : 'bg-green-500 text-white hover:bg-green-600'
            }`}
          >
            {loading ? (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Exporting...
              </div>
            ) : (
              'Export to Google Sheets'
            )}
          </button>
          <p className="text-sm text-gray-500 mt-2">
            Create a shareable Google Sheets version of your 4-year plan
          </p>
        </div>
      </div>
    </div>
  );
};

export default CoursePlanner;
