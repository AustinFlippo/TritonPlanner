import { useState } from "react";
import {
  Search,
  WifiOff,
  X,
  Maximize2,
  Minimize2,
  ChevronDown,
  PanelRightClose,
} from "lucide-react";
import CourseItem from "./CourseItem";
import LoadingSpinner from "../LoadingSpinner";
import { AUDIT_REQUIREMENT_DRAG_TYPE } from "../../utils/recommendations";

const LEVELS = [
  { key: "lower", label: "Lower" },
  { key: "upper", label: "Upper" },
  { key: "grad", label: "Grad" },
];

const QUARTERS = [
  { key: "FA", label: "F" },
  { key: "WI", label: "W" },
  { key: "SP", label: "S" },
];

const chipClass = (active) =>
  `px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
    active
      ? "bg-navy-100 border-navy-300 text-navy-700"
      : "bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-500"
  }`;

// Stronger treatment for the live "next quarter" filter — it is the primary
// offering filter, distinct from the historical F/W/S harvest chips.
const nextChipClass = (active) =>
  `px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${
    active
      ? "bg-navy-500 border-navy-500 text-white"
      : "bg-white border-navy-200 text-navy-600 hover:border-navy-400 hover:bg-navy-50"
  }`;

const CourseSearch = ({
  searchTerm,
  searchResults,
  searchTotal,
  searchError,
  filters,
  setFilters,
  departments,
  setSearchTerm,
  handleDragStart,
  handleDragEnd,
  debouncedSearch,
  isCourseLoading,
  onCourseClick,
  expandState,
  onToggleExpand,
  onMinimize,
  recommendations = [],
  hasAudit = false,
  requirementSearch = null,
  onRequirementDrop,
  onClearRequirementSearch,
  nextQuarterOnly = false,
  onToggleNextQuarter,
  enrollmentQuarter = null,
  tssOfferings = null,
}) => {
  // Which recommendation accordions are open; first one starts open
  const [openReqs, setOpenReqs] = useState(() => new Set([0]));
  const [requirementDragActive, setRequirementDragActive] = useState(false);
  const toggleReq = (idx) =>
    setOpenReqs((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  const toggleIn = (list, value) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const toggleLevel = (key) => {
    onClearRequirementSearch?.();
    setFilters((f) => ({ ...f, levels: toggleIn(f.levels, key) }));
  };
  const toggleQuarter = (key) => {
    if (nextQuarterOnly) return; // shared next-quarter list owns the offering question
    onClearRequirementSearch?.();
    setFilters((f) => ({ ...f, quarters: toggleIn(f.quarters, key) }));
  };
  const setDept = (code) => {
    onClearRequirementSearch?.();
    setFilters((f) => ({ ...f, depts: code ? [code] : [] }));
  };

  const activeDept = filters.depts[0] || null;
  const browsing = searchTerm.trim() === "" && !activeDept;

  const isRequirementDrag = (event) =>
    Array.from(event.dataTransfer?.types || []).includes(
      AUDIT_REQUIREMENT_DRAG_TYPE
    );

  const handleRequirementDragOver = (event) => {
    if (!isRequirementDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setRequirementDragActive(true);
  };

  const handleRequirementDrop = (event) => {
    if (!isRequirementDrag(event)) return;
    event.preventDefault();
    setRequirementDragActive(false);
    try {
      const requirement = JSON.parse(
        event.dataTransfer.getData(AUDIT_REQUIREMENT_DRAG_TYPE)
      );
      if (requirement?.title && requirement?.codes?.length) {
        onRequirementDrop?.(requirement);
      }
    } catch {
      // Ignore malformed drag data from outside the app.
    }
  };

  return (
    <div
      className={`relative h-full flex flex-col transition-colors ${
        requirementDragActive ? "bg-navy-50/40" : ""
      }`}
      onDragEnter={handleRequirementDragOver}
      onDragOver={handleRequirementDragOver}
      onDragLeave={(event) => {
        if (
          !event.relatedTarget ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setRequirementDragActive(false);
        }
      }}
      onDrop={handleRequirementDrop}
    >
      {requirementDragActive && (
        <div className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-navy-400 bg-white/90">
          <div className="text-center px-4">
            <p className="text-sm font-semibold text-navy-700">
              Drop to find matching courses
            </p>
          </div>
        </div>
      )}
      {/* Panel header */}
      <div className="h-11 px-4 flex items-center justify-between border-b border-slate-200 flex-shrink-0">
        <h2 className="panel-heading">Course Search</h2>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="p-1 rounded text-slate-400 hover:text-navy-600 hover:bg-slate-100 transition-colors"
            onClick={onToggleExpand}
            title={expandState === "expanded" ? "Restore side panel (Esc)" : "Expand course search"}
          >
            {expandState === "expanded" ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
          {onMinimize && (
            <button
              type="button"
              className="p-1 rounded text-slate-400 hover:text-navy-600 hover:bg-slate-100 transition-colors"
              onClick={onMinimize}
              title="Hide panel"
              aria-label="Hide course search and assistant"
            >
              <PanelRightClose className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="p-3 flex-1 overflow-y-auto">
        {/* Search input */}
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder={activeDept ? `Search in ${activeDept}…` : "Search courses…"}
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-navy-400 focus:ring-2 focus:ring-navy-100 transition-colors"
            value={searchTerm}
            onChange={(e) => {
              const newQuery = e.target.value;
              onClearRequirementSearch?.();
              setSearchTerm(newQuery);
              debouncedSearch(newQuery);
            }}
          />
        </div>

        {/* Filter chips: next-quarter (shared schedule) + level + historical quarters */}
        <div className="flex flex-wrap items-center gap-1 mb-2">
          {onToggleNextQuarter && enrollmentQuarter && (
            <>
              <button
                type="button"
                className={nextChipClass(nextQuarterOnly)}
                onClick={() => onToggleNextQuarter()}
                title={
                  requirementSearch
                    ? `Also require offerings in ${enrollmentQuarter.label} (keeps the requirement filter)`
                    : `Only courses offered ${enrollmentQuarter.label} (shared schedule)`
                }
                aria-pressed={nextQuarterOnly}
              >
                Next · {enrollmentQuarter.chipLabel}
              </button>
              <span className="w-px h-4 bg-slate-200 mx-0.5" />
            </>
          )}
          {LEVELS.map(({ key, label }) => (
            <button
              key={key}
              className={chipClass(filters.levels.includes(key))}
              onClick={() => toggleLevel(key)}
              title={`Toggle ${label.toLowerCase()}-division courses`}
            >
              {label}
            </button>
          ))}
          <span className="w-px h-4 bg-slate-200 mx-0.5" />
          {QUARTERS.map(({ key, label }) => (
            <button
              key={key}
              className={`${chipClass(filters.quarters.includes(key))} ${
                nextQuarterOnly ? "opacity-40 cursor-not-allowed" : ""
              }`}
              onClick={() => toggleQuarter(key)}
              title={
                nextQuarterOnly
                  ? `Using the shared ${enrollmentQuarter?.label || "next quarter"} schedule — turn off Next to filter by historical offerings`
                  : `Only courses offered ${key} (historical catalog)`
              }
              disabled={nextQuarterOnly}
              aria-pressed={filters.quarters.includes(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {nextQuarterOnly && (
          <div className="mb-2 rounded-lg border border-navy-100 bg-navy-50/60 px-2.5 py-1.5 text-[11px] text-navy-700">
            {tssOfferings?.status === "loading" &&
              `Loading ${enrollmentQuarter?.label || "next quarter"} schedule…`}
            {tssOfferings?.status === "ready" && (
              <>
                {tssOfferings.source === "tss"
                  ? "From your TSS session"
                  : "Shared schedule"}{" "}
                · {enrollmentQuarter?.label}
                {typeof tssOfferings.count === "number"
                  ? ` · ${tssOfferings.count.toLocaleString()} courses`
                  : ""}
                {tssOfferings.truncated ? " · list may be incomplete" : ""}
              </>
            )}
            {tssOfferings?.status === "error" && (
              <span className="text-amber-800">{tssOfferings.reason}</span>
            )}
            {tssOfferings?.status === "idle" &&
              `Courses offered ${enrollmentQuarter?.label || "next quarter"}`}
          </div>
        )}

        {/* Active department chip */}
        {activeDept && (
          <div className="mb-2">
            <button
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-navy-500 text-white hover:bg-navy-600 transition-colors"
              onClick={() => setDept(null)}
              title="Clear department"
            >
              {activeDept}
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {requirementSearch ? (
          <div>
            <div className="mb-2 rounded-lg border border-navy-200 bg-navy-50 px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-navy-500">
                    Requirement matches
                  </p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-700 truncate">
                    {requirementSearch.title}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {requirementSearch.needs
                      ? `Needs ${requirementSearch.needs} · `
                      : ""}
                    {nextQuarterOnly
                      ? `Offered ${enrollmentQuarter?.chipLabel || "next"} · `
                      : ""}
                    Ready courses ranked first
                  </p>
                </div>
                <button
                  type="button"
                  className="p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-white"
                  onClick={onClearRequirementSearch}
                  title="Clear requirement matches"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {requirementSearch.loading ? (
              <div className="flex justify-center py-6">
                <LoadingSpinner />
              </div>
            ) : requirementSearch.error ? (
              <div className="text-center py-6 px-2">
                <WifiOff className="w-5 h-5 mx-auto mb-2 text-slate-300" />
                <p className="text-xs text-slate-500">
                  {requirementSearch.error}
                </p>
              </div>
            ) : requirementSearch.courses.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">
                {nextQuarterOnly
                  ? `No unplanned courses for this requirement are on the ${
                      enrollmentQuarter?.label || "next-quarter"
                    } schedule.`
                  : "No unplanned catalog courses were found for this requirement."}
              </p>
            ) : (
              <div>
                <p className="text-[11px] text-slate-400 mb-1.5 px-0.5">
                  {requirementSearch.courses.length} eligible course
                  {requirementSearch.courses.length === 1 ? "" : "s"}
                  {nextQuarterOnly
                    ? ` · ${enrollmentQuarter?.chipLabel || "next"}`
                    : ""}
                </p>
                <div className="space-y-2">
                  {requirementSearch.courses.map((rec) => (
                    <CourseItem
                      key={rec.course.course_id}
                      course={rec.course}
                      prereqsMet={rec.prereqs_met}
                      onDragStart={(e) =>
                        handleDragStart(e, rec.course, true)
                      }
                      onDragEnd={handleDragEnd}
                      onClick={onCourseClick}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : isCourseLoading ? (
          <div className="flex justify-center py-6">
            <LoadingSpinner />
          </div>
        ) : searchError ? (
          <div className="text-center py-6 px-2">
            <WifiOff className="w-5 h-5 mx-auto mb-2 text-slate-300" />
            <p className="text-xs text-slate-500">{searchError}</p>
            <p className="text-[11px] text-slate-400 mt-1">
              Make sure the server is running, then try again.
            </p>
          </div>
        ) : browsing ? (
          /* Default state: recommendations from the degree audit, then
             browse-by-department */
          <div>
            {!nextQuarterOnly && (
              <div className="mb-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5 px-0.5">
                  Recommended for you
                </p>
                {recommendations.length > 0 ? (
                  <div className="space-y-1">
                    {recommendations.map((req, idx) => {
                      const open = openReqs.has(idx);
                      const readyCount = req.courses.filter(
                        (c) => c.prereqs_met === true
                      ).length;
                      return (
                        <div
                          key={req.title}
                          className="border border-slate-200 rounded-lg overflow-hidden"
                        >
                          <button
                            className="w-full px-2.5 py-2 flex items-center justify-between gap-2 bg-slate-50 hover:bg-navy-50 transition-colors text-left"
                            onClick={() => toggleReq(idx)}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-slate-700 truncate">
                                {req.title}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {req.needs ? `Needs ${req.needs}` : "Unmet"} ·{" "}
                                {req.courses.length} option
                                {req.courses.length === 1 ? "" : "s"}
                                {readyCount > 0 && ` · ${readyCount} ready now`}
                              </div>
                            </div>
                            <ChevronDown
                              className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform ${
                                open ? "rotate-180" : ""
                              }`}
                            />
                          </button>
                          {open && (
                            <div className="p-1.5 space-y-1.5 bg-white">
                              {req.courses.map((rec) => (
                                <CourseItem
                                  key={rec.course.course_id}
                                  course={rec.course}
                                  prereqsMet={rec.prereqs_met}
                                  onDragStart={(e) =>
                                    handleDragStart(e, rec.course, true)
                                  }
                                  onDragEnd={handleDragEnd}
                                  onClick={onCourseClick}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 px-0.5">
                    {hasAudit
                      ? "No unmet requirements with suggested courses — nice work."
                      : "Upload your degree audit (left sidebar) to see courses that fill your remaining requirements."}
                  </p>
                )}
              </div>
            )}
            {nextQuarterOnly && (
              <p className="text-[11px] text-slate-500 mb-2 px-0.5">
                Pick a department or search — results are courses on the shared{" "}
                {enrollmentQuarter?.label || "next quarter"} schedule.
              </p>
            )}
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5 px-0.5">
              Browse by department
              {nextQuarterOnly && tssOfferings?.status === "ready"
                ? ` · ${enrollmentQuarter?.chipLabel || "next"}`
                : ""}
            </p>
            <div className="grid grid-cols-2 gap-1">
              {departments.map(({ code, count }) => (
                <button
                  key={code}
                  className="flex justify-between items-baseline px-2 py-1.5 rounded-md text-left border border-slate-200 bg-white hover:border-navy-300 hover:bg-navy-50 transition-colors"
                  onClick={() => setDept(code)}
                >
                  <span className="text-xs font-semibold text-slate-700 truncate">
                    {code}
                  </span>
                  <span className="text-[10px] tabular-nums text-slate-400 flex-shrink-0 ml-1">
                    {count}
                  </span>
                </button>
              ))}
            </div>
            {departments.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-6">
                {nextQuarterOnly && tssOfferings?.status === "loading"
                  ? "Loading departments…"
                  : nextQuarterOnly && tssOfferings?.status === "error"
                    ? "Shared schedule unavailable."
                    : "Loading departments…"}
              </p>
            )}
          </div>
        ) : searchResults.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-6">
            {nextQuarterOnly
              ? `No ${enrollmentQuarter?.label || "next-quarter"} offerings${
                  searchTerm.trim() ? ` matching “${searchTerm.trim()}”` : ""
                }.`
              : `No results${searchTerm.trim() ? ` for “${searchTerm.trim()}”` : ""}.`}
          </p>
        ) : (
          <div>
            <p className="text-[11px] text-slate-400 mb-1.5 px-0.5">
              {searchTotal} course{searchTotal === 1 ? "" : "s"}
              {nextQuarterOnly ? ` this quarter` : ""}
              {searchTotal > searchResults.length
                ? ` · showing first ${searchResults.length}`
                : ""}
            </p>
            <div className="space-y-2">
              {searchResults.map((course) => (
                <CourseItem
                  key={course.course_id}
                  course={course}
                  onDragStart={(e) => handleDragStart(e, course, true)}
                  onDragEnd={handleDragEnd}
                  onClick={onCourseClick}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CourseSearch;
