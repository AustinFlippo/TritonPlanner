import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  CalendarRange,
  ArrowRight,
  Maximize2,
  Minimize2,
  TriangleAlert,
} from "lucide-react";
import { API_URL } from "../utils/api";
import {
  quarterHasCourse,
  removeCourseAt,
  insertCourse,
  updateCourseInQuarter,
  enrollmentFromPackage,
} from "../utils/scheduleOps";
import WeekSchedule from "./quarter/WeekSchedule";
import SavePlanControl from "./planner/SavePlanControl";
import { fetchPublishedTerm } from "../utils/termSections";
import {
  fetchLiveSeatCounts,
  fetchServerTerm,
  overlayLiveSeats,
} from "../utils/nextQuarterOfferings";
import { parseCredits, hasUnknownCredits } from "../utils/courseCredits";
import {
  isBridgeInstalled,
  requestLiveSections,
  requestScrapedSections,
  subscribeToSections,
} from "../../../../booking-bridge/core/plannerBridge.js";

const TERMS = ["fall", "winter", "spring"];
const TERM_LABELS = { fall: "Fall", winter: "Winter", spring: "Spring" };
const TERM_CODES = { fall: "FA", winter: "WI", spring: "SP" };

// "2026-2027" + fall → 2026; winter/spring fall in the second calendar year
const termCalendarYear = (yearLabel, term) => {
  const [start, end] = yearLabel.split("-");
  return term === "fall" ? start : end;
};

const quarterTitle = (yearLabels, yearIndex, term) =>
  `${TERM_LABELS[term]} ${termCalendarYear(yearLabels[yearIndex] || "", term)}`;

const flatIndex = (yearIndex, term) => yearIndex * 3 + TERMS.indexOf(term);

const coursesIn = (schedule, yearIndex, term) =>
  (schedule?.[yearIndex]?.[term] || []).filter(Boolean);

// Sums only courses with a published unit count; unknowns are reported
// separately rather than silently counted as zero.
const unitsOf = (courses) =>
  courses.reduce(
    (sum, c) => sum + (hasUnknownCredits(c) ? 0 : parseCredits(c.credits, 0)),
    0
  );

const unknownUnitCount = (courses) =>
  courses.filter((c) => c && hasUnknownCredits(c)).length;

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

const QuarterlyView = ({
  schedule,
  setSchedule,
  yearLabels = [],
  enrollmentSlot = null,
  activeSavedPlan = null,
  onSavedPlanChange,
  onNavigate,
  mainExpanded = false,
  onToggleMainExpand,
  onOpenCourse,
  buildFreshSchedule = null,
}) => {
  // Lens onto the upcoming enrollment quarter of the active plan's grid —
  // the only term with TSS / published section data.
  const selected = useMemo(() => {
    // enrollmentSlot is derived from the student's plan window in MainLayout.
    return enrollmentSlot
      ? { yearIndex: enrollmentSlot.yearIndex, term: enrollmentSlot.term }
      : { yearIndex: 0, term: "fall" };
  }, [enrollmentSlot]);

  const title = quarterTitle(yearLabels, selected.yearIndex, selected.term);

  // course_id → { loading, catalog, graph }
  const [details, setDetails] = useState({});

  // Drop-target highlight for the week calendar
  const [weekTarget, setWeekTarget] = useState(false);

  // Week-calendar: live TSS section data via the booking-bridge extension
  // (times, seats, instructors).
  const [bridgeStatus, setBridgeStatus] = useState("checking");
  const [tssSections, setTssSections] = useState({});
  const [sectionsUpdatedAt, setSectionsUpdatedAt] = useState(null);
  // null | "loading" | {ok, count, reason, needsSignIn} for the visible quarter
  const [liveFetch, setLiveFetch] = useState(null);
  // The admin-published schedule for the visible quarter. Merged under whatever
  // the extension has locally, so a student running it still sees live seats.
  const [publishedSections, setPublishedSections] = useState({});

  // Every live seat payload seen so far, kept so it can be re-applied.
  //
  // The two fetches race and the small one nearly always wins: /seats is a
  // handful of courses while /next-quarter is several megabytes of term
  // schedule. Overlaying live seats onto the not-yet-arrived baseline wrote
  // them onto `{}` and threw them away, and `publishedSections` is not (and
  // should not be) a dependency of the fetch effect, so nothing ever re-ran.
  // Holding the payload makes the overlay order-independent: whichever lands
  // second re-applies it. overlayLiveSeats only touches seat fields, so
  // re-applying is idempotent.
  const liveSeatsRef = useRef({});

  const hasAnyCourses = useMemo(
    () =>
      Array.isArray(schedule) &&
      schedule.some((year) => TERMS.some((t) => (year?.[t] || []).some(Boolean))),
    [schedule]
  );

  const courses = coursesIn(schedule, selected.yearIndex, selected.term);
  const courseIdsKey = courses.map((c) => c.course_id).join("|");
  const units = unitsOf(courses);
  const unknownUnits = unknownUnitCount(courses);
  const workload = workloadFor(units);

  // TSS's AcademicYear is the *start* of the academic year — Fall 2026, Winter
  // 2027 and Spring 2027 are all AcademicYear 2026 — so use the label's first
  // half rather than the term's calendar year.
  const academicYear = yearLabels[selected.yearIndex]?.split("-")[0];

  // Refresh seat counts for the courses on screen. Class Planner (via the
  // server proxy) is the primary — public, tracks TSS within minutes, works
  // for everyone. The extension's TSS session is only asked if the proxy
  // fails, in which case its rows land via subscribeToSections as before.
  const refreshLiveSections = useCallback(
    async (courseIds) => {
      const ids = (courseIds || []).filter(Boolean);
      if (!ids.length || !academicYear || !selected.term) return null;

      const live = await fetchLiveSeatCounts(ids);
      if (live.ok && Object.keys(live.courses).length) {
        liveSeatsRef.current = { ...liveSeatsRef.current, ...live.courses };
        setPublishedSections((prev) => overlayLiveSeats(prev, live.courses));
        if (live.checkedAt) setSectionsUpdatedAt(live.checkedAt);
        return { ok: true, count: ids.length, stale: live.stale };
      }

      if (bridgeStatus !== "connected") {
        return { ok: false, reason: "seat refresh unavailable" };
      }
      const result = await requestLiveSections({
        courseIds: ids,
        year: academicYear,
        term: selected.term,
      });
      const sections = await requestScrapedSections();
      setTssSections(sections || {});
      if (result?.updatedAt) setSectionsUpdatedAt(result.updatedAt);
      return result;
    },
    [academicYear, selected.term, bridgeStatus]
  );

  const applyLiveFetchResult = useCallback((result, prev) => {
    if (!result) return prev;
    if (!result.ok) {
      return {
        ok: Boolean(prev?.published),
        count: prev?.count ?? 0,
        published: prev?.published,
        reason: result.reason,
        needsSignIn: Boolean(result.needsSignIn),
        // A failed refresh means the numbers on screen are the snapshot's.
        stale: true,
        serverTerm: prev?.serverTerm,
        diagnosis: result.diagnosis,
        offeringsFound: result.offeringsFound,
        codesQueried: result.codesQueried,
        comparison: result.comparison,
        extensionVersion: result.extensionVersion,
      };
    }
    return {
      ok: true,
      count: Math.max(prev?.count ?? 0, result.count ?? 0),
      published: prev?.published,
      // The server sets `stale` when it could not reach Class Planner and
      // echoed snapshot numbers instead. Dropping it here made a Class Planner
      // outage indistinguishable from a good refresh — the grid claimed live
      // seats it did not have.
      stale: Boolean(result.stale),
      serverTerm: prev?.serverTerm,
      diagnosis: result.diagnosis,
      offeringsFound: result.offeringsFound,
      codesQueried: result.codesQueried,
      comparison: result.comparison,
      extensionVersion: result.extensionVersion,
      truncated: prev?.truncated,
    };
  }, []);

  const syncSections = useCallback(async () => {
    const ids = courses.map((c) => c.course_id);
    if (!ids.length) return;
    const result = await refreshLiveSections(ids);
    setLiveFetch((prev) => applyLiveFetchResult(result, prev));
  }, [applyLiveFetchResult, courses, refreshLiveSections]);

  useEffect(() => {
    let cancelled = false;
    isBridgeInstalled().then((installed) => {
      if (cancelled) return;
      setBridgeStatus(installed ? "connected" : "missing");
      if (installed) {
        requestScrapedSections().then((sections) => {
          if (!cancelled) setTssSections(sections || {});
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The extension captures while the student scrolls TSS in another tab; this
  // is how those rows land here without anyone pressing Sync.
  useEffect(
    () =>
      subscribeToSections(({ sections, updatedAt }) => {
        setTssSections(sections || {});
        if (updatedAt) setSectionsUpdatedAt(updatedAt);
        // Data arriving is proof the extension is there — better evidence than
        // the handshake, which can lose a race with this component mounting.
        setBridgeStatus("connected");
      }),
    []
  );

  /**
   * Published schedule first, the student's own extension data layered on top.
   *
   * The published copy is what everyone gets: times, instructors, rooms, no
   * extension needed. A student who *does* run the extension has fresher seat
   * counts for their own courses, and those should win — the published numbers
   * are a snapshot from whenever the admin last refreshed.
   *
   * Unverified scrape leftovers (no term/year) must not erase a verified
   * published timetable for the same course id.
   */
  const sectionsForGrid = useMemo(() => {
    const merged = { ...publishedSections };
    for (const [courseId, list] of Object.entries(tssSections || {})) {
      if (!list?.length) continue;
      const existing = merged[courseId] || [];
      const incomingVerified = list.some((s) => s.termText || s.year);
      const existingVerified = existing.some((s) => s.termText || s.year);
      if (existingVerified && !incomingVerified) continue;
      merged[courseId] = list;
    }
    return merged;
  }, [publishedSections, tssSections]);

  // Shared schedule baseline for the visible quarter: the server's Class
  // Planner feed first (UCSD's own public mirror — no extension, no TSS, no
  // admin), then whatever an admin last published as the dormant fallback.
  // Works signed-out and with no extension at all.
  useEffect(() => {
    if (!academicYear || !selected.term) return;
    let cancelled = false;
    setLiveFetch("loading");
    (async () => {
      const baseline =
        (await fetchServerTerm(academicYear, selected.term)) ||
        (await fetchPublishedTerm(academicYear, selected.term));
      if (cancelled) return;
      if (!baseline) {
        setLiveFetch({ ok: true, count: 0, published: false });
        return;
      }
      // Re-apply whatever live seats already came back while this was in
      // flight, rather than dropping them on the floor (see liveSeatsRef).
      setPublishedSections(
        overlayLiveSeats(baseline.courses || {}, liveSeatsRef.current)
      );
      setSectionsUpdatedAt(baseline.refreshedAt);
      setLiveFetch({
        ok: true,
        count: baseline.sectionCount,
        published: true,
        refreshedAt: baseline.refreshedAt,
        truncated: baseline.truncated,
        // The server can serve a different quarter than the calendar guessed
        // (Class Planner rolls over mid-enrollment). Say so rather than
        // silently drawing it under the wrong heading.
        serverTerm:
          baseline.termMatches === false
            ? { year: baseline.serverYear, term: baseline.serverTerm, code: baseline.serverTermCode }
            : null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [academicYear, selected.term]);

  // When courses are added/removed in week view, refresh their seats. Runs
  // for everyone now that the proxy needs no extension; refreshLiveSections
  // falls back to the bridge on its own when the proxy is down.
  useEffect(() => {
    if (!academicYear || !selected.term) return;
    const ids = courseIdsKey ? courseIdsKey.split("|").filter(Boolean) : [];
    if (!ids.length) return;

    let cancelled = false;
    refreshLiveSections(ids).then((result) => {
      if (cancelled || !result) return;
      setLiveFetch((prev) => applyLiveFetchResult(result, prev));
    });
    return () => {
      cancelled = true;
    };
  }, [
    applyLiveFetchResult,
    bridgeStatus,
    academicYear,
    selected.term,
    courseIdsKey,
    refreshLiveSections,
  ]);

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

  // Persist the section package (times + professors) on the course in the
  // planner grid so auto-save / Supabase keep the choice for the upcoming quarter.
  const handleSelectPackage = (course, pkg) => {
    if (!course?.course_id || !pkg) return;
    const enrollment = enrollmentFromPackage(pkg);
    if (!enrollment) return;
    setSchedule((prev) =>
      updateCourseInQuarter(
        prev,
        selected.yearIndex,
        selected.term,
        course.course_id,
        { enrollment }
      )
    );
  };

  const clearDragHighlights = () => {
    setWeekTarget(false);
  };

  // Sidebar search results add into the enrollment quarter (the only quarter
  // Quarter View edits).
  const handleDropOnQuarter = (e) => {
    e.preventDefault();
    clearDragHighlights();

    const { yearIndex, term } = selected;
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

    // Pass credits through untouched: `Number(x) || 0` turned an honest
    // "unknown" into a confident 0, which then hid the "? u" badge and shrank
    // every downstream unit total. normalizePlacedCourse handles the coercion.
    next = insertCourse(next, yearIndex, term, { ...course });
    setSchedule(next);
  };

  const lensBanner = activeSavedPlan?.name ? (
    <>
      Plan{" "}
      <span className="font-semibold text-navy-700">
        “{activeSavedPlan.name}”
      </span>{" "}
      ·{" "}
      <span className="font-semibold text-navy-700">{title}</span> — zoomed into
      this plan’s next quarter.
    </>
  ) : (
    <>
      Showing{" "}
      <span className="font-semibold text-navy-700">{title}</span> — the
      upcoming quarter with live section data.
    </>
  );

  if (!hasAnyCourses) {
    return (
      <div className={`mx-auto space-y-4 ${mainExpanded ? "max-w-none" : "max-w-5xl"}`}>
        <SavePlanControl
          schedule={schedule}
          activeSavedPlan={activeSavedPlan}
          onSavedPlanChange={onSavedPlanChange}
          onResetSchedule={setSchedule}
          buildFreshSchedule={buildFreshSchedule}
          onNavigate={onNavigate}
        />
        <div
          className="bg-white border border-slate-200 rounded-xl shadow-card px-6 py-12 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDropOnQuarter}
        >
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-navy-50 mb-3">
            <CalendarRange className="w-5 h-5 text-navy-500" />
          </span>
          <h2 className="text-base font-semibold text-slate-800 mb-1">
            Nothing planned for {title} yet
          </h2>
          <p className="text-sm text-slate-500 max-w-sm mx-auto mb-4">
            Drag a course in from Course Search, or add courses in the Planner —
            by uploading a degree audit or building a schedule — and this page
            will show the week schedule for this plan’s upcoming quarter.
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
    <div className={`mx-auto space-y-4 ${mainExpanded ? "max-w-none" : "max-w-5xl"}`}>
      <SavePlanControl
        schedule={schedule}
        activeSavedPlan={activeSavedPlan}
        onSavedPlanChange={onSavedPlanChange}
        onResetSchedule={setSchedule}
        buildFreshSchedule={buildFreshSchedule}
        onNavigate={onNavigate}
      />

      <div className="bg-white border border-slate-200 rounded-xl shadow-card px-4 py-2.5">
        <p className="text-xs text-slate-500">{lensBanner}</p>
      </div>

      {/* UCSD's schedule feed has moved on to a different quarter than this
          plan slot. Showing it is still the useful thing — it is the quarter
          enrollment is actually open for — but never without saying so. */}
      {liveFetch?.serverTerm?.term && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <TriangleAlert className="w-4 h-4 mt-px flex-shrink-0" />
          <span>
            UCSD&rsquo;s schedule feed has moved on to{" "}
            <strong>
              {TERM_LABELS[liveFetch.serverTerm.term] || liveFetch.serverTerm.term}
              {liveFetch.serverTerm.code ? ` (${liveFetch.serverTerm.code})` : ""}
            </strong>
            . The sections below are that quarter&rsquo;s, not {title}&rsquo;s.
          </span>
        </div>
      )}

      {/* Selected quarter header */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-card px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-slate-800">
            {title}
            <span className="ml-2 text-sm font-normal text-slate-400">
              Year {selected.yearIndex + 1}
            </span>
          </h2>
          <p className="text-xs text-slate-500">
            {activeSavedPlan?.name
              ? `Editing “${activeSavedPlan.name}” · `
              : ""}
            {courses.length} course{courses.length === 1 ? "" : "s"} ·{" "}
            {units.toFixed(1)} units
            {unknownUnits > 0 && (
              <span
                className="text-amber-600"
                title={`${unknownUnits} course${
                  unknownUnits === 1 ? "" : "s"
                } here have no published unit count, so they aren't in this total.`}
              >
                {" "}
                + {unknownUnits} ?
              </span>
            )}
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

        {onToggleMainExpand && (
          <button
            type="button"
            onClick={onToggleMainExpand}
            className="p-1.5 rounded-lg text-slate-400 hover:text-navy-600 hover:bg-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
            title={
              mainExpanded
                ? "Restore side panels (Esc)"
                : "Expand quarter view"
            }
            aria-label={
              mainExpanded
                ? "Restore side panels"
                : "Expand quarter view"
            }
          >
            {mainExpanded ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      <WeekSchedule
        courses={courses}
        sectionsByCourse={sectionsForGrid}
        bridgeStatus={bridgeStatus}
        onSync={syncSections}
        updatedAt={sectionsUpdatedAt}
        year={academicYear}
        term={selected.term}
        termLabel={title}
        liveFetch={liveFetch}
        onRemove={handleRemove}
        onSelectPackage={handleSelectPackage}
        onOpenCourse={onOpenCourse}
        dropActive={weekTarget}
        onDragOver={(e) => {
          e.preventDefault();
          setWeekTarget(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setWeekTarget(false);
        }}
        onDrop={handleDropOnQuarter}
      />
    </div>
  );
};

export default QuarterlyView;
