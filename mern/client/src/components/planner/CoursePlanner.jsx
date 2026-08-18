import { CirclePlay, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import YearBlock from "./YearBlock";
import SavePlanControl from "./SavePlanControl";
import OmittedCreditsNote from "./OmittedCreditsNote";
import { WatchDemoButton } from "../HowItWorks";

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
  handleClearYear,
  previewState,
  dragTarget,
  dropWarning,
  getCourseWarning,
  getPrereqWarning,
  getSlotClassName,
  onExportToSheets,
  activeSavedPlan,
  onSavedPlanChange,
  onResetSchedule,
  buildFreshSchedule,
  onNavigate,
  loading = false,
  onOpenCourse,
  omittedCourses = [],
}) => {
  const scheduleIsEmpty = schedule.every((year) =>
    ["fall", "winter", "spring"].every((term) =>
      (year[term] || []).every((course) => !course)
    )
  );

  return (
    <div className="max-w-5xl mx-auto">
      {scheduleIsEmpty && (
        <div className="mb-4 bg-white border border-slate-200 rounded-xl shadow-card px-5 py-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-navy-50 flex-shrink-0">
              <UploadCloud className="w-5 h-5 text-navy-600" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-800">
                Start with your degree audit
              </div>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Upload the HTML file on the left to place completed courses and
                track what's left. Prefer a walkthrough first?
              </p>
            </div>
          </div>
          <WatchDemoButton className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium flex-shrink-0 bg-navy-700 text-white hover:bg-navy-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 focus-visible:ring-offset-2">
            <CirclePlay size={15} />
            Watch demo
          </WatchDemoButton>
        </div>
      )}

      <SavePlanControl
        schedule={schedule}
        activeSavedPlan={activeSavedPlan}
        onSavedPlanChange={onSavedPlanChange}
        onResetSchedule={onResetSchedule}
        buildFreshSchedule={buildFreshSchedule}
        onNavigate={onNavigate}
      />

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
          handleClearYear={handleClearYear}
          previewState={previewState}
          dragTarget={dragTarget}
          dropWarning={dropWarning}
          getCourseWarning={getCourseWarning}
          getPrereqWarning={getPrereqWarning}
          getSlotClassName={getSlotClassName}
          onOpenCourse={onOpenCourse}
        />
      ))}

      <OmittedCreditsNote courses={omittedCourses} />
      
      {/* Export to Google Sheets */}
      <div className="mt-6 mb-2 bg-white border border-slate-200 rounded-xl shadow-card px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-50 flex-shrink-0">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800">
              Export your plan
            </div>
            <div className="text-xs text-slate-500 truncate">
              Download a spreadsheet of your 4-year plan (CSV for Sheets or Excel)
            </div>
          </div>
        </div>
        <button
          onClick={onExportToSheets}
          disabled={loading}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium flex-shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 focus-visible:ring-offset-2 ${
            loading
              ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
              : 'bg-navy-700 text-white hover:bg-navy-600'
          }`}
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {loading ? "Exporting…" : "Download CSV"}
        </button>
      </div>
    </div>
  );
};

export default CoursePlanner;
