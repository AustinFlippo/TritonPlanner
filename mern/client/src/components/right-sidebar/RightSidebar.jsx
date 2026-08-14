import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import CourseSearch from "./CourseSearch";
import CourseAssistant from "./CourseAssistant";
import CourseDetails from "./CourseDetails";
import { debounce } from "lodash";
import { useAuth } from "../../context/AuthContext";
import { useNextQuarterOfferings } from "../../context/NextQuarterOfferingsContext";
import {
  extractUnmetRequirements,
  extractCompletedCourses,
  extractTakenCourses,
  rankRecommendedCourses,
} from "../../utils/recommendations";
import { levelOfCourseId, enrollmentPlanSlot } from "../../utils/academicCalendar";
import { planWindow } from "../../utils/auditCoursePlanner";
import { compactCourseId } from "../../utils/nextQuarterOfferings";
import {
  buildSeatAvailability,
  courseIdsFromText,
  courseIdsInQuarter,
} from "../../utils/seatAvailability";
import { buildSectionOptions } from "../../utils/sectionOptimizer";
import { extractCourseMentions } from "../../utils/chatCourseMentions";
import { courseIdVariants } from "../../utils/courseIds";
import { normalizeCourseCredits } from "../../utils/courseCredits";
import { codesNamedByAudit } from "../../utils/auditProgress";
import { coursesInQuarter } from "../../utils/quarterPlans";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5050";
const EMPTY_MESSAGES = [];
const NEXT_QUARTER_RESULT_CAP = 50;

const normalizeRecommendation = (result) => ({
  ...result,
  course: normalizeCourseCredits(result.course),
});

const normalizeSelectedCourse = (course) =>
  course ? normalizeCourseCredits(course) : null;

const RightSidebar = ({
  parsedCourseData,
  schedule,
  baseYear = null,
  planContextId = "working-plan",
  onApplyPlan,
  onApplySectionProposal,
  width,
  onWidthChange,
  expandedPanel = null,
  onExpandedPanelChange,
  layoutExpanded = false,
  onMinimize,
  courseOpenRequest = null,
  // Which main tab the student is looking at — planner | quarter | storage | admin
  currentPage = "planner",
}) => {
  const { user } = useAuth();
  const {
    enrollmentQuarter,
    tssOfferings,
    sections: tssSections,
    isOffered,
    reload: loadTssOfferings,
    syncLiveSeats,
  } = useNextQuarterOfferings();
  const enrollmentSlot = useMemo(
    () => enrollmentPlanSlot(planWindow(baseYear)),
    [baseYear]
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchError, setSearchError] = useState(null);
  const [isCourseLoading, setIsCourseLoading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState(null);
  // Grad courses hidden by default — they're 40% of the catalog and noise
  // for most planners
  const [filters, setFilters] = useState({
    levels: ["lower", "upper"],
    quarters: [],
    depts: [],
  });
  // Next-enrollment-quarter filter — uses the shared offerings context
  // (admin-published term_sections, TSS fallback). F/W/S chips still use
  // the historical catalog harvest. Default ON so students see live-term
  // offerings immediately without clicking the chip.
  const [nextQuarterOnly, setNextQuarterOnly] = useState(true);
  const [departments, setDepartments] = useState([]);
  const [requirementSearch, setRequirementSearch] = useState(null);
  const requirementRequestRef = useRef(0);
  const requirementAllCoursesRef = useRef([]);

  // A saved plan is a separate conversation. Keeping these maps in the
  // mounted sidebar lets switching plans restore that plan's chat while a
  // newly-created plan starts with no inherited LLM context.
  const chatContextKey = `${user?.id || "guest"}:${planContextId}`;
  const [draftsByContext, setDraftsByContext] = useState({});
  const [messagesByContext, setMessagesByContext] = useState({});
  const [loadingByContext, setLoadingByContext] = useState({});
  const currentMessage = draftsByContext[chatContextKey] || "";
  const chatMessages = messagesByContext[chatContextKey] || EMPTY_MESSAGES;
  const isLoading = Boolean(loadingByContext[chatContextKey]);

  const setCurrentMessage = (value) => {
    setDraftsByContext((current) => ({
      ...current,
      [chatContextKey]:
        typeof value === "function"
          ? value(current[chatContextKey] || "")
          : value,
    }));
  };
  const updateChatMessages = (contextKey, value) => {
    setMessagesByContext((current) => {
      const existing = current[contextKey] || [];
      return {
        ...current,
        [contextKey]:
          typeof value === "function" ? value(existing) : value,
      };
    });
  };
  // Bias toward the assistant: search is bursty, chat is the longer session
  const [searchSectionHeight, setSearchSectionHeight] = useState(35);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef(null);
  const chatEndRef = useRef(null);
  // Per-plan sync guard — one plan's request must not block or update another.
  const sendingContextsRef = useRef(new Set());
  // AbortControllers keyed by chat context so Stop cancels only that plan's turn.
  const abortControllersRef = useRef({});

  const toggleExpandedPanel = (panel) => {
    if (!onExpandedPanelChange) return;
    onExpandedPanelChange((current) => (current === panel ? null : panel));
  };

  // Panel hide only while docked — maximizing already owns the chrome
  const dockedMinimize = layoutExpanded ? undefined : onMinimize;

  // Latest filters live in a ref so the stable debounced function always
  // searches with current filter state
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const nextQuarterOnlyRef = useRef(nextQuarterOnly);
  nextQuarterOnlyRef.current = nextQuarterOnly;
  // Courses the student's own degree audit names. Sent with every search so a
  // course the audit offers them but the catalog never published (DSC 152) is
  // findable — flagged unverified — instead of silently absent. Lives in a ref
  // because the search function is debounced and captured once.
  const vouchedCodes = useMemo(
    () => [...codesNamedByAudit(parsedCourseData?.sections)],
    [parsedCourseData]
  );
  const vouchedCodesRef = useRef(vouchedCodes);
  vouchedCodesRef.current = vouchedCodes;
  const tssOfferingsRef = useRef(tssOfferings);
  tssOfferingsRef.current = tssOfferings;
  const isOfferedRef = useRef(isOffered);
  isOfferedRef.current = isOffered;

  // If Next turns on before the shared load finished (or after an error), retry.
  useEffect(() => {
    if (!nextQuarterOnly) return;
    if (tssOfferings.status === "ready" || tssOfferings.status === "loading") {
      return;
    }
    loadTssOfferings();
  }, [nextQuarterOnly, tssOfferings.status, loadTssOfferings]);

  const filterByNextQuarter = useCallback(
    (courses, nextOnly = nextQuarterOnlyRef.current) => {
      if (!nextOnly) return courses;
      const offerings = tssOfferingsRef.current;
      if (offerings.status !== "ready") return courses;
      return courses.filter((rec) =>
        isOfferedRef.current(rec.course?.course_id)
      );
    },
    []
  );

  const handleToggleNextQuarter = useCallback(() => {
    setNextQuarterOnly((on) => {
      const next = !on;
      if (next) {
        // Historical F/W/S chips and the shared next-quarter list answer
        // different questions — clear the harvest filter so it can't silently
        // narrow the live list.
        setFilters((f) => (f.quarters.length ? { ...f, quarters: [] } : f));
      }
      return next;
    });
  }, []);

  // Keep a dragged requirement in sync with Next — both filters apply together.
  useEffect(() => {
    if (!requirementAllCoursesRef.current.length) return;
    setRequirementSearch((prev) =>
      prev && !prev.loading
        ? {
            ...prev,
            courses: filterByNextQuarter(requirementAllCoursesRef.current),
          }
        : prev
    );
  }, [nextQuarterOnly, tssOfferings.status, tssOfferings.courses, filterByNextQuarter]);

  const searchFromTss = async (query, activeFilters, offerings) => {
    const dept = activeFilters.depts[0] || null;
    const q = query.trim().toLowerCase();
    // Empty browse stays on the department grid; only search/dept use TSS.
    if (!q && !dept) {
      setSearchResults([]);
      setSearchTotal(0);
      return;
    }

    let pool = offerings.courses || [];
    if (dept) {
      const prefix = dept.toUpperCase();
      pool = pool.filter((c) => {
        const id = c.courseId || "";
        return (
          id === prefix ||
          id.startsWith(`${prefix} `) ||
          id.startsWith(`${prefix}/`)
        );
      });
    }
    if (activeFilters.levels?.length) {
      pool = pool.filter((c) =>
        activeFilters.levels.includes(levelOfCourseId(c.courseId))
      );
    }
    if (q) {
      pool = pool.filter((c) => {
        const id = (c.courseId || "").toLowerCase();
        const name = (c.courseName || "").toLowerCase();
        return (
          id.includes(q) ||
          name.includes(q) ||
          compactCourseId(id).includes(compactCourseId(q))
        );
      });
    }

    const total = pool.length;
    const slice = pool.slice(0, NEXT_QUARTER_RESULT_CAP);
    const codes = slice.map((c) => c.courseId);

    // Hydrate with catalog rows (prereqs, full title) when we have them; fall
    // back to the TSS stub so a live offering never disappears for lack of a
    // catalog scrape.
    let catalogByCompact = new Map();
    if (codes.length) {
      const response = await fetch(`${API_URL}/search-courses/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes, taken: [] }),
      });
      if (response.ok) {
        const data = await response.json();
        for (const row of data.results || []) {
          const course = row.course;
          if (!course?.course_id) continue;
          catalogByCompact.set(compactCourseId(course.course_id), course);
          catalogByCompact.set(compactCourseId(row.token), course);
        }
      }
    }

    const results = slice.map((tss) => {
      const catalog = catalogByCompact.get(compactCourseId(tss.courseId));
      if (catalog) {
        return {
          ...normalizeCourseCredits(catalog),
          offerings: Array.from(
            new Set([...(catalog.offerings || []), enrollmentQuarter.termCode])
          ),
        };
      }
      return {
        course_id: tss.courseId,
        course_name: tss.courseName || "",
        credits: normalizeCourseCredits(tss).credits,
        prerequisites: [],
        offerings: [enrollmentQuarter.termCode],
      };
    });

    setSearchTotal(total);
    setSearchResults(results);
  };

  const handleSearch = async (query) => {
    const activeFilters = filtersRef.current;
    const nextOnly = nextQuarterOnlyRef.current;
    // Nothing typed and no department picked -> department browser is shown
    if (!query.trim() && activeFilters.depts.length === 0) {
      setSearchResults([]);
      setSearchTotal(0);
      setSearchError(null);
      setIsCourseLoading(false);
      return;
    }
    let keepLoading = false;
    try {
      setIsCourseLoading(true);
      setSearchError(null);

      if (nextOnly) {
        const offerings = tssOfferingsRef.current;
        if (offerings.status === "loading" || offerings.status === "idle") {
          // Offerings still arriving — keep the spinner; a later effect re-runs
          // search when status flips to ready.
          keepLoading = true;
          return;
        }
        if (offerings.status === "error") {
          setSearchResults([]);
          setSearchTotal(0);
          setSearchError(offerings.reason || "TSS offerings unavailable.");
          return;
        }
        await searchFromTss(query, activeFilters, offerings);
        return;
      }

      const response = await fetch(`${API_URL}/search-courses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          filters: activeFilters,
          vouchedCodes: vouchedCodesRef.current,
        }),
      });

      if (!response.ok) {
        await response.text(); // grab server error content
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      setSearchTotal(data.total ?? data.results.length);
      setSearchResults(
        data.results.map(normalizeCourseCredits)
      );
    } catch (error) {
      setSearchResults([]);
      setSearchTotal(0);
      setSearchError("Course search is unavailable right now.");
    } finally {
      if (!keepLoading) setIsCourseLoading(false);
    }
  };

  // Stable debouncer (recreating it per render meant no keystroke was ever
  // actually debounced); reads handleSearch through a ref for fresh state
  const handleSearchRef = useRef(handleSearch);
  handleSearchRef.current = handleSearch;
  const debouncedSearch = useMemo(
    () => debounce((q) => handleSearchRef.current(q), 300),
    []
  );
  useEffect(() => () => debouncedSearch.cancel(), [debouncedSearch]);

  // Filter changes re-run the current search immediately (no debounce)
  const searchTermRef = useRef(searchTerm);
  searchTermRef.current = searchTerm;
  useEffect(() => {
    handleSearchRef.current(searchTermRef.current);
  }, [filters, nextQuarterOnly]);

  // TSS term list arrived (or failed) — refresh whatever the student is viewing
  useEffect(() => {
    if (!nextQuarterOnly) return;
    if (tssOfferings.status !== "ready" && tssOfferings.status !== "error") return;
    handleSearchRef.current(searchTermRef.current);
  }, [nextQuarterOnly, tssOfferings.status, tssOfferings.courses]);

  // Department counts from the live TSS list when Next-quarter is on, so the
  // browse grid reflects what is actually scheduled rather than the harvest.
  const departmentsForUi = useMemo(() => {
    if (!nextQuarterOnly || tssOfferings.status !== "ready") return departments;
    const levels = filters.levels;
    const counts = new Map();
    for (const course of tssOfferings.courses) {
      if (levels.length && !levels.includes(levelOfCourseId(course.courseId))) {
        continue;
      }
      const dept = String(course.courseId || "").split(/[\s/]/)[0];
      if (!dept) continue;
      counts.set(dept, (counts.get(dept) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [nextQuarterOnly, tssOfferings, departments, filters.levels]);

  // Department list for the browse view; counts respect the level filter
  useEffect(() => {
    const levels = filters.levels.join(",");
    fetch(`${API_URL}/search-courses/departments?levels=${levels}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => setDepartments(data.departments || []))
      .catch(() => setDepartments([]));
  }, [filters.levels]);

  // "Recommended for you": unmet audit requirements resolved to real catalog
  // courses (minus completed / in-progress — planned placements stay visible),
  // refreshed whenever the audit or the planner grid changes
  const [recommendations, setRecommendations] = useState([]);
  useEffect(() => {
    const unmet = extractUnmetRequirements(parsedCourseData?.sections);
    const withCodes = unmet.filter((r) => r.codes.length > 0);
    if (withCodes.length === 0) {
      setRecommendations([]);
      return;
    }
    const taken = extractTakenCourses(parsedCourseData?.sections, schedule);
    const exclude = extractCompletedCourses(
      parsedCourseData?.sections,
      schedule
    );
    const allCodes = [...new Set(withCodes.flatMap((r) => r.codes))];
    let cancelled = false;
    fetch(`${API_URL}/search-courses/recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: allCodes, taken, exclude }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (cancelled) return;
        // The server caps how many codes it will resolve at once. It should
        // never bind, but when it does it drops the END of the list, which
        // takes out the last requirements' options wholesale — and the filter
        // below then removes those requirements from the panel entirely. Say
        // so rather than letting them vanish silently.
        if (data.truncated) {
          console.warn(
            `Recommendations: the server dropped ${data.dropped} audit codes, ` +
              `so some requirements below may be missing options.`
          );
        }
        // Group resolved courses back under their requirement titles
        const byToken = new Map();
        for (const res of data.results || []) {
          if (!byToken.has(res.token)) byToken.set(res.token, []);
          // Same credits normalization the search path applies ("N/A" -> 0)
          byToken.get(res.token).push(normalizeRecommendation(res));
        }
        setRecommendations(
          withCodes
            .map((req) => ({
              title: req.title,
              needs: req.needs,
              courses: rankRecommendedCourses(
                req.codes.flatMap((code) => byToken.get(code) || [])
              ),
            }))
            .filter((req) => req.courses.length > 0)
        );
      })
      .catch(() => {
        if (!cancelled) setRecommendations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [parsedCourseData, schedule]);

  const handleRequirementDrop = async (requirement) => {
    const requestId = ++requirementRequestRef.current;
    setSelectedCourse(null);
    setSearchTerm("");
    setFilters((current) => ({ ...current, depts: [] }));
    requirementAllCoursesRef.current = [];
    setRequirementSearch({
      title: requirement.title,
      needs: requirement.needs,
      courses: [],
      loading: true,
      error: null,
    });

    // Next · requirement combine: ensure the shared schedule is loading when
    // the student already has Next on (or just toggled it with a drop queued).
    if (
      nextQuarterOnlyRef.current &&
      tssOfferingsRef.current.status !== "ready" &&
      tssOfferingsRef.current.status !== "loading"
    ) {
      loadTssOfferings();
    }

    try {
      const taken = extractTakenCourses(parsedCourseData?.sections, schedule);
      const exclude = extractCompletedCourses(
        parsedCourseData?.sections,
        schedule
      );
      const response = await fetch(`${API_URL}/search-courses/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: requirement.codes, taken, exclude }),
      });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const data = await response.json();
      if (requestId !== requirementRequestRef.current) return;
      const ranked = rankRecommendedCourses(
        (data.results || []).map(normalizeRecommendation)
      );
      requirementAllCoursesRef.current = ranked;
      setRequirementSearch({
        title: requirement.title,
        needs: requirement.needs,
        courses: filterByNextQuarter(ranked),
        loading: false,
        error: null,
      });
    } catch {
      if (requestId !== requirementRequestRef.current) return;
      requirementAllCoursesRef.current = [];
      setRequirementSearch({
        title: requirement.title,
        needs: requirement.needs,
        courses: [],
        loading: false,
        error: "Requirement course search is unavailable right now.",
      });
    }
  };

  const clearRequirementSearch = () => {
    requirementRequestRef.current += 1;
    requirementAllCoursesRef.current = [];
    setRequirementSearch(null);
  };

  // Catalog-backed courses mentioned in chat — only real catalog hits become
  // draggable chips, so false positives like "NEEDS 3" stay plain text.
  const chatCourseCacheRef = useRef(new Map());
  const chatCourseInflightRef = useRef(new Set());
  const [chatCourseCache, setChatCourseCache] = useState(() => new Map());

  const rememberChatCourse = useCallback((course, aliases = []) => {
    if (!course?.course_id) return;
    setChatCourseCache((prev) => {
      const next = new Map(prev);
      const keys = new Set([
        compactCourseId(course.course_id),
        ...aliases.map(compactCourseId),
        ...[...courseIdVariants(course.course_id)].map(compactCourseId),
      ]);
      for (const key of keys) {
        if (key) next.set(key, course);
      }
      chatCourseCacheRef.current = next;
      return next;
    });
  }, []);

  const fetchCatalogCourse = useCallback(async (courseId) => {
    const key = compactCourseId(courseId);
    if (!key) return null;
    if (chatCourseCacheRef.current.has(key)) {
      return chatCourseCacheRef.current.get(key);
    }
    if (chatCourseInflightRef.current.has(key)) return null;
    chatCourseInflightRef.current.add(key);
    try {
      const response = await fetch(`${API_URL}/search-courses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: courseId,
          filters: {},
          vouchedCodes: vouchedCodesRef.current,
        }),
      });
      const data = await response.json();
      const wanted = compactCourseId(courseId);
      const match =
        data.results?.find((c) => compactCourseId(c.course_id) === wanted) ||
        data.results?.find((c) =>
          [...courseIdVariants(c.course_id)].some(
            (variant) => compactCourseId(variant) === wanted
          )
        ) ||
        null;
      if (match) {
        rememberChatCourse(match, [courseId]);
        return match;
      }
      return null;
    } catch {
      return null;
    } finally {
      chatCourseInflightRef.current.delete(key);
    }
  }, [rememberChatCourse]);

  const lookupChatCourse = useCallback(
    (courseId) => chatCourseCache.get(compactCourseId(courseId)) || null,
    [chatCourseCache]
  );

  // Prefetch catalog rows for every course code that appears in this plan's chat.
  useEffect(() => {
    const ids = [];
    const seen = new Set();
    for (const msg of chatMessages) {
      for (const id of extractCourseMentions(msg.content)) {
        const key = compactCourseId(id);
        if (!key || seen.has(key) || chatCourseCacheRef.current.has(key)) continue;
        seen.add(key);
        ids.push(id);
      }
      for (const placement of msg.placements || []) {
        for (const label of placement.courses || []) {
          // Labels may be "DSC 100 (4u)" — extract the real code for lookup.
          for (const id of extractCourseMentions(label)) {
            const key = compactCourseId(id);
            if (!key || seen.has(key) || chatCourseCacheRef.current.has(key)) {
              continue;
            }
            seen.add(key);
            ids.push(id);
          }
        }
      }
    }
    if (!ids.length) return;
    let cancelled = false;
    (async () => {
      await Promise.all(
        ids.map(async (id) => {
          if (cancelled) return;
          await fetchCatalogCourse(id);
        })
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [chatMessages, fetchCatalogCourse]);

  // Open the details pane for a course we only know by id (unlocks chips)
  const openCourseById = useCallback(
    async (courseId) => {
      const cached = lookupChatCourse(courseId);
      if (cached) {
        setSelectedCourse(normalizeSelectedCourse(cached));
        return;
      }
      try {
        const match = await fetchCatalogCourse(courseId);
        if (match) setSelectedCourse(normalizeSelectedCourse(match));
      } catch {
        // details pane just stays where it is
      }
    },
    [fetchCatalogCourse, lookupChatCourse]
  );

  const openChatCourse = useCallback((course) => {
    if (course) setSelectedCourse(normalizeSelectedCourse(course));
  }, []);

  // Planner / quarter / search clicks arrive via MainLayout.
  // Keyed on token so re-clicking the same course still works, and so a
  // later catalog-cache update does not re-fire the open.
  useEffect(() => {
    if (!courseOpenRequest?.token || !courseOpenRequest?.courseId) return;
    const { course, courseId } = courseOpenRequest;
    if (course?.course_id || course?.courseId) {
      setSelectedCourse(normalizeSelectedCourse(course));
      // Still refresh from catalog when the grid stub is thin (audit rows
      // often lack description / offerings / professors).
      if (!course.description && !course.professors) {
        openCourseById(courseId);
      }
      return;
    }
    openCourseById(courseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token is the click signal
  }, [courseOpenRequest?.token]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages]);

  const handleDragStart = (e, course) => {
    e.dataTransfer.setData("course", JSON.stringify(course));
    e.dataTransfer.setData("isFromSidebar", "true");
  };

  const handleDragEnd = () => {};

  const stopMessage = (contextKey) => {
    // onClick may pass a SyntheticEvent — only treat real string keys as overrides.
    const key =
      typeof contextKey === "string" && contextKey
        ? contextKey
        : chatContextKey;
    const controller = abortControllersRef.current[key];
    if (controller) {
      controller.abort();
      delete abortControllersRef.current[key];
    }
  };

  const sendMessage = async () => {
    const requestContextKey = chatContextKey;
    if (
      !currentMessage.trim() ||
      sendingContextsRef.current.has(requestContextKey)
    ) {
      return;
    }

    const messageText = currentMessage;
    const userMessage = { role: "user", content: messageText };
    const requestHistory = chatMessages.map(({ role, content }) => ({
      role,
      content,
    }));
    const abortController = new AbortController();
    const { signal } = abortController;
    abortControllersRef.current[requestContextKey] = abortController;
    sendingContextsRef.current.add(requestContextKey);
    updateChatMessages(requestContextKey, (prev) => [...prev, userMessage]);
    setCurrentMessage("");
    setLoadingByContext((current) => ({
      ...current,
      [requestContextKey]: true,
    }));

    const throwIfAborted = () => {
      if (signal.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }
    };

    try {
      // Seat context: enrollment-quarter courses + codes named in the message +
      // unmet audit options that Class Planner says are offered next quarter.
      // First plans often have an empty grid — without the unmet/upcoming set
      // the agent would draft the enrollment quarter with no seat signal.
      const planCourseIds = enrollmentSlot
        ? courseIdsInQuarter(
            schedule,
            enrollmentSlot.yearIndex,
            enrollmentSlot.term
          )
        : [];
      const mentionedIds = courseIdsFromText(messageText);
      const unmetOfferedIds = extractUnmetRequirements(
        parsedCourseData?.sections || []
      )
        .flatMap((r) => r.codes || [])
        .filter((id) => id && isOffered(id));
      // /next-quarter/seats caps at 24 courses per request.
      let seatCourseIds = [
        ...new Set([...planCourseIds, ...mentionedIds, ...unmetOfferedIds]),
      ].slice(0, 24);
      let sectionsForChat = tssSections || {};
      let seatLive = Boolean(tssOfferings.live);
      let seatRefreshedAt = tssOfferings.refreshedAt || null;
      if (seatCourseIds.length) {
        try {
          const liveResult = await syncLiveSeats(seatCourseIds);
          throwIfAborted();
          if (liveResult?.sections) {
            sectionsForChat = liveResult.sections;
          }
          if (liveResult?.ok) {
            // Proxy may echo snapshot numbers with stale:true — still usable,
            // but only mark live when the refresh was fresh.
            seatLive = !liveResult.stale;
            seatRefreshedAt =
              liveResult.updatedAt || liveResult.checkedAt || Date.now();
          }
        } catch (err) {
          if (err?.name === "AbortError") throw err;
          /* published snapshot is enough */
        }
      }
      const buildSeats = () =>
        buildSeatAvailability({
          sectionsByCourse: sectionsForChat,
          courseIds: seatCourseIds,
          termLabel: enrollmentQuarter?.label || null,
          source: seatLive ? "live" : tssOfferings.source || null,
          refreshedAt: seatRefreshedAt,
          live: seatLive,
        });

      const buildSectionOptionsPayload = (courseIds) => {
        if (!enrollmentSlot) return null;
        const quarterCourses = coursesInQuarter(
          schedule,
          enrollmentSlot.yearIndex,
          enrollmentSlot.term
        );
        const wanted = new Set(
          (courseIds || []).map((id) => compactCourseId(id)).filter(Boolean)
        );
        const courses = wanted.size
          ? quarterCourses.filter((c) =>
              wanted.has(compactCourseId(c.course_id))
            )
          : quarterCourses;
        if (!courses.length) return null;
        return buildSectionOptions({
          courses,
          sectionsByCourse: sectionsForChat,
          year: enrollmentSlot.academicYear,
          term: enrollmentSlot.term,
          termLabel: enrollmentQuarter?.label || enrollmentSlot.label || null,
          source: seatLive ? "live" : tssOfferings.source || null,
          live: seatLive,
          refreshedAt: seatRefreshedAt,
        });
      };

      // Eagerly attach enrollable packages for the enrollment quarter (same
      // turn as seats) so "do I have conflicts?" can answer without a tool pause.
      let sectionOptions = planCourseIds.length
        ? buildSectionOptionsPayload(planCourseIds)
        : null;

      const uiContext = {
        view: currentPage || "planner",
        enrollment: enrollmentSlot
          ? {
              label:
                enrollmentQuarter?.label || enrollmentSlot.label || null,
              year_index: enrollmentSlot.yearIndex,
              term: enrollmentSlot.term,
            }
          : null,
      };

      const postChat = async ({ seatAvailability, sectionOptions: opts } = {}) => {
        const payload = {
          message: messageText,
          // The backend is stateless, so the plan-specific transcript is sent
          // on every turn. The latest audit/grid are always authoritative.
          thread_id: requestContextKey,
          history: requestHistory,
          audit_sections: parsedCourseData?.sections || [],
          schedule: Array.isArray(schedule) ? schedule : [],
          seat_availability: seatAvailability,
          section_options: opts || undefined,
          ui_context: uiContext,
          // Which academic year year_index 0 means, from the audit's Catalog
          // Year. Without it the agent falls back to the calendar anchor and
          // would place courses into the wrong rows for any cohort that did
          // not start in the launch year.
          base_year: baseYear ?? undefined,
        };
        const attempt = async () => {
          const response = await fetch(`${API_URL}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Austin's abort support: the Stop button aborts the in-flight
            // request rather than letting a dead turn finish silently.
            signal,
            body: JSON.stringify(payload),
          });
          const text = await response.text();
          try {
            return JSON.parse(text);
          } catch {
            const error = new Error(
              `Chat endpoint returned a non-JSON response (${response.status}).`
            );
            error.retryable =
              response.status === 502 ||
              response.status === 503 ||
              response.status === 504 ||
              !text;
            throw error;
          }
        };
        try {
          return await attempt();
        } catch (error) {
          // An aborted turn is not a failure to retry: AbortError falls
          // through both tests below and propagates to the Stop handler.
          const retryable =
            error?.retryable ||
            error?.name === "TypeError" ||
            /failed to fetch|network|load failed/i.test(error?.message || "");
          if (!retryable) throw error;
          await new Promise((resolve) => setTimeout(resolve, 2500));
          return attempt();
        }
      };

      // The agent may discover relevant courses only after SearchCourses runs,
      // or pause for enrollable packages via LoadSectionOptions. Refresh seats
      // through the Class Planner proxy (TSS fallback) and transparently retry.
      let data = null;
      for (let lookupRound = 0; lookupRound < 4; lookupRound += 1) {
        throwIfAborted();
        // postChat already parses (and retries) — it returns the payload, not
        // a Response, so there is no .json() call to make here.
        data = await postChat({
          seatAvailability: buildSeats(),
          sectionOptions,
        });
        throwIfAborted();

        const sectionReq = data?.section_options_request;
        if (sectionReq && typeof sectionReq === "object") {
          const requestedIds = Array.isArray(sectionReq.course_ids)
            ? sectionReq.course_ids.filter(Boolean)
            : planCourseIds;
          const refreshIds = [
            ...new Set([...(requestedIds.length ? requestedIds : planCourseIds)]),
          ];
          if (refreshIds.length) {
            const liveResult = await syncLiveSeats(refreshIds);
            throwIfAborted();
            if (liveResult?.sections) {
              sectionsForChat = liveResult.sections;
            }
            if (liveResult?.ok) {
              seatLive = !liveResult.stale;
              seatRefreshedAt =
                liveResult.updatedAt || liveResult.checkedAt || Date.now();
            }
            seatCourseIds = [
              ...new Set([...seatCourseIds, ...refreshIds]),
            ];
          }
          sectionOptions = buildSectionOptionsPayload(refreshIds);
          // Empty quarter / no section rows: retry with an explicit empty payload so
          // the agent can explain instead of pausing forever.
          if (!sectionOptions) {
            sectionOptions = {
              year: enrollmentSlot?.academicYear || null,
              term: enrollmentSlot?.term || null,
              termLabel:
                enrollmentQuarter?.label || enrollmentSlot?.label || null,
              source: seatLive ? "live" : tssOfferings.source || null,
              live: seatLive,
              refreshedAt: seatRefreshedAt,
              courses: [],
            };
          }
          continue;
        }

        const requested = Array.isArray(data?.seat_lookup)
          ? data.seat_lookup.filter(Boolean)
          : [];
        if (!requested.length) break;

        const known = new Set(seatCourseIds.map(compactCourseId));
        const additions = requested.filter(
          (courseId) => !known.has(compactCourseId(courseId))
        );
        if (!additions.length) {
          throw new Error("The assistant repeated an already completed seat lookup.");
        }
        seatCourseIds = [...seatCourseIds, ...additions];

        const liveResult = await syncLiveSeats(additions);
        throwIfAborted();
        if (liveResult?.sections) {
          sectionsForChat = liveResult.sections;
        }
        if (liveResult?.ok) {
          seatLive = !liveResult.stale;
          seatRefreshedAt =
            liveResult.updatedAt || liveResult.checkedAt || Date.now();
        }
      }
      if (data?.section_options_request) {
        throw new Error(
          "The assistant requested too many consecutive section-option loads."
        );
      }
      if (Array.isArray(data?.seat_lookup) && data.seat_lookup.length) {
        throw new Error("The assistant requested too many consecutive seat lookups.");
      }

      // Extract the actual content from the response
      let assistantContent;
      let aiMessage = null;
      if (data.error) {
        assistantContent = `Error: ${data.error}`;
      } else if (data.messages?.length > 0) {
        // Find the last AI message
        aiMessage = data.messages.filter((msg) => msg.type === "ai").pop();
        assistantContent = aiMessage?.content || "No response";
      } else if (data.content) {
        assistantContent = data.content;
      } else if (data.response) {
        assistantContent = data.response;
      } else {
        assistantContent = "No response received";
      }

      throwIfAborted();
      updateChatMessages(requestContextKey, (prev) => [
        ...prev,
        {
          role: "assistant",
          content: assistantContent,
          // Present when the backend proposed a schedule for the grid
          proposedSchedule: aiMessage?.proposed_schedule || null,
          placements: aiMessage?.placements || null,
          warnings: aiMessage?.warnings || null,
          proposedSections: aiMessage?.proposed_sections || null,
        },
      ]);
    } catch (err) {
      // Stop / abort: leave the user message, drop the thinking indicator,
      // and do not append a fake error reply.
      if (err?.name !== "AbortError") {
        const localHint = import.meta.env.PROD
          ? "The planning server may still be starting — wait a few seconds and try again."
          : "Is the Express server running on port 5050?";
        updateChatMessages(requestContextKey, (prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Sorry, something went wrong. ${localHint}`,
          },
        ]);
      }
    } finally {
      if (abortControllersRef.current[requestContextKey] === abortController) {
        delete abortControllersRef.current[requestContextKey];
      }
      sendingContextsRef.current.delete(requestContextKey);
      setLoadingByContext((current) => ({
        ...current,
        [requestContextKey]: false,
      }));
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Escape" && isLoading) {
      e.preventDefault();
      stopMessage();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading) sendMessage();
    }
  };

  // Height transitions fight the column takeover and look broken —
  // only animate the search/chat split while both panels stay docked.
  const animateSplit =
    !isResizing && !layoutExpanded && expandedPanel === null;

  return (
    <div
      ref={sidebarRef}
      className="relative bg-white border-l border-slate-200 h-full"
      style={{ width: `${width}px` }}
    >
      {/* Resize handle — available docked and full-bleed so width is always free */}
      <div
        className="absolute top-0 left-0 h-full w-1.5 hover:bg-navy-300 cursor-ew-resize z-10 transition-colors"
        title="Drag to resize"
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);

          const handleMouseMove = (moveEvent) => {
            const right =
              sidebarRef.current?.getBoundingClientRect().right ??
              window.innerWidth;
            onWidthChange?.(right - moveEvent.clientX);
          };

          const handleMouseUp = () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
            setIsResizing(false);
          };

          document.addEventListener("mousemove", handleMouseMove);
          document.addEventListener("mouseup", handleMouseUp);
        }}
      />

      <div className="flex flex-col h-full min-h-0">
        {/* Course search area — fills almost everything when maximized;
            collapses to its h-11 header when chat is maximized. */}
        <div
          style={{
            height:
              expandedPanel === "search"
                ? "calc(100% - 2.75rem)"
                : expandedPanel === "chat"
                  ? "2.75rem"
                  : `${searchSectionHeight}%`,
            transition: animateSplit ? "height 200ms ease-out" : "none",
          }}
          className="flex-shrink-0 overflow-hidden"
        >
          <div className="h-full overflow-hidden">
            {selectedCourse ? (
              <CourseDetails
                course={selectedCourse}
                onBack={() => setSelectedCourse(null)}
                onSelectCourseId={openCourseById}
                apiUrl={API_URL}
                expandState={expandedPanel === "search" ? "expanded" : null}
                onToggleExpand={() => toggleExpandedPanel("search")}
                onMinimize={dockedMinimize}
              />
            ) : (
              <CourseSearch
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                searchResults={searchResults}
                searchTotal={searchTotal}
                searchError={searchError}
                filters={filters}
                setFilters={setFilters}
                departments={departmentsForUi}
                handleDragStart={handleDragStart}
                handleDragEnd={handleDragEnd}
                isCourseLoading={
                  isCourseLoading ||
                  (nextQuarterOnly && tssOfferings.status === "loading")
                }
                debouncedSearch={debouncedSearch}
                onCourseClick={(course) =>
                  setSelectedCourse(normalizeSelectedCourse(course))
                }
                recommendations={recommendations}
                hasAudit={parsedCourseData?.sections?.length > 0}
                requirementSearch={requirementSearch}
                onRequirementDrop={handleRequirementDrop}
                onClearRequirementSearch={clearRequirementSearch}
                expandState={expandedPanel === "search" ? "expanded" : null}
                onToggleExpand={() => toggleExpandedPanel("search")}
                onMinimize={dockedMinimize}
                nextQuarterOnly={nextQuarterOnly}
                onToggleNextQuarter={handleToggleNextQuarter}
                enrollmentQuarter={enrollmentQuarter}
                tssOfferings={tssOfferings}
              />
            )}
          </div>
        </div>

        {/* Divider between search and chat (hidden while a panel is maximized).
            Tall hit target so dragging the assistant up doesn't land in search. */}
        {expandedPanel === null && (
          <div
            className="relative z-10 flex-shrink-0 h-3 -my-1 flex items-center cursor-ns-resize group"
            title="Drag to resize · double-click to reset"
            onDoubleClick={() => setSearchSectionHeight(35)}
            onMouseDown={(e) => {
              e.preventDefault();
              const startY = e.clientY;
              const startHeight = searchSectionHeight;
              const container = sidebarRef.current;
              setIsResizing(true);

              const handleMouseMove = (moveEvent) => {
                const deltaY = moveEvent.clientY - startY;
                const containerHeight = container?.offsetHeight ?? 0;
                if (!containerHeight) return;
                const newHeightPercent = Math.max(
                  20,
                  Math.min(80, startHeight + (deltaY / containerHeight) * 100)
                );
                setSearchSectionHeight(newHeightPercent);
              };

              const handleMouseUp = () => {
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
                setIsResizing(false);
              };

              document.addEventListener("mousemove", handleMouseMove);
              document.addEventListener("mouseup", handleMouseUp);
            }}
          >
            <div className="w-full h-0.5 bg-slate-200 group-hover:bg-navy-300 group-active:bg-navy-400 transition-colors" />
            <div
              aria-hidden
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <span className="w-0.5 h-2.5 rounded-full bg-navy-400" />
              <span className="w-0.5 h-2.5 rounded-full bg-navy-400" />
              <span className="w-0.5 h-2.5 rounded-full bg-navy-400" />
            </div>
          </div>
        )}

        {/* Course assistant chat area — fills whatever the search area leaves,
            so it animates along with it. Collapsed = its h-11 header. */}
        <div className="flex flex-col flex-grow min-h-0 overflow-hidden">
          <CourseAssistant
            key={chatContextKey}
            chatMessages={chatMessages}
            currentMessage={currentMessage}
            setCurrentMessage={setCurrentMessage}
            isLoading={isLoading}
            sendMessage={sendMessage}
            stopMessage={stopMessage}
            chatEndRef={chatEndRef}
            onKeyPress={handleKeyPress}
            onApplyPlan={onApplyPlan}
            onApplySectionProposal={onApplySectionProposal}
            expandState={expandedPanel === "chat" ? "expanded" : null}
            onToggleExpand={() => toggleExpandedPanel("chat")}
            courseLookup={lookupChatCourse}
            onCourseDragStart={handleDragStart}
            onCourseDragEnd={handleDragEnd}
            onOpenCourse={openChatCourse}
          />
        </div>
      </div>
    </div>
  );
};

export default RightSidebar;
