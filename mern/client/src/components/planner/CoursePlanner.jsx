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
  onExportToPdf,
  loading = false,
}) => {
  
  return (
    <div className="space-y-4 md:space-y-6">
      {schedule.map((year, yearIndex) => (
        <YearBlock
          key={yearIndex}
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
      
      {/* Export Options */}
      <div className="mt-6 px-2 md:px-4">
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 md:p-6 text-center hover:border-blue-400 hover:bg-gray-50 transition-colors">
          <svg className="w-6 h-6 md:w-8 md:h-8 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div className="flex flex-col gap-3 justify-center">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={onExportToPdf}
                disabled={loading}
                className={`px-6 py-3 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 w-full sm:w-auto ${
                  loading 
                    ? 'bg-gray-400 text-gray-700 cursor-not-allowed' 
                    : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
              >
                {loading ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Exporting...
                  </div>
                ) : (
                  'Export to PDF'
                )}
              </button>
              <button
                onClick={onExportToSheets}
                disabled={true}
                className="px-6 py-3 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2 bg-gray-400 text-gray-700 cursor-not-allowed w-full sm:w-auto"
              >
                Export to Google Sheets
              </button>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="relative group">
                <div className="w-5 h-5 bg-gray-500 text-white rounded-full flex items-center justify-center text-xs font-bold cursor-help">
                  ?
                </div>
                <div className="absolute left-1/2 transform -translate-x-1/2 top-full mt-2 w-64 bg-gray-800 text-white text-sm rounded-lg p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-[9999]">
                  Google Sheets export feature currently under maintenance.
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-800"></div>
                </div>
              </div>
            </div>
          </div>
          <p className="text-xs md:text-sm text-gray-500 mt-2">
            Export your 4-year plan as a form-fillable PDF or shareable Google Sheets
          </p>
        </div>
      </div>
    </div>
  );
};

export default CoursePlanner;
