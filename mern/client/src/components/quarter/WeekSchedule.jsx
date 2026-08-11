// Weekly time-grid for one quarter, built from TSS section data the
// booking-bridge extension scraped out of the student's own signed-in
// session (delivered via plannerBridge.requestScrapedSections()).
//
// Section shape (extension/content/adapter.js):
//   { courseId: "CSE 100", sectionId: "A00", component: "LE"|"DI"|...,
//     days: ["M","W","F"], start: "10:00am", end: "10:50am",
//     instructor, location, status: "open"|"waitlist-active"|"full"|...,
//     seatsAvailable, seatsTotal }
//
// Honesty rules: courses with no scraped sections are listed separately with
// instructions, never silently dropped; time conflicts are computed and
// called out, not just visually implied.
import { useMemo, useCallback } from "react";
import { TriangleAlert, RefreshCw, Clock, X, Plus } from "lucide-react";
import {
  blocksOf,
  blocksOverlap,
  normalizeSectionStatus,
  packageMatchesId,
  packagesClash,
  packagesFor,
  sectionsForCourse,
  whenLabel,
} from "../../utils/sectionPackages.js";

const DAY_ORDER = ["M", "T", "W", "R", "F", "S"];
const DAY_LABELS = { M: "Mon", T: "Tue", W: "Wed", R: "Thu", F: "Fri", S: "Sat" };

const DAY_START = 8 * 60; // 8:00am
const DAY_END = 22 * 60; // 10:00pm
const PX_PER_MIN = 56 / 60; // 56px per hour row

const STATUS_STYLE = {
  open: { block: "bg-emerald-50 border-emerald-300", chip: "text-emerald-700", label: "Open" },
  "waitlist-active": { block: "bg-amber-50 border-amber-300", chip: "text-amber-700", label: "Waitlist" },
  "waitlist-inactive": { block: "bg-amber-50 border-amber-300", chip: "text-amber-700", label: "Waitlist closed" },
  full: { block: "bg-red-50 border-red-300", chip: "text-red-600", label: "Full" },
  booked: { block: "bg-navy-50 border-navy-300", chip: "text-navy-600", label: "Booked" },
  "booked-waitlist": { block: "bg-amber-50 border-amber-300", chip: "text-amber-700", label: "On waitlist" },
  "conditionally-booked": { block: "bg-navy-50 border-navy-300", chip: "text-navy-600", label: "Conditional" },
  unknown: { block: "bg-slate-50 border-slate-300", chip: "text-slate-500", label: "" },
};
const styleFor = (status) =>
  STATUS_STYLE[normalizeSectionStatus(status)] || STATUS_STYLE.unknown;

const seatText = (s) =>
  Number.isFinite(s?.seatsAvailable) ? `${s.seatsAvailable} seats` : styleFor(s?.status).label;

/**
 * Seat line for a whole package.
 *
 * A package is a bundle — you enrol in the lecture *and* its discussion *and*
 * its lab — so the number that matters is the tightest of them, not the
 * lecture's. packagesFor computes that; this just names the section that binds
 * when it isn't the lecture, because "3 seats" reading off a 200-seat lecture
 * is the kind of number that sends someone at a section they cannot get.
 */
const packageSeatText = (pkg) => {
  if (!Number.isFinite(pkg?.seatsAvailable)) return styleFor(pkg?.status).label;
  const bound = pkg.seatsLimitedBy;
  return bound
    ? `${pkg.seatsAvailable} seats (${bound.component || bound.sectionId || "linked"})`
    : `${pkg.seatsAvailable} seats`;
};

// "Updated 4 min ago" — coarse on purpose. Section data is only as fresh as the
// last time a TSS tab rendered rows, and a to-the-second timestamp would imply
// a liveness this data does not have.
const freshnessText = (updatedAt) => {
  if (!updatedAt) return null;
  const minutes = Math.floor((Date.now() - updatedAt) / 60000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days} day${days === 1 ? "" : "s"} ago`;
};

const WeekSchedule = ({
  courses,
  sectionsByCourse,
  bridgeStatus,
  onSync,
  updatedAt,
  year,
  term,
  liveFetch,
  onRemove,
  onSelectPackage,
  onOpenCourse,
  dropActive,
  onDragOver,
  onDragLeave,
  onDrop,
  termLabel,
}) => {
  const { optionsByCourse, unscheduled } = useMemo(() => {
    const optionsByCourse = new Map();
    const unscheduled = [];
    const liveSettled =
      liveFetch && liveFetch !== "loading" && liveFetch.ok;
    for (const course of courses) {
      const { sections, verified } = sectionsForCourse(
        course,
        sectionsByCourse,
        year,
        term
      );
      // Unverified scrape-only rows are not drawn — they often belong to a
      // different quarter and look authoritative next to real OData data.
      const packages = verified ? packagesFor(sections) : [];
      if (!packages.length) {
        const scrapeOnly = !verified && sections.length > 0;
        // Live TSS query finished with nothing for this course, or we only
        // have term-less scrape leftovers — say "not offered" instead of
        // painting times that may belong to another quarter.
        const notOffered =
          scrapeOnly || (!verified && sections.length === 0 && liveSettled);
        unscheduled.push({
          course,
          hasData: sections.length > 0,
          notOffered,
        });
        continue;
      }
      optionsByCourse.set(course.course_id, { course, packages });
    }
    return { optionsByCourse, unscheduled };
  }, [courses, sectionsByCourse, year, term, liveFetch]);

  /** The package currently displayed for a course.
   * Prefers the enrollment snapshot saved on the course (persisted with the
   * plan); falls back to the best-ranked package so the grid is useful before
   * anything is picked. */
  const selectedFor = useCallback(
    (courseId) => {
      const entry = optionsByCourse.get(courseId);
      if (!entry) return null;
      const savedId = entry.course.enrollment?.packageId;
      // Match on aliases too: UCSD hands out several ids for one bundle and
      // packagesFor collapses them, so a plan saved under a collapsed id must
      // still resolve rather than silently reverting to packages[0].
      return (
        entry.packages.find((p) => packageMatchesId(p, savedId)) ||
        entry.packages[0]
      );
    },
    [optionsByCourse]
  );

  const { blocks, conflicts } = useMemo(() => {
    const blocks = [];
    // Every section of the chosen package, and every weekly meeting of every
    // section. A package is the whole bundle (lecture + discussion + lab), and
    // a single section can meet at two different times in a week — drawing only
    // the lecture, or only a section's first meeting, hid real commitments and
    // invented conflicts against ones that were never there.
    for (const [courseId, { course }] of optionsByCourse) {
      const pkg = selectedFor(courseId);
      if (!pkg) continue;
      for (const meeting of pkg.meetings) {
        for (const block of blocksOf(meeting)) {
          blocks.push({ course, meeting, ...block, conflict: false });
        }
      }
    }
    const conflicts = [];
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        if (
          blocks[i].course.course_id !== blocks[j].course.course_id &&
          blocksOverlap(blocks[i], blocks[j])
        ) {
          blocks[i].conflict = blocks[j].conflict = true;
          const pair = `${blocks[i].course.course_id} × ${blocks[j].course.course_id} (${DAY_LABELS[blocks[i].day]})`;
          if (!conflicts.includes(pair)) conflicts.push(pair);
        }
      }
    }
    return { blocks, conflicts };
  }, [optionsByCourse, selectedFor]);

  // Bands rather than a raw age: "3 hr ago" means nothing without knowing
  // whether 3 hours is fine. During enrollment it is not.
  const staleness = (() => {
    if (!updatedAt) return { level: "unknown" };
    const hours = (Date.now() - updatedAt) / 3600000;
    if (hours > 48) return { level: "stale" };
    if (hours > 2) return { level: "aging" };
    return { level: "fresh" };
  })();

  const days = DAY_ORDER.filter(
    (d) => d !== "S" || blocks.some((b) => b.day === "S")
  );
  const hours = [];
  for (let t = DAY_START; t < DAY_END; t += 60) hours.push(t);
  const gridHeight = (DAY_END - DAY_START) * PX_PER_MIN;

  const hourLabel = (min) => {
    const h = Math.floor(min / 60);
    const suffix = h >= 12 ? "pm" : "am";
    const display = h % 12 === 0 ? 12 : h % 12;
    return `${display}${suffix}`;
  };

  const notOffered = unscheduled.filter((u) => u.notOffered);
  const awaitingTimes = unscheduled.filter((u) => !u.notOffered);

  return (
    <div
      className="space-y-3"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Where this data came from.
          The schedule and seat counts come from UCSD's public Class Planner
          feed, refreshed per course as you view it — no extension needed. The
          extension's one remaining job is booking, where TSS's own numbers are
          the final word. */}
      {bridgeStatus === "missing" && blocks.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-slate-400">
          <Clock className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          <span>
            Seats refresh from UCSD&rsquo;s schedule feed as you view courses.
            Confirm on WebReg when you actually enroll.
          </span>
        </p>
      )}

      {/* How old the numbers are.
          Times and rooms barely move once a schedule publishes, but seat counts
          change by the minute during enrollment — so an hours-old count can send
          someone at a section that filled. State the age plainly, and escalate
          the tone once it is old enough to mislead rather than merely lag. */}
      {updatedAt && blocks.length > 0 && (
        <p
          className={`flex items-start gap-1.5 text-xs ${
            staleness.level === "stale" ? "text-amber-700" : "text-slate-400"
          }`}
        >
          {staleness.level === "stale" ? (
            <TriangleAlert className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          ) : (
            <Clock className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          )}
          <span>
            Seats and times {freshnessText(updatedAt).replace(/^Updated /, "last updated ")}
            {staleness.level === "stale"
              ? " — old enough that seat counts may be wrong. Confirm on WebReg before relying on them."
              : staleness.level === "aging"
                ? " — seat counts change quickly during enrollment."
                : "."}
          </span>
        </p>
      )}

      {/* "Schedule feed is down" and "this quarter has no schedule yet" both
          produce an empty grid, so they must never look the same. */}
      {liveFetch === "loading" && (
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <Clock className="w-3.5 h-3.5" />
          Loading the shared schedule…
        </p>
      )}
      {liveFetch && liveFetch !== "loading" && !liveFetch.ok && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <TriangleAlert className="w-4 h-4 mt-px flex-shrink-0" />
          <span>
            {liveFetch.needsSignIn
              ? "Your TSS sign-in has expired, so seat counts below may be stale. Sign in at sis.ucsd.edu and this refreshes on its own."
              : `Couldn't refresh seat counts (${liveFetch.reason}) — numbers shown may be stale.`}
          </span>
        </div>
      )}
      {/* The refresh succeeded but the server could not reach Class Planner and
          echoed its snapshot numbers back. That is a different situation from a
          real live read and must not be presented as one — during enrollment a
          seat count from a day-old snapshot is exactly the number that sends
          someone at a section that filled. */}
      {liveFetch && liveFetch !== "loading" && liveFetch.ok && liveFetch.stale && blocks.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700">
          <TriangleAlert className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          <span>
            UCSD&rsquo;s schedule feed didn&rsquo;t answer, so these are the last
            saved seat counts rather than live ones. Confirm on WebReg before
            relying on them.
          </span>
        </p>
      )}
      {liveFetch && liveFetch !== "loading" && liveFetch.ok && liveFetch.count === 0 && courses.length > 0 && notOffered.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <p>
            {/* Three different causes produce an empty grid; the extension
                probes to tell them apart, so say which one this is. */}
            {liveFetch.diagnosis || "No sections found for these courses in this quarter's schedule."}
          </p>
          {liveFetch.offeringsFound?.length > 0 && (
            <p className="mt-1 text-slate-500">
              TSS lists them in: {liveFetch.offeringsFound.slice(0, 4).join(" · ")}
            </p>
          )}
          {liveFetch.codesQueried?.length > 0 && !liveFetch.offeringsFound?.length && (
            <p className="mt-1 text-slate-500">Asked TSS for: {liveFetch.codesQueried.join(", ")}</p>
          )}
          {/* The exact comparison, so a filter bug and a genuinely absent term
              can be told apart at a glance instead of by another round trip. */}
          {liveFetch.comparison && (
            <details className="mt-2">
              <summary className="cursor-pointer text-slate-400 hover:text-slate-600">
                Why? {liveFetch.extensionVersion && `(extension v${liveFetch.extensionVersion})`}
              </summary>
              <div className="mt-1 space-y-0.5 text-slate-500">
                <p>
                  Asked for year <code>{String(liveFetch.comparison.askedYear)}</code>, term{" "}
                  <code>{String(liveFetch.comparison.askedTerm)}</code> — TSS returned{" "}
                  {liveFetch.comparison.rowsSeen} row(s):
                </p>
                {liveFetch.comparison.sampleRows?.map((r, i) => (
                  <p key={i} className="font-mono text-[11px]">
                    {r.code} · year {String(r.year)} ({r.yearText}) · {r.periodText}
                  </p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {notOffered.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <TriangleAlert className="w-4 h-4 mt-px flex-shrink-0" />
          <div className="min-w-0 space-y-1">
            <p>
              <strong>No sections found for {termLabel || "this quarter"}</strong>
              {" — "}
              {notOffered.length === 1 ? "this course" : "these courses"} may not be
              offered, or TSS hasn&apos;t published meetings yet:
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {notOffered.map(({ course }) => (
                <li
                  key={course.course_id}
                  className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-white/70 border border-amber-200"
                >
                  <span className="font-semibold text-amber-900">{course.course_id}</span>
                  {onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(course)}
                      className="p-0.5 rounded text-amber-400 hover:text-red-500 hover:bg-red-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                      title={`Remove ${course.course_id}`}
                      aria-label={`Remove ${course.course_id}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {liveFetch?.offeringsFound?.length > 0 && (
              <p className="text-amber-700/80">
                TSS lists offerings in: {liveFetch.offeringsFound.slice(0, 4).join(" · ")}
              </p>
            )}
          </div>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <TriangleAlert className="w-4 h-4 mt-px flex-shrink-0" />
          <span>
            <strong>Time conflict{conflicts.length > 1 ? "s" : ""}:</strong>{" "}
            {conflicts.join(" · ")} — pick a different section below or move a
            course in the Planner.
          </span>
        </div>
      )}

      {/* The week grid — drop courses here; remove via × on a block */}
      <div
        className={`bg-white border rounded-xl shadow-card overflow-x-auto transition-colors ${
          dropActive
            ? "border-gold-400 ring-2 ring-gold-400 bg-gold-300/10"
            : "border-slate-200"
        }`}
      >
        {blocks.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="flex items-center justify-center gap-1.5 text-sm text-slate-500">
              <Plus className="w-4 h-4" />
              Drag a course from Course Search onto the calendar
            </p>
          </div>
        ) : (
          <div className="min-w-[640px]">
            {/* Day headers */}
            <div className="grid border-b border-slate-200" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
              <div />
              {days.map((d) => (
                <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-slate-600 border-l border-slate-100">
                  {DAY_LABELS[d]}
                </div>
              ))}
            </div>
            {/* Time grid */}
            <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
              {/* Hour gutter */}
              <div className="relative" style={{ height: gridHeight }}>
                {hours.map((t) => (
                  <span
                    key={t}
                    className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-slate-400"
                    style={{ top: (t - DAY_START) * PX_PER_MIN }}
                  >
                    {hourLabel(t)}
                  </span>
                ))}
              </div>
              {days.map((day) => (
                <div key={day} className="relative border-l border-slate-100" style={{ height: gridHeight }}>
                  {hours.map((t) => (
                    <div
                      key={t}
                      className="absolute inset-x-0 border-t border-slate-100"
                      style={{ top: (t - DAY_START) * PX_PER_MIN }}
                    />
                  ))}
                  {blocks
                    .filter((b) => b.day === day)
                    .map((b, i) => {
                      const style = styleFor(b.meeting.status);
                      const top = (Math.max(b.startMin, DAY_START) - DAY_START) * PX_PER_MIN;
                      const height = Math.max(
                        18,
                        (Math.min(b.endMin, DAY_END) - Math.max(b.startMin, DAY_START)) * PX_PER_MIN
                      );
                      return (
                        <div
                          key={`${b.course.course_id}-${b.meeting.sectionId}-${i}`}
                          role={onOpenCourse ? "button" : undefined}
                          tabIndex={onOpenCourse ? 0 : undefined}
                          onClick={() => onOpenCourse?.(b.course)}
                          onKeyDown={(e) => {
                            if (!onOpenCourse) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onOpenCourse(b.course);
                            }
                          }}
                          className={`group/block absolute inset-x-1 rounded-md border px-1.5 py-1 overflow-hidden ${style.block} ${
                            b.conflict ? "ring-2 ring-red-400" : ""
                          } ${onOpenCourse ? "cursor-pointer hover:brightness-[0.98]" : ""}`}
                          style={{ top, height }}
                          title={`${b.course.course_id} ${b.meeting.component || ""} ${b.meeting.sectionId || ""}\n${b.start ?? b.meeting.start}–${b.end ?? b.meeting.end}${b.meeting.instructor ? `\n${b.meeting.instructor}` : ""}${b.location || b.meeting.location ? `\n${b.location || b.meeting.location}` : ""}\n${seatText(b.meeting)}${onOpenCourse ? "\nClick for details" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-0.5">
                            <p className="text-[11px] font-semibold text-slate-800 leading-tight truncate min-w-0">
                              {b.course.course_id}
                              {b.meeting.component ? ` · ${b.meeting.component}` : ""}
                            </p>
                            {onRemove && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRemove(b.course);
                                }}
                                className="flex-shrink-0 p-0.5 -mr-0.5 -mt-0.5 rounded text-slate-400 opacity-0 group-hover/block:opacity-100 hover:text-red-500 hover:bg-red-50/80 transition-all focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-red-400"
                                title={`Remove ${b.course.course_id} from this quarter`}
                                aria-label={`Remove ${b.course.course_id}`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          {/* This block's own clock, not the section's first
                              meeting — they differ whenever a section meets at
                              more than one time in the week. */}
                          <p className="text-[10px] text-slate-500 leading-tight truncate">
                            {b.start ?? b.meeting.start}–{b.end ?? b.meeting.end}
                          </p>
                          <p className={`text-[10px] font-medium leading-tight truncate ${style.chip}`}>
                            {seatText(b.meeting)}
                          </p>
                          {b.meeting.instructor && (
                            <p className="text-[10px] text-slate-400 leading-tight truncate">
                              {b.meeting.instructor}
                            </p>
                          )}
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Every planned course underneath the grid — including ones still
          waiting on times. A course typically has several lecture packages;
          showing only courses that already have data made newly added ones
          disappear from this panel entirely. */}
      {courses.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-card px-4 py-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-slate-600">Section options</p>
            {awaitingTimes.length > 0 && onSync && (
              <button
                type="button"
                onClick={onSync}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-navy-600 hover:bg-navy-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Sync from TSS
              </button>
            )}
          </div>
          {courses.map((course) => {
            const entry = optionsByCourse.get(course.course_id);
            if (entry) {
              const { packages } = entry;
              const current = selectedFor(course.course_id);
              const others = [...optionsByCourse.keys()]
                .filter((id) => id !== course.course_id)
                .map((id) => selectedFor(id))
                .filter(Boolean);
              return (
                <div key={course.course_id}>
                  <p className="text-xs text-slate-500 mb-1">
                    <span className="font-semibold text-slate-700">{course.course_id}</span>{" "}
                    · {packages.length} option{packages.length === 1 ? "" : "s"}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {packages.map((pkg) => {
                      const active = pkg.id === current?.id;
                      const clashes = others.some((other) => packagesClash(pkg, other));
                      const style = styleFor(pkg.status);
                      return (
                        <button
                          key={pkg.id}
                          type="button"
                          onClick={() => onSelectPackage?.(course, pkg)}
                          aria-pressed={active}
                          className={`text-left px-2.5 py-1.5 rounded-lg border text-[11px] leading-snug transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 ${
                            active
                              ? "border-navy-400 bg-navy-50"
                              : `${style.block} hover:border-slate-400`
                          }`}
                        >
                          {/* One line per section in the bundle. A package is a
                              lecture *plus* its discussion and lab; running them
                              together on one line read as a single class and hid
                              what the student is actually signing up for. */}
                          <span className="block font-medium text-slate-700">
                            {pkg.meetings.map((m) => (
                              <span
                                key={m.sectionRef || m.sectionId || m.component}
                                className="block whitespace-nowrap"
                              >
                                <span className="inline-block w-6 text-slate-400">
                                  {m.component || "?"}
                                </span>
                                {whenLabel(m)}
                              </span>
                            ))}
                          </span>
                          <span className="block text-slate-500 mt-0.5">
                            {pkg.instructors.join(", ") || "Instructor TBA"}
                            {" · "}
                            <span
                              className={style.chip}
                              title={
                                pkg.seatsLimitedBy
                                  ? `Enrolling takes a seat in every section of this package — ${pkg.seatsLimitedBy.component || pkg.seatsLimitedBy.sectionId} is the tightest.`
                                  : undefined
                              }
                            >
                              {packageSeatText(pkg) || style.label}
                            </span>
                            {clashes && <span className="text-red-600"> · conflicts</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }

            const pending = unscheduled.find((u) => u.course.course_id === course.course_id);
            const loading = liveFetch === "loading";
            return (
              <div
                key={course.course_id}
                className="flex items-start justify-between gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-3 py-2"
              >
                <div className="min-w-0 text-xs text-slate-500">
                  <p className="font-semibold text-slate-700">{course.course_id}</p>
                  <p className="mt-0.5">
                    {loading
                      ? "Checking the shared schedule for section times…"
                      : pending?.notOffered
                        ? `No sections found for ${termLabel || "this quarter"} — may not be offered, or the shared schedule hasn't published it yet.`
                        : pending?.hasData
                          ? "Sections found but none carried meeting times."
                          : "No section times yet — the shared schedule hasn't published times for this course."}
                  </p>
                </div>
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(course)}
                    className="flex-shrink-0 p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                    title={`Remove ${course.course_id}`}
                    aria-label={`Remove ${course.course_id}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WeekSchedule;
