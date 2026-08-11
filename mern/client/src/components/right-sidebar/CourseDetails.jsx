import React, { useEffect, useState } from "react";
import ProfessorInfo from "./ProfessorInfo";
import { KeyRound, Maximize2, Minimize2, PanelRightClose } from "lucide-react";
import { useNextQuarterOfferings } from "../../context/NextQuarterOfferingsContext";
import {
  packagesFor,
  sectionsForCourse,
  whenLabel,
} from "../../utils/sectionPackages";
import { isUnverifiedCourse } from "../../utils/courseCredits";

const STATUS_CHIP = {
  open: { className: "bg-emerald-50 text-emerald-700", label: "Open" },
  "waitlist-active": { className: "bg-amber-50 text-amber-700", label: "Waitlist" },
  "waitlist-inactive": {
    className: "bg-amber-50 text-amber-700",
    label: "Waitlist closed",
  },
  full: { className: "bg-red-50 text-red-600", label: "Full" },
  booked: { className: "bg-navy-50 text-navy-700", label: "Booked" },
  "booked-waitlist": {
    className: "bg-amber-50 text-amber-700",
    label: "On waitlist",
  },
  "conditionally-booked": {
    className: "bg-navy-50 text-navy-700",
    label: "Conditional",
  },
  unknown: { className: "bg-slate-50 text-slate-500", label: "" },
};

const statusChip = (status) => STATUS_CHIP[status] || STATUS_CHIP.unknown;

const seatsLabel = (pkg) => {
  if (Number.isFinite(pkg.seatsAvailable) && Number.isFinite(pkg.seatsTotal)) {
    return `${pkg.seatsAvailable}/${pkg.seatsTotal} seats`;
  }
  if (Number.isFinite(pkg.seatsAvailable)) {
    return `${pkg.seatsAvailable} seats`;
  }
  return statusChip(pkg.status).label || null;
};

const CourseDetails = ({
  course,
  onBack,
  onSelectCourseId,
  apiUrl,
  expandState,
  onToggleExpand,
  onMinimize,
}) => {
  const [graph, setGraph] = useState(null);
  const {
    enrollmentQuarter,
    sections,
    isOffered,
    syncLiveSeats,
    tssOfferings,
  } = useNextQuarterOfferings();

  const offeredNext = Boolean(
    course?.course_id && isOffered(course.course_id)
  );
  // Vouched for by the student's degree audit, absent from the catalog.
  const unverified = isUnverifiedCourse(course);

  useEffect(() => {
    if (!course?.course_id || !apiUrl) return;
    let cancelled = false;
    setGraph(null);
    fetch(
      `${apiUrl}/search-courses/graph?course_id=${encodeURIComponent(course.course_id)}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setGraph(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [course?.course_id, apiUrl]);

  // Refresh seats via the extension when available; published snapshot stays
  // as the baseline if the bridge is missing.
  useEffect(() => {
    if (!offeredNext || !course?.course_id) return;
    let cancelled = false;
    syncLiveSeats([course.course_id]).catch(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [offeredNext, course?.course_id, syncLiveSeats]);

  let packages = [];
  let verified = false;
  if (offeredNext && course) {
    const { sections: rows, verified: termVerified } = sectionsForCourse(
      course,
      sections,
      enrollmentQuarter?.academicYear,
      enrollmentQuarter?.term
    );
    verified = termVerified;
    // Only draw term-verified packages — scrape leftovers often belong to
    // another quarter and look authoritative next to real seat counts.
    packages = termVerified ? packagesFor(rows) : [];
  }

  if (!course) return null;

  // Extract clean description without prerequisites
  const getCleanDescription = (c) => {
    if (!c.description) return "No description available.";

    // The description field contains both description and prerequisites
    // We need to remove the prerequisites part that starts with "Prerequisites:"
    let description = c.description;

    // Find where "Prerequisites:" starts (case insensitive)
    const prereqIndex = description.toLowerCase().indexOf("prerequisites:");

    if (prereqIndex !== -1) {
      // Extract only the part before "Prerequisites:"
      description = description.substring(0, prereqIndex).trim();
    }

    // Remove any trailing periods or whitespace and clean up
    description = description.replace(/\.$/, "").trim();

    return description || "No description available.";
  };

  const hasParsedPrereqs = graph?.requires?.length > 0;
  const sectionHeading = enrollmentQuarter?.chipLabel
    ? `${enrollmentQuarter.chipLabel} sections`
    : "Next-quarter sections";

  return (
    <div className="h-full flex flex-col">
      {/* Panel header — mirrors the other sidebar panels so this view
          collapses to a clean h-11 bar when the assistant is maximized */}
      <div className="h-11 px-4 flex items-center gap-2 border-b border-slate-200 flex-shrink-0">
        <button
          onClick={onBack}
          className="text-navy-500 hover:text-navy-600 hover:underline text-sm font-medium flex-shrink-0"
          title="Back to search"
        >
          ←
        </button>
        <h2 className="panel-heading truncate flex-1">{course.course_id}</h2>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {onToggleExpand && (
            <button
              type="button"
              className="p-1 rounded text-slate-400 hover:text-navy-600 hover:bg-slate-100 transition-colors"
              onClick={onToggleExpand}
              title={
                expandState === "expanded"
                  ? "Restore side panel (Esc)"
                  : "Expand course search"
              }
            >
              {expandState === "expanded" ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}
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

      <div className="p-4 space-y-3 flex-1 overflow-y-auto">
        <h1 className="text-xl font-semibold text-slate-900">{course.course_id}</h1>
        {!unverified && (
          <h2 className="text-sm text-slate-600">{course.course_name}</h2>
        )}

        {/* The audit offers this course, so the student can plan it — but the
            catalog has no entry, and every field below would otherwise render
            as blank or "Unknown" with no explanation of why. */}
        {unverified && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-xs font-semibold text-amber-800">
              Not in the course catalog
            </p>
            <p className="mt-1 text-xs text-amber-700">
              Your degree audit lists {course.course_id}, so it counts toward a
              requirement and you can plan it. UCSD has not published a catalog
              entry, so its unit count, prerequisites and offered quarters are
              unknown here — confirm them with your advisor.
            </p>
          </div>
        )}

        <div className="text-sm text-slate-600 space-y-1">
          <p>
            <span className="font-semibold">Credits:</span>{" "}
            {unverified ? "Unknown" : course.credits}
          </p>
          <p>
            <span className="font-semibold">Offered:</span>{" "}
            {Array.isArray(course.offerings) && course.offerings.length > 0
              ? course.offerings.join(", ")
              : "Unknown"}
            {offeredNext && enrollmentQuarter?.chipLabel && (
              <span className="ml-1.5 px-1.5 py-px rounded text-[10px] font-semibold bg-navy-100 text-navy-700">
                {enrollmentQuarter.chipLabel}
              </span>
            )}
          </p>
          {hasParsedPrereqs ? (
            <div>
              <span className="font-semibold">Prerequisites:</span>
              <ul className="mt-1 space-y-1">
                {graph.requires.map((group, idx) => (
                  <li key={idx} className="text-[13px]">
                    {group.length > 1 && (
                      <span className="text-slate-400 mr-1">one of</span>
                    )}
                    {group.map((id, i) => (
                      <React.Fragment key={id}>
                        {i > 0 && <span className="text-slate-400"> / </span>}
                        <button
                          className="text-navy-500 hover:text-navy-600 hover:underline font-medium"
                          onClick={() => onSelectCourseId?.(id)}
                        >
                          {id}
                        </button>
                      </React.Fragment>
                    ))}
                  </li>
                ))}
              </ul>
              {graph.confidence === "partial" && (
                <p className="text-[11px] text-slate-400 mt-1">
                  May be satisfiable other ways — full text:{" "}
                  {course.prerequisites}
                </p>
              )}
            </div>
          ) : (
            <p>
              <span className="font-semibold">Prerequisites:</span>{" "}
              {course.prerequisites && course.prerequisites.trim() !== ""
                ? course.prerequisites
                : "None"}
            </p>
          )}
          <p>
            <span className="font-semibold">Description:</span>{" "}
            {getCleanDescription(course)}
          </p>
        </div>

        {/* Next-enrollment-quarter packages (times, instructors, seats) */}
        {offeredNext && (
          <div className="pt-1">
            <h3 className="font-semibold text-sm text-slate-800 mb-1.5">
              {sectionHeading}
            </h3>
            {tssOfferings.status === "loading" && packages.length === 0 ? (
              <p className="text-[12px] text-slate-400">Loading sections…</p>
            ) : packages.length > 0 ? (
              <ul className="space-y-2">
                {packages.map((pkg) => {
                  const chip = statusChip(pkg.status);
                  const seats = seatsLabel(pkg);
                  const primaryId = pkg.primary?.sectionId || pkg.id;
                  return (
                    <li
                      key={pkg.id}
                      className="border border-slate-200 rounded-lg px-2.5 py-2"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-semibold text-slate-800">
                          {pkg.primary?.component || "Section"}{" "}
                          {primaryId}
                        </span>
                        <span className="flex items-center gap-1.5 flex-shrink-0">
                          {chip.label && (
                            <span
                              className={`px-1.5 py-px rounded text-[10px] font-semibold ${chip.className}`}
                            >
                              {chip.label}
                            </span>
                          )}
                          {seats && (
                            <span className="text-[11px] tabular-nums text-slate-500">
                              {seats}
                            </span>
                          )}
                        </span>
                      </div>
                      {pkg.instructors.length > 0 && (
                        <p className="text-[12px] text-slate-600 mt-0.5">
                          {pkg.instructors.join(", ")}
                        </p>
                      )}
                      <ul className="mt-1 space-y-0.5">
                        {pkg.meetings.map((m) => (
                          <li
                            key={`${m.sectionId}-${m.component}-${m.start}`}
                            className="text-[11px] text-slate-500"
                          >
                            <span className="font-medium text-slate-600">
                              {m.component || "MT"}
                            </span>{" "}
                            {whenLabel(m)}
                            {m.location ? ` · ${m.location}` : ""}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[12px] text-slate-400">
                Offered {enrollmentQuarter?.label || "next quarter"} — section
                times not loaded yet.
                {!verified && tssOfferings.source === "tss"
                  ? " Open WebReg/TSS with the extension for live sections."
                  : ""}
              </p>
            )}
          </div>
        )}

        {/* What this course is a prerequisite for */}
        {graph?.unlocks?.length > 0 && (
          <div className="pt-1">
            <h3 className="flex items-center gap-1.5 font-semibold text-sm text-slate-800 mb-1.5">
              <KeyRound className="w-3.5 h-3.5 text-navy-500" />
              Unlocks {graph.unlocks.length} course
              {graph.unlocks.length === 1 ? "" : "s"}
            </h3>
            <div className="flex flex-wrap gap-1">
              {graph.unlocks.map((u) => (
                <button
                  key={u.course_id}
                  className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 hover:bg-navy-100 hover:text-navy-700 transition-colors"
                  onClick={() => onSelectCourseId?.(u.course_id)}
                  title={u.course_name}
                >
                  {u.course_id}
                </button>
              ))}
            </div>
          </div>
        )}

        {course.professors && course.professors.length > 0 && (
          <div className="mt-4">
            {/* professors_source is a term code ("FA26") when this is the
                confirmed teaching staff for the upcoming quarter, and
                "historic" when it is inferred from who taught it before. The
                two mean very different things to a student choosing a course,
                so the heading says which. */}
            <h3 className="font-semibold text-md mb-1">
              {course.professors_source && course.professors_source !== "historic"
                ? `Professors (${course.professors_source}):`
                : "Professors:"}
            </h3>
            {(!course.professors_source || course.professors_source === "historic") && (
              <p className="text-xs text-gray-500 mb-2">
                Based on past offerings — this course isn’t on the upcoming
                quarter’s schedule, so the instructor may differ.
              </p>
            )}
            {course.professors.map((prof, idx) => (
              <ProfessorInfo key={idx} professor={prof} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CourseDetails;
