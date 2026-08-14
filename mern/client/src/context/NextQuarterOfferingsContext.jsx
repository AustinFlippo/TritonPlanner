import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { nextEnrollmentQuarter } from "../utils/academicCalendar";
import { wakePlanner } from "../utils/api";
import {
  buildOfferedCompactSet,
  fetchLiveSeatCounts,
  isCourseOfferedNext,
  loadNextQuarterOfferings,
  overlayLiveSeats,
} from "../utils/nextQuarterOfferings";
import { mergeSectionMaps } from "../utils/seatAvailability";
import {
  courseSeatChip,
  sectionsForCourse,
} from "../utils/sectionPackages";
import {
  isBridgeInstalled,
  requestLiveSections,
  requestScrapedSections,
} from "../../../../booking-bridge/core/plannerBridge.js";

const NextQuarterOfferingsContext = createContext(null);

const idleState = {
  status: "idle", // idle | loading | ready | error
  courses: [],
  sections: {},
  reason: null,
  needsSignIn: false,
  source: null,
  truncated: false,
  count: null,
  refreshedAt: null,
  live: false,
};

export function NextQuarterOfferingsProvider({ children }) {
  const enrollmentQuarter = useMemo(() => nextEnrollmentQuarter(), []);
  const [tssOfferings, setTssOfferings] = useState(idleState);
  const sectionsRef = useRef({});

  const patchOfferings = useCallback((updater) => {
    setTssOfferings((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      sectionsRef.current = next.sections || {};
      return next;
    });
  }, []);

  const reload = useCallback(async () => {
    patchOfferings((prev) => ({
      ...prev,
      status: "loading",
      reason: null,
      needsSignIn: false,
      source: null,
    }));
    const result = await loadNextQuarterOfferings(enrollmentQuarter);
    const next = {
      ...idleState,
      ...result,
      sections: result.sections || {},
      live: false,
    };
    patchOfferings(next);
    return result;
  }, [enrollmentQuarter, patchOfferings]);

  // Eager load the Class Planner schedule on app open so Course Search /
  // planner tags / chat never wait on the Next filter click. Extension scrapes
  // are deliberately NOT merged over this: Class Planner is the canonical
  // schedule (verified to track TSS within minutes), and TSS captures come in
  // a different per-package shape that used to overwrite whole section lists.
  useEffect(() => {
    let cancelled = false;
    wakePlanner();
    (async () => {
      patchOfferings((prev) =>
        prev.status === "idle" ? { ...prev, status: "loading" } : prev
      );
      const result = await loadNextQuarterOfferings(enrollmentQuarter);
      if (cancelled) return;
      patchOfferings({
        ...idleState,
        ...result,
        sections: result.sections || {},
        live: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [enrollmentQuarter, patchOfferings]);

  /**
   * Refresh seat counts for these course ids in the enrollment quarter.
   *
   * Primary source is the server's Class Planner proxy — public, verified to
   * track TSS within minutes, works for everyone. The extension's TSS session
   * is only consulted if the proxy fails outright, and even then its scrape is
   * merged with the same care the old path used. Safe to call repeatedly.
   * Returns `{ ...result, sections }` with the merged map for callers that
   * need seats before the next React render (e.g. chat send).
   */
  const syncLiveSeats = useCallback(
    async (courseIds) => {
      const ids = [...new Set((courseIds || []).filter(Boolean))];
      if (!ids.length || !enrollmentQuarter?.academicYear) {
        return { ok: true, count: 0, sections: sectionsRef.current };
      }

      const live = await fetchLiveSeatCounts(ids);
      if (live.ok && Object.keys(live.courses).length) {
        const merged = overlayLiveSeats(sectionsRef.current || {}, live.courses);
        sectionsRef.current = merged;
        patchOfferings((prev) => ({
          ...prev,
          sections: merged,
          live: !live.stale,
          refreshedAt: live.checkedAt || prev.refreshedAt,
        }));
        return {
          ok: true,
          stale: live.stale,
          checkedAt: live.checkedAt || null,
          updatedAt: live.checkedAt || Date.now(),
          sections: merged,
        };
      }

      // Proxy unreachable: fall back to the student's own TSS session, when
      // they happen to run the extension. Last resort, not the norm.
      const installed = await isBridgeInstalled();
      if (!installed) {
        return {
          ok: false,
          reason: "seat refresh unavailable",
          sections: sectionsRef.current,
        };
      }
      const result = await requestLiveSections({
        courseIds: ids,
        year: enrollmentQuarter.academicYear,
        term: enrollmentQuarter.term,
      });
      const scraped = await requestScrapedSections();
      let merged = sectionsRef.current;
      if (scraped && Object.keys(scraped).length) {
        merged = mergeSectionMaps(sectionsRef.current || {}, scraped);
        sectionsRef.current = merged;
        patchOfferings((prev) => ({
          ...prev,
          sections: merged,
          live: Boolean(result?.ok),
          refreshedAt: result?.updatedAt || Date.now(),
        }));
      }
      return {
        ...(result || { ok: false, reason: "no reply" }),
        sections: merged,
      };
    },
    [enrollmentQuarter, patchOfferings]
  );

  /**
   * The quarter actually on screen.
   *
   * `enrollmentQuarter` is a date heuristic; a loaded schedule states its own
   * quarter, and that statement wins. It matters around the rollover: UCSD
   * opens Winter enrollment mid-November, and for the days the heuristic and
   * the feed disagree the "FA26" chip would otherwise be pinned to a list of
   * Winter courses. The heuristic remains the fallback for the interval before
   * anything has loaded.
   */
  const effectiveQuarter = useMemo(() => {
    if (tssOfferings.status !== "ready" || !tssOfferings.term) {
      return enrollmentQuarter;
    }
    const { term, year, termCode } = tssOfferings;
    if (term === enrollmentQuarter.term && year === enrollmentQuarter.academicYear) {
      return enrollmentQuarter;
    }
    const code = termCode || { fall: "FA", winter: "WI", spring: "SP" }[term] || "";
    // Fall opens the academic year; winter and spring sit in the year after it.
    const calendarYear = String(term === "fall" ? Number(year) : Number(year) + 1);
    const shortName = { fall: "Fall", winter: "Winter", spring: "Spring" }[term] || term;
    return {
      term,
      calendarYear,
      academicYear: String(year),
      termCode: code,
      label: `${shortName} ${calendarYear}`,
      chipLabel: `${code}${calendarYear.slice(-2)}`,
    };
  }, [enrollmentQuarter, tssOfferings]);

  const offeredSet = useMemo(
    () =>
      tssOfferings.status === "ready"
        ? buildOfferedCompactSet(tssOfferings.courses)
        : new Set(),
    [tssOfferings.status, tssOfferings.courses]
  );

  const isOffered = useCallback(
    (courseId) => isCourseOfferedNext(courseId, offeredSet),
    [offeredSet]
  );

  /** Seat chip for a course offered next quarter; null when unknown / not offered. */
  const seatChipFor = useCallback(
    (courseId) => {
      if (!courseId || !isOffered(courseId)) return null;
      const { sections, verified } = sectionsForCourse(
        { course_id: courseId },
        tssOfferings.sections || {},
        effectiveQuarter?.academicYear,
        effectiveQuarter?.term
      );
      // Prefer term-verified rows; unverified scrape leftovers often belong
      // to another quarter and would paint a misleading Full / N left tag.
      if (!verified || !sections.length) return null;
      return courseSeatChip(sections);
    },
    [isOffered, tssOfferings.sections, effectiveQuarter]
  );

  const value = useMemo(
    () => ({
      // The quarter the loaded schedule is for — what every label should use.
      enrollmentQuarter: effectiveQuarter,
      // The date heuristic on its own, for callers that need to know what was
      // asked for as opposed to what came back.
      calendarQuarter: enrollmentQuarter,
      tssOfferings,
      sections: tssOfferings.sections || {},
      offeredSet,
      isOffered,
      reload,
      syncLiveSeats,
      /** Short chip like "FA26" when this course is on the next-quarter schedule. */
      offeredNextChip: (courseId) =>
        isOffered(courseId) ? effectiveQuarter.chipLabel : null,
      seatChipFor,
    }),
    [
      effectiveQuarter,
      enrollmentQuarter,
      tssOfferings,
      offeredSet,
      isOffered,
      reload,
      syncLiveSeats,
      seatChipFor,
    ]
  );

  return (
    <NextQuarterOfferingsContext.Provider value={value}>
      {children}
    </NextQuarterOfferingsContext.Provider>
  );
}

// The standard context pattern: the hook belongs beside the provider it reads.
// eslint-disable-next-line react-refresh/only-export-components
export function useNextQuarterOfferings() {
  const ctx = useContext(NextQuarterOfferingsContext);
  if (!ctx) {
    // Safe default so cards don't crash outside the provider (tests, storybook).
    const enrollmentQuarter = nextEnrollmentQuarter();
    return {
      enrollmentQuarter,
      calendarQuarter: enrollmentQuarter,
      tssOfferings: idleState,
      sections: {},
      offeredSet: new Set(),
      isOffered: () => false,
      reload: async () => idleState,
      syncLiveSeats: async () => ({ ok: false, sections: {} }),
      offeredNextChip: () => null,
      seatChipFor: () => null,
    };
  }
  return ctx;
}
