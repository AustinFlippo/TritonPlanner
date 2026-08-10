import { useState, useEffect, useMemo } from "react";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Plus,
  X,
} from "lucide-react";
import { API_URL } from "../utils/api";
import {
  quarterHasCourse,
  removeCourseAt,
  insertCourse,
} from "../utils/scheduleOps";

const TERMS = ["fall", "winter", "spring"];
const TERM_LABELS = { fall: "Fall", winter: "Winter", spring: "Spring" };
const TERM_CODES = { fall: "FA", winter: "WI", spring: "SP" };

// Mirrors the planner's academic years (CoursePlannerContainer yearLabels)
const YEAR_LABELS = ["2024-2025", "2025-2026", "2026-2027", "2027-2028"];

// "2026-2027" + fall → 2026; winter/spring fall in the second calendar year
const termCalendarYear = (yearLabel, term) => {
  const [start, end] = yearLabel.split("-");
  return term === "fall" ? start : end;
};

const quarterTitle = (yearIndex, term) =>
  `${TERM_LABELS[term]} ${termCalendarYear(YEAR_LABELS[yearIndex], term)}`;

const flatIndex = (yearIndex, term) => yearIndex * 3 + TERMS.indexOf(term);

// The quarter we're in (or about to start) today, if it's inside the plan
const currentQuarter = () => {
  const now = new Date();
  const month = now.getMonth();
  let term;
  if (month >= 8) term = "fall"; // Sep–Dec
  else if (month <= 2) term = "winter"; // Jan–Mar
  else if (month <= 5) term = "spring"; // Apr–Jun
  else term = "fall"; // summer → the upcoming fall

  const calYear = String(now.getFullYear());
  const yearIndex = YEAR_LABELS.findIndex(
    (label) => termCalendarYear(label, term) === calYear
  );
  return yearIndex === -1 ? null : { yearIndex, term };
};

const coursesIn = (schedule, yearIndex, term) =>
  (schedule?.[yearIndex]?.[term] || []).filter(Boolean);

const unitsOf = (courses) =>
  courses.reduce((sum, c) => sum + (Number(c.credits) || 0), 0);

const workloadFor = (units) => {
  if (units === 0) return null;
  if (units < 12)
    return { label: "Below full-time", style: "bg-amber-50 text-amber-700 border-amber-200" };
  if (units < 16)
    return { label: "Balanced load", style: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (units < 20)
    return { label: "Busy quarter", style: "bg-amber-50 text-amber-700 border-amber-200" };
  return { label: "Heavy load", style: "bg-red-50 text-red-700 border-red-200" };
};

const STATUS_BADGES = {
  completed: { label: "Completed", style: "bg-emerald-50 text-emerald-600" },
  current: { label: "In progress", style: "bg-amber-50 text-amber-600" },
  planned: { label: "Planned", style: "bg-navy-50 text-navy-500" },
};

// Catalog descriptions embed the prereq sentence; strip it like CourseDetails does
const cleanDescription = (description) => {
  if (!description) return null;
  const idx = description.toLowerCase().indexOf("prerequisites:");
  const text = (idx === -1 ? description : description.slice(0, idx)).trim();
  return text || null;
};

const QuarterCourseCard = ({
  course,
  term,
  detail,
  prereqCheck,
  onDragStart,
  onDragEnd,
  onRemove,
}) => {
  const badge = STATUS_BADGES[course.status];
  const catalog = detail?.catalog;
  const description = cleanDescription(catalog?.description);
  const offerings = Array.isArray(catalog?.offerings) ? catalog.offerings : [];
  const notOffered =
    course.status !== "completed" &&
    course.status !== "current" &&
    offerings.length > 0 &&
    !offerings.includes(TERM_CODES[term]);

  return (
    <div
      className="group bg-white border border-slate-200 rounded-xl shadow-card px-4 py-3 cursor-grab active:cursor-grabbing hover:shadow-panel hover:border-slate-300 transition-all"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-800">
            {course.course_id}
          </span>
          <span className="text-sm text-slate-500 truncate">
            {catalog?.course_name || course.course_name || ""}
          </span>
          {badge && (
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${badge.style}`}
            >
              {badge.label}
            </span>
          )}
          {course.grade && course.status === "completed" && (
            <span className="text-[11px] text-slate-400">Grade: {course.grade}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-xs tabular-nums text-slate-500">
            {(Number(course.credits) || 0).toFixed(1)} units
          </span>
          <button
            onClick={onRemove}
            className="p-0.5 rounded text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-red-400"
            title={`Remove ${course.course_id} from this quarter`}
            aria-label={`Remove ${course.course_id}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {detail?.loading ? (
        <p className="mt-1.5 text-xs text-slate-300">Loading course details…</p>
      ) : (
        <>
          {description && (
            <p className="mt-1.5 text-xs text-slate-500 leading-relaxed line-clamp-2">
              {description}
            </p>
          )}

          {(prereqCheck || notOffered || offerings.length > 0) && (
            <div className="mt-2 space-y-1">
              {prereqCheck?.missing.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                  <span>
                    Missing prerequisite{prereqCheck.missing.length > 1 ? "s" : ""}:{" "}
                    {prereqCheck.missing
                      .map((group) => group.join(" or "))
                      .join("; ")}{" "}
                    — plan these in an earlier quarter.
                  </span>
                </p>
              )}
              {prereqCheck && prereqCheck.missing.length === 0 && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-600">
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                  Prerequisites satisfied by earlier quarters
                </p>
              )}
              {notOffered && (
                <p className="flex items-center gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  Not usually offered in {TERM_LABELS[term]} (offered:{" "}
                  {offerings.join(", ")})
                </p>
              )}
              {!notOffered && offerings.length > 0 && !prereqCheck && (
                <p className="text-[11px] text-slate-400">
                  Offered: {offerings.join(", ")}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const QuarterlyView = ({ schedule, setSchedule, onNavigate }) => {
  const [selected, setSelected] = useState(
    () => currentQuarter() || { yearIndex: 0, term: "fall" }
  );

  // course_id → { loading, catalog, graph }; grows as quarters are visited
  const [details, setDetails] = useState({});

  // Drop-target highlights: a timeline chip {yearIndex, term}, or the list
  const [chipTarget, setChipTarget] = useState(null);
  const [listTarget, setListTarget] = useState(false);

  const hasAnyCourses = useMemo(
    () =>
      Array.isArray(schedule) &&
      schedule.some((year) => TERMS.some((t) => (year?.[t] || []).some(Boolean))),
    [schedule]
  );

  // If today's quarter is empty but the plan isn't, start on the first
  // quarter that has courses so the page never opens looking blank
  useEffect(() => {
    if (!hasAnyCourses) return;
    setSelected((sel) => {
      if (coursesIn(schedule, sel.yearIndex, sel.term).length > 0) return sel;
      for (let y = 0; y < 4; y++) {
        for (const t of TERMS) {
          if (coursesIn(schedule, y, t).length > 0) return { yearIndex: y, term: t };
        }
      }
      return sel;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAnyCourses]);

  const courses = coursesIn(schedule, selected.yearIndex, selected.term);
  const units = unitsOf(courses);
  const workload = workloadFor(units);

  // Fetch catalog details + prereq graph for courses in the selected quarter
  useEffect(() => {
    const missing = courses
      .map((c) => c.course_id)
      .filter((id) => id && !details[id]);
    if (missing.length === 0) return;

    setDetails((prev) => {
      const next = { ...prev };
      missing.forEach((id) => (next[id] = { loading: true }));
      return next;
    });

    missing.forEach((id) => {
      const catalogReq = fetch(`${API_URL}/search-courses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: id }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (data) =>
            data?.results?.find((c) => c.course_id === id) ||
            data?.results?.[0] ||
            null
        )
        .catch(() => null);

      const graphReq = fetch(
        `${API_URL}/search-courses/graph?course_id=${encodeURIComponent(id)}`
      )
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      Promise.all([catalogReq, graphReq]).then(([catalog, graph]) => {
        setDetails((prev) => ({
          ...prev,
          [id]: { loading: false, catalog, graph },
        }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses.map((c) => c.course_id).join("|")]);

  // Everything scheduled before the selected quarter, plus anything already
  // completed — the pool that can satisfy prerequisites
  const priorCourseIds = useMemo(() => {
    const ids = new Set();
    if (!Array.isArray(schedule)) return ids;
    const selectedFlat = flatIndex(selected.yearIndex, selected.term);
    schedule.forEach((year, y) =>
      TERMS.forEach((t) => {
        (year?.[t] || []).filter(Boolean).forEach((c) => {
          if (flatIndex(y, t) < selectedFlat || c.status === "completed") {
            ids.add(c.course_id);
          }
        });
      })
    );
    return ids;
  }, [schedule, selected]);

  // For planned courses with known prereq groups: which groups aren't
  // satisfied by any earlier/completed course?
  const prereqCheckFor = (course) => {
    if (course.status === "completed" || course.status === "current") return null;
    const graph = details[course.course_id]?.graph;
    if (!graph?.requires?.length) return null;
    const missing = graph.requires.filter(
      (group) => !group.some((id) => priorCourseIds.has(id))
    );
    return { missing };
  };

  const warningCount = courses.reduce((count, course) => {
    const check = prereqCheckFor(course);
    let n = check && check.missing.length > 0 ? 1 : 0;
    const catalog = details[course.course_id]?.catalog;
    if (
      course.status !== "completed" &&
      course.status !== "current" &&
      Array.isArray(catalog?.offerings) &&
      catalog.offerings.length > 0 &&
      !catalog.offerings.includes(TERM_CODES[selected.term])
    ) {
      n += 1;
    }
    return count + n;
  }, 0);

  const selectedFlat = flatIndex(selected.yearIndex, selected.term);
  const step = (delta) => {
    const next = Math.min(11, Math.max(0, selectedFlat + delta));
    setSelected({ yearIndex: Math.floor(next / 3), term: TERMS[next % 3] });
  };

  // ---- Editing ----

  const handleRemove = (course) => {
    const slotIndex = (schedule[selected.yearIndex][selected.term] || []).findIndex(
      (c) => c && c.course_id === course.course_id
    );
    if (slotIndex === -1) return;
    setSchedule(
      removeCourseAt(schedule, selected.yearIndex, selected.term, slotIndex)
    );
  };

  // Cards dragged from this view carry their origin, same keys as the planner
  const handleCardDragStart = (e, course) => {
    const slotIndex = (schedule[selected.yearIndex][selected.term] || []).findIndex(
      (c) => c && c.course_id === course.course_id
    );
    e.dataTransfer.setData("course", JSON.stringify(course));
    e.dataTransfer.setData("isFromSidebar", "false");
    e.dataTransfer.setData("sourceYearIndex", String(selected.yearIndex));
    e.dataTransfer.setData("sourceTerm", selected.term);
    e.dataTransfer.setData("sourceCourseIndex", String(slotIndex));
  };

  const clearDragHighlights = () => {
    setChipTarget(null);
    setListTarget(false);
  };

  // Shared drop handler: sidebar search results add, quarter cards move
  const handleDropOnQuarter = (e, yearIndex, term) => {
    e.preventDefault();
    clearDragHighlights();

    const raw = e.dataTransfer.getData("course");
    if (!raw) return;
    let course;
    try {
      course = JSON.parse(raw);
    } catch {
      return;
    }
    if (!course?.course_id) return;

    const fromSidebar = e.dataTransfer.getData("isFromSidebar") === "true";

    // Never duplicate a course within one quarter (also makes a same-quarter
    // move a clean no-op)
    if (quarterHasCourse(schedule, yearIndex, term, course.course_id)) return;

    let next = schedule;
    if (!fromSidebar) {
      const sy = parseInt(e.dataTransfer.getData("sourceYearIndex"), 10);
      const st = e.dataTransfer.getData("sourceTerm");
      const si = parseInt(e.dataTransfer.getData("sourceCourseIndex"), 10);
      if (Number.isNaN(sy) || !TERMS.includes(st) || Number.isNaN(si)) return;
      next = removeCourseAt(next, sy, st, si);
    }

    next = insertCourse(next, yearIndex, term, {
      ...course,
      credits: Number(course.credits) || 0,
    });
    setSchedule(next);

    // Follow the course when it lands in a different quarter
    if (yearIndex !== selected.yearIndex || term !== selected.term) {
      setSelected({ yearIndex, term });
    }
  };

  const chipIsTarget = (y, t) =>
    chipTarget && chipTarget.yearIndex === y && chipTarget.term === t;

  if (!hasAnyCourses) {
    return (
      <div className="max-w-5xl mx-auto">
        <div
          className="bg-white border border-slate-200 rounded-xl shadow-card px-6 py-12 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) =>
            handleDropOnQuarter(e, selected.yearIndex, selected.term)
          }
        >
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-navy-50 mb-3">
            <CalendarRange className="w-5 h-5 text-navy-500" />
          </span>
          <h2 className="text-base font-semibold text-slate-800 mb-1">
            No quarters to show yet
          </h2>
          <p className="text-sm text-slate-500 max-w-sm mx-auto mb-4">
            Drag a course in from Course Search, or add courses in the Planner —
            by uploading a degree audit or building a schedule — and this page
            will break each quarter down in detail.
          </p>
          <button
            onClick={() => onNavigate?.("planner")}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-navy-500 text-white hover:bg-navy-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
          >
            Open Planner
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Quarter timeline: every quarter of the plan, grouped by year.
          Chips are drop targets — drag a course onto one to move/add it. */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-card px-4 py-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
          {YEAR_LABELS.map((label, y) => (
            <div key={label}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
                Year {y + 1} · {label}
              </p>
              <div className="flex gap-1">
                {TERMS.map((t) => {
                  const qCourses = coursesIn(schedule, y, t);
                  const active =
                    selected.yearIndex === y && selected.term === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setSelected({ yearIndex: y, term: t })}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setChipTarget({ yearIndex: y, term: t });
                      }}
                      onDragLeave={() => setChipTarget(null)}
                      onDrop={(e) => handleDropOnQuarter(e, y, t)}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-left border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 ${
                        chipIsTarget(y, t)
                          ? "border-gold-400 ring-2 ring-gold-400 bg-gold-300/20 text-slate-700"
                          : active
                            ? "bg-navy-500 border-navy-500 text-white"
                            : qCourses.length > 0
                              ? "bg-white border-slate-200 text-slate-700 hover:border-navy-300 hover:bg-navy-50"
                              : "bg-slate-50 border-slate-200 text-slate-400 hover:border-slate-300"
                      }`}
                      aria-pressed={active}
                      aria-label={`${TERM_LABELS[t]} ${termCalendarYear(label, t)}`}
                    >
                      <span className="block text-xs font-semibold">
                        {TERM_LABELS[t]}
                      </span>
                      <span
                        className={`block text-[10px] tabular-nums ${
                          active && !chipIsTarget(y, t)
                            ? "text-navy-100"
                            : "text-slate-400"
                        }`}
                      >
                        {qCourses.length > 0
                          ? `${unitsOf(qCourses).toFixed(0)} u · ${qCourses.length}`
                          : "—"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Selected quarter header */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-card px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => step(-1)}
          disabled={selectedFlat === 0}
          className="p-1.5 rounded-lg text-slate-400 hover:text-navy-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
          aria-label="Previous quarter"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-slate-800">
            {quarterTitle(selected.yearIndex, selected.term)}
            <span className="ml-2 text-sm font-normal text-slate-400">
              Year {selected.yearIndex + 1}
            </span>
          </h2>
          <p className="text-xs text-slate-500">
            {courses.length} course{courses.length === 1 ? "" : "s"} ·{" "}
            {units.toFixed(1)} units
            {warningCount > 0 && (
              <span className="text-amber-600 font-medium">
                {" "}
                · {warningCount} warning{warningCount === 1 ? "" : "s"}
              </span>
            )}
          </p>
        </div>

        {workload && (
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${workload.style}`}
          >
            {workload.label}
          </span>
        )}

        <button
          onClick={() => step(1)}
          disabled={selectedFlat === 11}
          className="p-1.5 rounded-lg text-slate-400 hover:text-navy-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
          aria-label="Next quarter"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Course cards — the whole list accepts drops into this quarter */}
      <div
        className="space-y-2"
        onDragOver={(e) => {
          e.preventDefault();
          setListTarget(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setListTarget(false);
        }}
        onDrop={(e) => handleDropOnQuarter(e, selected.yearIndex, selected.term)}
      >
        {courses.map((course, i) => (
          <QuarterCourseCard
            key={`${course.course_id}-${i}`}
            course={course}
            term={selected.term}
            detail={details[course.course_id]}
            prereqCheck={prereqCheckFor(course)}
            onDragStart={(e) => handleCardDragStart(e, course)}
            onDragEnd={clearDragHighlights}
            onRemove={() => handleRemove(course)}
          />
        ))}

        {/* Standing drop zone — also the empty-quarter state */}
        <div
          className={`rounded-xl border border-dashed px-4 text-center transition-colors ${
            courses.length === 0 ? "py-10" : "py-4"
          } ${
            listTarget
              ? "border-gold-400 bg-gold-300/10"
              : "border-slate-300 bg-slate-50/60"
          }`}
        >
          {courses.length === 0 && (
            <p className="text-sm text-slate-500 mb-1.5">
              Nothing planned for{" "}
              {quarterTitle(selected.yearIndex, selected.term)} yet.
            </p>
          )}
          <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <Plus className="w-3.5 h-3.5" />
            Drag a course here from Course Search, or onto any quarter above
          </p>
        </div>
      </div>
    </div>
  );
};

export default QuarterlyView;
