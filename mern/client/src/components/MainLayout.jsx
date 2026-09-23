import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import RightSidebar from "./right-sidebar/RightSidebar";
import LeftSidebar from "./LeftSidebar";
import CoursePlannerContainer from "./planner/CoursePlannerContainer"; // use existing planner
import CourseStorage from "./CourseStorage";
import QuarterlyView from "./QuarterlyView";
import AdminSectionData from "./AdminSectionData";
import Header from "./Header";
import MobileTabBar from "./MobileTabBar";
import { useCompactLayout } from "../utils/useCompactLayout";
import { useAuth } from "../context/AuthContext";
import { useNextQuarterOfferings } from "../context/NextQuarterOfferingsContext";
import { api } from "../utils/api";
import { enrollmentPlanSlot } from "../utils/academicCalendar";
import { courseIdsInQuarter } from "../utils/seatAvailability";
import {
  applyEnrollmentsToQuarter,
  keepTakenCourses,
  normalizePlanGrid,
} from "../utils/scheduleOps";
import {
  isPlanNotFound,
  listSavedPlans,
  updateSavedPlan,
} from "../utils/savedPlans";
import {
  SIGN_IN_MIGRATION_KEY,
  clearDeviceLocalPlanState,
  readLocalPlannerState,
  resolvePlanConflict,
  scheduleHasCourses,
  writeLocalPlannerState,
} from "../utils/plannerStateStore";
import {
  MIN_PLAN_YEARS,
  mergeAuditIntoSchedule,
  parseCatalogYear,
  planWindow,
  processAuditForPlanner,
  yearLabelsFor,
} from "../utils/auditCoursePlanner";
import { coursesInQuarter } from "../utils/quarterPlans";
import {
  buildSectionOptions,
  validateProposalStillFresh,
} from "../utils/sectionOptimizer";

const SAVE_DEBOUNCE_MS = 800;
const ACTIVE_PLAN_SYNC_DEBOUNCE_MS = 1200;
const MIN_SIDEBAR = 250;
const MIN_MAIN = 320;
const RAIL_WIDTH = 36; // matches w-9 restore rails
const DEFAULT_LEFT_WIDTH = 320;
// Chat-first right rail — a bit wider so assistant replies aren't cramped
const DEFAULT_RIGHT_WIDTH = 360;

const emptySchedule = (yearCount = MIN_PLAN_YEARS) =>
  Array(yearCount)
    .fill()
    .map(() => ({
      fall: Array(3).fill(null),
      winter: Array(3).fill(null),
      spring: Array(3).fill(null),
    }));

const emptyAuditData = () => ({ sections: [], metadata: {} });

// How much of each chat transcript is persisted with the plan. Old turns
// beyond this are dropped from storage (the on-screen thread keeps them for
// the session) so the planner_states blob can't grow without bound.
const MAX_PERSISTED_CHAT_MESSAGES = 60;

const MainLayout = () => {
  const { user, initializing, sessionExpired } = useAuth();
  // Narrow viewports get a single-pane shell with a bottom tab bar. The
  // resizable three-column workspace needs ~1024px before it fits.
  const isCompact = useCompactLayout();
  const {
    syncLiveSeats,
    sections: tssSections,
    tssOfferings,
    enrollmentQuarter,
  } = useNextQuarterOfferings();

  const [currentPage, setCurrentPage] = useState("planner");

  // State for parsed degree audit data
  const [parsedCourseData, setParsedCourseData] = useState(emptyAuditData);

  // The planner grid — owned here so the Planner AND the Quarter View can
  // both read and edit it (and the chat assistant can send it as context)
  const [schedule, setSchedule] = useState(emptySchedule);

  // Assistant transcripts, keyed by plan context ("saved-<id>" for named
  // plans, "working-plan" for the unnamed live plan). Owned here so they
  // persist with the plan: written into the same device blob / Supabase row
  // as the schedule, restored on load, wiped on account switch.
  const [chatThreads, setChatThreads] = useState({});

  // AI-proposed plan the user accepted in chat; keyed so re-applying works
  const [appliedPlan, setAppliedPlan] = useState(null);

  // A saved schedule being restored (from this device or the account)
  const [restoredPlan, setRestoredPlan] = useState(null);

  // Identity of the named saved plan currently open for editing. This is
  // intentionally separate from the live auto-saved planner state.
  const [activeSavedPlan, setActiveSavedPlan] = useState(null);

  // "idle" | "saving" | "saved" | "local" | "error"
  const [syncStatus, setSyncStatus] = useState("idle");

  // True once the signed-in account's planner_states row has been applied (or
  // confirmed empty). Gates named-plan autosave so we don't overwrite with a
  // pre-restore grid.
  const [accountReady, setAccountReady] = useState(false);

  // null | "requirements" | "search" | "chat" | "main" — near-fullscreen panel takeover
  const [expandedPanel, setExpandedPanel] = useState(null);

  // Which of the three columns the phone is showing. Desktop ignores it.
  // "main" covers every page (planner / quarter / storage / admin).
  const [mobileView, setMobileView] = useState("main");

  // Touch has no HTML5 drag-and-drop, so a phone places courses in two taps:
  // arm a course here, then tap the quarter it belongs in. { course, source }
  // — source is set when moving a card already on the grid, null from search.
  const [pendingPlacement, setPendingPlacement] = useState(null);

  // A requirement the student asked to see courses for, from the Progress
  // panel. On desktop that is a drag into Course Search; on a phone it is a
  // tap, which has to travel through here to reach the right rail.
  const [requirementRequest, setRequirementRequest] = useState(null);

  // Docked sidebars can be tucked away to give the planner more room
  const [leftMinimized, setLeftMinimized] = useState(false);
  const [rightMinimized, setRightMinimized] = useState(false);

  // Tokenized request so re-clicking the same course still opens details.
  // Consumed by RightSidebar (catalog fetch + CourseDetails).
  const [courseOpenRequest, setCourseOpenRequest] = useState(null);

  // Continuous widths — maximize jumps to full workspace, drag always works
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);

  const hydratedRef = useRef(false);
  const saveTimerRef = useRef(null);
  const activePlanSyncTimerRef = useRef(null);
  const lastSyncedActivePlanFpRef = useRef(null);
  const serverLoadedRef = useRef(false);
  const activePlanBootstrappedRef = useRef(false);
  const prevUserIdRef = useRef(undefined);
  // Set when a sign-out / account switch has asked for a blank slate but the
  // reset hasn't rendered yet — without it the autosave effect fires once more
  // with the departing account's grid and writes it straight back to the disk
  // we just wiped.
  const planResetPendingRef = useRef(false);
  // True once this session has held a non-empty plan. Lets the autosave effect
  // tell "hasn't loaded yet" (skip) from "the student cleared it" (save).
  const hasHadPlanContentRef = useRef(false);
  const workspaceRef = useRef(null);
  // Read inside identity-stable callbacks (handleOpenCourse is an effect
  // dependency elsewhere), so they can branch on layout without churning.
  const compactRef = useRef(isCompact);
  compactRef.current = isCompact;
  const leftWidthBeforeExpandRef = useRef(DEFAULT_LEFT_WIDTH);
  const rightWidthBeforeExpandRef = useRef(DEFAULT_RIGHT_WIDTH);

  // The student's plan window: which academic year is Year 1, and how many
  // years the grid spans. Anchored to the audit's Catalog Year, so a 2026
  // freshman gets a grid starting at 2026-27 rather than being dropped into
  // "Year 3" of a fixed 2024-anchored grid, and a fifth-year gets a fifth row
  // instead of losing the quarter they're enrolling in. Falls back to the
  // calendar anchor until an audit is uploaded.
  const planWindowValue = useMemo(
    () => planWindow(parseCatalogYear(parsedCourseData?.metadata?.catalogYear)),
    [parsedCourseData?.metadata?.catalogYear]
  );
  const yearLabels = useMemo(
    () => yearLabelsFor(planWindowValue),
    [planWindowValue]
  );

  // Restore/bootstrap callbacks below are deliberately identity-stable (they
  // are effect dependencies), so they read the plan window and the live grid
  // through refs. Closing over the values instead froze yearCount at the
  // pre-audit default of 4, which truncated a fifth-year student's Year 5 and
  // made the baseline fingerprint permanently unmatchable.
  const yearCountRef = useRef(planWindowValue.yearCount);
  yearCountRef.current = planWindowValue.yearCount;
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;
  const userRef = useRef(user);
  userRef.current = user;
  const activeSavedPlanRef = useRef(activeSavedPlan);
  activeSavedPlanRef.current = activeSavedPlan;
  // Last signed-in account. While a session has merely EXPIRED (not signed
  // out), device writes stay stamped with this owner so the blob remains that
  // student's — reconcilable on re-sign-in, inert to anyone else.
  const lastOwnerIdRef = useRef(null);
  if (user?.id) lastOwnerIdRef.current = user.id;

  // Calendar enrollment slot — Quarter View lenses onto this term of the
  // active plan's grid (not a shared global quarter across named plans).
  const enrollmentSlot = useMemo(
    () => enrollmentPlanSlot(planWindowValue),
    [planWindowValue]
  );

  // "Create new plan" clears planned courses but keeps transcript history so
  // a placed degree audit isn't wiped from prior years / the left sidebar.
  const buildFreshSchedule = useCallback(() => {
    const years = yearLabels.length || planWindowValue.yearCount || MIN_PLAN_YEARS;
    const blank = emptySchedule(years);
    if ((parsedCourseData?.sections || []).length) {
      // Re-seed from the audit, then drop anything that isn't completed /
      // in-progress (convertAuditToPlanner can emit planned rows too).
      return keepTakenCourses(
        processAuditForPlanner(
          parsedCourseData.sections,
          blank,
          planWindowValue
        )
      );
    }
    return keepTakenCourses(schedule);
  }, [
    yearLabels.length,
    planWindowValue,
    parsedCourseData?.sections,
    schedule,
  ]);

  const workspaceWidth = useCallback(
    () => workspaceRef.current?.clientWidth ?? window.innerWidth,
    []
  );

  // Entering the phone layout: drop every desktop-only layout mode so the
  // single-pane shell starts clean, and leaving it drops the phone-only ones.
  useEffect(() => {
    if (isCompact) {
      setExpandedPanel(null);
      setLeftMinimized(false);
      setRightMinimized(false);
    } else {
      setPendingPlacement(null);
      setMobileView("main");
    }
  }, [isCompact]);

  // Arm a course for tap-to-place, and show the student the grid it lands on.
  const handleQueuePlacement = useCallback((course, source = null) => {
    if (!course?.course_id) return;
    setPendingPlacement({ course, source, token: Date.now() });
    setMobileView("main");
    // Quarter View can take the placement itself; anything else means the
    // planner grid, so leave a quarter lens alone and pull the rest back.
    setCurrentPage((page) => (page === "quarter" ? page : "planner"));
  }, []);

  const cancelPlacement = useCallback(() => setPendingPlacement(null), []);

  // Show courses that satisfy a requirement — a drag into Course Search on
  // desktop, a tap in the Progress panel on a phone.
  const handleRequirementSearch = useCallback((requirement) => {
    if (!requirement?.codes?.length) return;
    setRequirementRequest({ requirement, token: Date.now() });
    setMobileView("assistant");
  }, []);

  const leftOccupied = leftMinimized ? RAIL_WIDTH : leftWidth;
  const rightOccupied = rightMinimized ? RAIL_WIDTH : rightWidth;

  const restoreExpandedWidths = useCallback((panel) => {
    if (panel === "requirements") {
      setLeftWidth(leftWidthBeforeExpandRef.current);
    } else if (panel === "search" || panel === "chat") {
      setRightWidth(rightWidthBeforeExpandRef.current);
    }
  }, []);

  const handleToggleLeftExpand = useCallback(() => {
    setExpandedPanel((current) => {
      if (current === "requirements") {
        setLeftWidth(leftWidthBeforeExpandRef.current);
        return null;
      }
      if (current === "search" || current === "chat") {
        setRightWidth(rightWidthBeforeExpandRef.current);
      }
      // Leaving main expand: sidebars come back at their docked widths
      leftWidthBeforeExpandRef.current = leftWidth;
      setLeftMinimized(false);
      setLeftWidth(workspaceWidth());
      return "requirements";
    });
  }, [leftWidth, workspaceWidth]);

  const handleToggleMainExpand = useCallback(() => {
    setExpandedPanel((current) => {
      if (current === "main") return null;
      if (current === "requirements") {
        setLeftWidth(leftWidthBeforeExpandRef.current);
      }
      if (current === "search" || current === "chat") {
        setRightWidth(rightWidthBeforeExpandRef.current);
      }
      return "main";
    });
  }, []);

  const handleExpandedPanelChange = useCallback(
    (nextOrUpdater) => {
      setExpandedPanel((current) => {
        const next =
          typeof nextOrUpdater === "function"
            ? nextOrUpdater(current)
            : nextOrUpdater;

        const wasRight = current === "search" || current === "chat";
        const willRight = next === "search" || next === "chat";

        if (current === "requirements" && next !== "requirements") {
          setLeftWidth(leftWidthBeforeExpandRef.current);
        }
        if (wasRight && !willRight) {
          setRightWidth(rightWidthBeforeExpandRef.current);
        }
        if (!wasRight && willRight) {
          rightWidthBeforeExpandRef.current = rightWidth;
          setRightMinimized(false);
          setRightWidth(workspaceWidth());
        }
        if (next === "requirements" && current !== "requirements") {
          if (wasRight) setRightWidth(rightWidthBeforeExpandRef.current);
          leftWidthBeforeExpandRef.current = leftWidth;
          setLeftMinimized(false);
          setLeftWidth(workspaceWidth());
        }

        return next;
      });
    },
    [leftWidth, rightWidth, workspaceWidth]
  );

  const handleLeftWidthChange = useCallback(
    (requested) => {
      const ws = workspaceWidth();
      if (expandedPanel === "requirements") {
        const next = Math.max(MIN_SIDEBAR, Math.min(ws, requested));
        if (next < ws - 16) {
          // Dragged off full-bleed — bring the planner back
          setExpandedPanel(null);
          const maxDocked = Math.max(
            MIN_SIDEBAR,
            ws - rightOccupied - MIN_MAIN
          );
          setLeftWidth(Math.min(next, maxDocked));
        } else {
          setLeftWidth(next);
        }
        return;
      }
      const max = Math.max(MIN_SIDEBAR, ws - rightOccupied - MIN_MAIN);
      setLeftWidth(Math.max(MIN_SIDEBAR, Math.min(max, requested)));
    },
    [expandedPanel, rightOccupied, workspaceWidth]
  );

  const handleRightWidthChange = useCallback(
    (requested) => {
      const ws = workspaceWidth();
      if (expandedPanel === "search" || expandedPanel === "chat") {
        const next = Math.max(MIN_SIDEBAR, Math.min(ws, requested));
        if (next < ws - 16) {
          setExpandedPanel(null);
          const maxDocked = Math.max(
            MIN_SIDEBAR,
            ws - leftOccupied - MIN_MAIN
          );
          setRightWidth(Math.min(next, maxDocked));
        } else {
          setRightWidth(next);
        }
        return;
      }
      const max = Math.max(MIN_SIDEBAR, ws - leftOccupied - MIN_MAIN);
      setRightWidth(Math.max(MIN_SIDEBAR, Math.min(max, requested)));
    },
    [expandedPanel, leftOccupied, workspaceWidth]
  );

  const handleApplyPlan = (grid) => {
    setAppliedPlan({ grid, key: Date.now() });
    setCurrentPage("planner"); // jump to the planner so the user sees the result
  };

  /**
   * Apply a chat-proposed section package selection to the enrollment quarter.
   * Re-fetches live TSS packages first so stale packageIds are rejected.
   */
  const handleApplySectionProposal = useCallback(
    async (proposal) => {
      if (!proposal?.selections?.length) {
        throw new Error("Proposal has no section selections.");
      }
      if (!enrollmentSlot) {
        throw new Error(
          "Enrollment quarter isn't on this 4-year grid — adjust the academic years."
        );
      }

      const courseIds = proposal.selections.map((s) => s.courseId).filter(Boolean);
      let sectionsByCourse = tssSections || {};
      let live = Boolean(tssOfferings?.live);
      let refreshedAt = tssOfferings?.refreshedAt || null;
      let source = tssOfferings?.source || null;

      if (courseIds.length) {
        try {
          const liveResult = await syncLiveSeats(courseIds);
          if (liveResult?.sections) {
            sectionsByCourse = liveResult.sections;
          }
          if (liveResult?.ok) {
            live = true;
            refreshedAt = liveResult.updatedAt || Date.now();
            source = "live";
          }
        } catch {
          /* fall through with whatever snapshot we have */
        }
      }

      const quarterCourses = coursesInQuarter(
        schedule,
        enrollmentSlot.yearIndex,
        enrollmentSlot.term
      );
      const stillPresent = new Set(
        quarterCourses.map((c) => String(c.course_id || "").toUpperCase())
      );
      const missing = courseIds.filter(
        (id) => !stillPresent.has(String(id).toUpperCase())
      );
      if (missing.length) {
        throw new Error(
          `These courses left the enrollment quarter: ${missing.join(", ")}. Ask the assistant to optimize again.`
        );
      }

      const freshOptions = buildSectionOptions({
        courses: quarterCourses,
        sectionsByCourse,
        year: enrollmentSlot.academicYear,
        term: enrollmentSlot.term,
        termLabel: enrollmentQuarter?.label || enrollmentSlot.label || null,
        source: live ? "live" : source,
        live,
        refreshedAt,
      });
      const freshness = validateProposalStillFresh(proposal, freshOptions);
      if (!freshness.ok) {
        throw new Error(
          freshness.reason ||
            "Section packages changed — ask the assistant to refresh and propose again."
        );
      }

      const now = Date.now();
      const updates = proposal.selections.map((row) => ({
        courseId: row.courseId,
        enrollment: {
          ...(row.enrollment || {
            packageId: row.packageId,
            instructors: row.instructors || [],
            primarySectionId: row.primarySectionId || null,
            primaryComponent: row.primaryComponent || null,
            meetings: row.meetings || [],
          }),
          selectedAt: now,
        },
      }));

      setSchedule((prev) =>
        applyEnrollmentsToQuarter(
          prev,
          enrollmentSlot.yearIndex,
          enrollmentSlot.term,
          updates
        )
      );
      setCurrentPage("quarter");
    },
    [
      enrollmentSlot,
      enrollmentQuarter,
      schedule,
      syncLiveSeats,
      tssSections,
      tssOfferings,
    ]
  );

  // Point the editor at a named plan. Baselines autosave to the live grid at
  // switch time so load/create don't look like dirty edits.
  //
  // Only a change of plan IDENTITY may re-baseline. A rename of the plan that
  // is already open comes through here too, and re-baselining on that asserted
  // "already synced" about a grid whose 1200ms sync was still pending — the
  // edit was dropped and the fingerprint then lied, so no later edit repaired it.
  const handleSavedPlanChange = useCallback(
    (plan) => {
      const sameOpenPlan = Boolean(plan?.id) && activeSavedPlan?.id === plan.id;
      if (!sameOpenPlan) {
        lastSyncedActivePlanFpRef.current = plan?.id
          ? JSON.stringify(schedule)
          : null;
      }
      setActiveSavedPlan(plan);
    },
    [schedule, activeSavedPlan?.id]
  );

  // A saved snapshot picked from the Storage page or the plan menu — full
  // grid, including that plan's upcoming enrollment quarter. The outgoing
  // named plan's last edits are flushed first: the 1200ms debounced sync is
  // cancelled by the switch, and without the flush the final drag before
  // "Load" silently never reached the plan it was made on.
  const handleLoadSavedPlan = useCallback(async (plan) => {
    const outgoing = activeSavedPlanRef.current;
    if (outgoing?.id && outgoing.id !== plan.id) {
      clearTimeout(activePlanSyncTimerRef.current);
      try {
        await updateSavedPlan(userRef.current, outgoing.id, {
          schedule: scheduleRef.current,
        });
      } catch (err) {
        // A ghost pointer (snapshot deleted elsewhere) must not block loading.
        if (!isPlanNotFound(err)) {
          console.error("Failed to flush the previous plan before loading:", err);
        }
      }
    }
    const grid = plan.schedule;
    // Baseline to the loaded snapshot (not the previous live grid).
    lastSyncedActivePlanFpRef.current = JSON.stringify(
      normalizePlanGrid(grid, yearCountRef.current)
    );
    setActiveSavedPlan({ id: plan.id, name: plan.name });
    setRestoredPlan({ grid, key: Date.now() });
    setCurrentPage("planner");
  }, []);

  const handleSavedPlanDelete = (ids) => {
    const gone = new Set(Array.isArray(ids) ? ids : [ids]);
    setActiveSavedPlan((current) => {
      if (current?.id && gone.has(current.id)) {
        lastSyncedActivePlanFpRef.current = null;
        return null;
      }
      return current;
    });
    // A deleted plan's conversation goes with it.
    setChatThreads((current) => {
      const next = { ...current };
      let changed = false;
      for (const id of gone) {
        if (`saved-${id}` in next) {
          delete next[`saved-${id}`];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  };

  // A new named plan was created from the grid on screen ("Save this plan
  // as…" / "Save a copy as…"). The conversation belongs to that work, so it
  // follows the plan: naming the untitled plan MOVES its thread onto the new
  // plan; copying an already-named plan copies its thread, and the original
  // keeps its own.
  const handleChatCarryOver = useCallback((newPlanId) => {
    if (!newPlanId) return;
    setChatThreads((current) => {
      const fromKey = activeSavedPlanRef.current?.id
        ? `saved-${activeSavedPlanRef.current.id}`
        : "working-plan";
      const msgs = current[fromKey];
      if (!Array.isArray(msgs) || !msgs.length) return current;
      const next = { ...current, [`saved-${newPlanId}`]: msgs };
      if (fromKey === "working-plan") delete next[fromKey];
      return next;
    });
  }, []);

  // Audit upload from the left sidebar. A re-upload REFRESHES the audit inside
  // the current plan: transcript cards (completed / in-progress / failed) are
  // rebuilt from the new audit, the student's planned courses stay where they
  // are, and the active named plan stays open. It used to detach the plan and
  // rebuild the grid from scratch — re-uploading deleted everything planned.
  // The first upload is the empty-plan case of the same merge.
  const handleParsedDataUpdate = (data) => {
    const sections = Array.isArray(data?.sections) ? data.sections : [];
    const nextWindow = planWindow(parseCatalogYear(data?.metadata?.catalogYear));
    setParsedCourseData(data);
    if (sections.length) {
      setSchedule((prev) => mergeAuditIntoSchedule(sections, prev, nextWindow));
    }
  };

  // Drop the active named-plan pointer only when the signed-in account
  // actually changes — not on the initial null → user hydration.
  //
  // Leaving one account for another (or for signed-out) also has to empty the
  // in-memory plan and the device copy of it. A degree audit is a full
  // academic record; on a shared machine the next person to open the app must
  // not inherit it, and their first edit must not be autosaved onto it.
  useEffect(() => {
    const nextId = user?.id ?? null;
    const prevId = prevUserIdRef.current;
    prevUserIdRef.current = nextId;
    if (prevId === undefined || prevId === nextId) return;

    // The session dropped on its own (expired/rotated refresh token, a
    // multi-tab refresh race) — the student did NOT leave. Wiping here is what
    // silently deleted their audit and plan "after a while" and forced a
    // re-upload. Keep everything; autosave falls back to device-local writes
    // stamped with the same owner, and re-signing-in reconciles them.
    if (!nextId && sessionExpired) return;

    setActiveSavedPlan(null);
    lastSyncedActivePlanFpRef.current = null;
    activePlanBootstrappedRef.current = false;

    // Only a departure FROM a real account wipes; null → user is a sign-in,
    // whose anonymous local plan may still be adoptable.
    if (!prevId) return;
    planResetPendingRef.current = true;
    // The next session starts fresh: an empty grid after this point means
    // "nothing loaded yet" again, not "the student cleared their plan".
    hasHadPlanContentRef.current = false;
    lastOwnerIdRef.current = null;
    clearDeviceLocalPlanState();
    setSchedule(emptySchedule());
    setParsedCourseData(emptyAuditData());
    setChatThreads({});
    setRestoredPlan(null);
    setAppliedPlan(null);
    setSyncStatus("idle");
  }, [user?.id, sessionExpired]);

  const applySavedState = useCallback((saved) => {
    if (!saved) return;
    if (saved.parsedCourseData && Array.isArray(saved.parsedCourseData.sections)) {
      setParsedCourseData(saved.parsedCourseData);
    }
    if (scheduleHasCourses(saved.schedule)) {
      // Keep the parent schedule in step with restored audit data. Deferring
      // this through the child can briefly expose an empty grid to auto-save.
      setSchedule(normalizePlanGrid(saved.schedule, yearCountRef.current));
    }
    // Per-plan assistant transcripts saved with the blob.
    if (saved.chatThreads && typeof saved.chatThreads === "object") {
      setChatThreads(saved.chatThreads);
    }
    // Re-open the named plan the student was editing last session.
    if (saved.activeSavedPlan?.id) {
      setActiveSavedPlan({
        id: saved.activeSavedPlan.id,
        name: saved.activeSavedPlan.name || "Saved plan",
      });
    }
  }, []);

  // 1) Restore whatever this device had saved, immediately on load.
  //    Only ANONYMOUS local state may be painted before we know who is signed
  //    in — a blob stamped with an account belongs to that student, and is
  //    applied (if at all) by the account load in step 2.
  useEffect(() => {
    try {
      const localState = readLocalPlannerState();
      if (localState && (localState.ownerId ?? null) === null) {
        applySavedState(localState);
      }
    } catch (err) {
      console.error("Failed to restore saved plan:", err);
    }
    hydratedRef.current = true;
  }, [applySavedState]);

  // 2) Once signed in, reconcile this device's copy with the account's plan.
  //    resolvePlanConflict owns the rules: a blob stamped with another account
  //    is inert, anonymous work is adopted only into an empty account, and a
  //    non-empty account plan is never silently replaced.
  useEffect(() => {
    if (initializing) return;
    if (!user) {
      serverLoadedRef.current = false;
      setAccountReady(false);
      return;
    }
    if (serverLoadedRef.current) return;
    serverLoadedRef.current = true;

    const markAccountReady = () => setAccountReady(true);

    const syncAfterSignIn = async () => {
      // Consumed exactly once, whatever happens below. It used to be cleared
      // only on the success path, so a single offline sign-in left it pending
      // forever and every later load took the migration branch — the account's
      // own plan was never read again. Ownership now decides what may be
      // adopted, so the flag no longer steers the merge at all.
      localStorage.removeItem(SIGN_IN_MIGRATION_KEY);

      try {
        const { data, updatedAt } = await api.loadPlannerState();
        // Re-read after the network round-trip — the student may have dragged
        // courses while the account plan was still loading.
        const localState = readLocalPlannerState();
        const { apply, upload } = resolvePlanConflict({
          local: localState,
          server: data,
          serverUpdatedAt: updatedAt,
          userId: user.id,
        });

        if (apply === "local") {
          applySavedState(localState);
        } else if (apply === "server") {
          applySavedState(data);
          setSyncStatus("saved");
        }

        if (upload) {
          setSyncStatus("saving");
          await api.savePlannerState(user.id, {
            ...localState,
            ownerId: user.id,
          });
          setSyncStatus("saved");
        }
        markAccountReady();
      } catch (err) {
        console.error("Failed to load saved plan:", err);
        // Offline: this account's own device copy is still the best we have.
        const localState = readLocalPlannerState();
        if (localState?.ownerId === user.id) applySavedState(localState);
        markAccountReady();
        setSyncStatus("error");
      }
    };

    syncAfterSignIn();
  }, [user, initializing, applySavedState]);

  // 3) Save immediately to this device so starting OAuth cannot lose the
  //    latest edit. Account saves remain debounced.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const hasChats = Object.values(chatThreads).some(
      (msgs) => Array.isArray(msgs) && msgs.length
    );
    const isEmpty =
      !scheduleHasCourses(schedule) &&
      !(parsedCourseData.sections || []).length &&
      !hasChats;

    // A sign-out asked for a blank slate. This effect still sees the departing
    // account's grid in the same commit, so hold the write until the reset has
    // actually landed rather than re-persisting what we just cleared.
    if (planResetPendingRef.current) {
      if (isEmpty) planResetPendingRef.current = false;
      return;
    }

    // An empty grid is ambiguous: it is either a session that hasn't loaded a
    // plan yet, or a student who deliberately deleted everything. Skipping both
    // meant a real "clear my plan" was never persisted — reload and the old
    // plan came back, with no way to actually empty it. Once this session has
    // seen content, an empty grid is a genuine clear and is saved as one.
    if (isEmpty && !hasHadPlanContentRef.current) {
      return; // nothing worth saving yet — don't overwrite a saved plan with an empty one
    }
    if (!isEmpty) hasHadPlanContentRef.current = true;

    // baseYear stamps which academic year year_index 0 meant when this was
    // saved. gridBaseYear re-anchors at FA28, and without the stamp an old
    // grid's "Year 4" would silently be reread as a future year — resurrecting
    // past placements as plannable. Nothing consumes it yet; it exists so the
    // migration that will need it has something to read.
    // Persist each thread's recent tail; empty threads are dropped.
    const persistedChatThreads = {};
    for (const [key, msgs] of Object.entries(chatThreads)) {
      if (Array.isArray(msgs) && msgs.length) {
        persistedChatThreads[key] = msgs.slice(-MAX_PERSISTED_CHAT_MESSAGES);
      }
    }

    const state = {
      schedule,
      parsedCourseData,
      chatThreads: persistedChatThreads,
      // Remember which named plan is open so the next visit resumes it.
      activeSavedPlan: activeSavedPlan
        ? { id: activeSavedPlan.id, name: activeSavedPlan.name }
        : null,
      baseYear: planWindowValue.baseYear,
      // Which account this device copy belongs to (null = written signed out).
      // localStorage is a property of the browser, not of the student, so
      // without this stamp the next person to sign in on a shared machine
      // inherits — and uploads over their own account — this degree audit.
      // While the session has merely EXPIRED, writes keep the last owner's
      // stamp: it is still that student's work, and stamping it null would
      // anonymize their audit on a shared machine.
      ownerId:
        user?.id ?? (sessionExpired ? lastOwnerIdRef.current : null) ?? null,
      savedAt: Date.now(),
    };
    writeLocalPlannerState(state);

    clearTimeout(saveTimerRef.current);
    if (user && accountReady) {
      saveTimerRef.current = setTimeout(() => {
        setSyncStatus("saving");
        api
          .savePlannerState(user.id, state)
          .then(() => setSyncStatus("saved"))
          .catch((err) => {
            console.error("Failed to save plan to account:", err);
            setSyncStatus("error");
          });
      }, SAVE_DEBOUNCE_MS);
    } else {
      setSyncStatus("local");
    }

    return () => clearTimeout(saveTimerRef.current);
    // accountReady belongs here: edits made while the account was still
    // hydrating were marked local-only, and without the dependency the effect
    // never re-ran to flush them once hydration finished.
    //
    // planWindowValue.baseYear is deliberately NOT a dependency: it only
    // stamps the payload, and depending on it would re-run this save when the
    // window shifts rather than when the plan actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, parsedCourseData, chatThreads, activeSavedPlan, user, accountReady]);

  // 4) On open: resume the named plan from last session, or fall back to the
  //    most recently updated saved plan so the app never starts on a blank
  //    editor when the student already has snapshots.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (initializing) return;
    if (user && !accountReady) return;
    if (activePlanBootstrappedRef.current) return;

    let cancelled = false;
    activePlanBootstrappedRef.current = true;

    (async () => {
      try {
        const plans = await listSavedPlans(user);
        if (cancelled) return;

        // React state may still be null in the same tick as local hydrate, so
        // also read the pointer from the persisted blob.
        const rememberedId =
          activeSavedPlan?.id ||
          readLocalPlannerState()?.activeSavedPlan?.id ||
          null;
        const match = rememberedId
          ? plans.find((p) => p.id === rememberedId)
          : null;

        if (match) {
          // Live grid already restored — just confirm the named-plan identity
          // (and refresh the display name if it was renamed elsewhere).
          setActiveSavedPlan({ id: match.id, name: match.name });
          if (lastSyncedActivePlanFpRef.current == null) {
            lastSyncedActivePlanFpRef.current = JSON.stringify(
              normalizePlanGrid(scheduleRef.current, yearCountRef.current)
            );
          }
          return;
        }

        // Hydrate restores the pointer from tp_planner_state even when the
        // snapshot is gone from the library. Leaving it set makes "Create
        // new plan" try to flush a ghost and fail with PLAN_NOT_FOUND.
        if (rememberedId) setActiveSavedPlan(null);

        // No remembered plan resolved. Falling back to the most recently
        // updated snapshot is only safe on an empty editor: with a live grid
        // already restored it dropped an unrelated old snapshot on top of it,
        // and autosave then persisted the replacement.
        if (plans.length && !scheduleHasCourses(scheduleRef.current)) {
          handleLoadSavedPlan(plans[0]);
        }
      } catch (err) {
        console.error("Failed to open last saved plan:", err);
      }
    })();

    return () => {
      cancelled = true;
      // Allow React Strict Mode's remount (and account switches) to retry.
      activePlanBootstrappedRef.current = false;
    };
    // Once per account session when hydration gates open — not on every
    // schedule edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, initializing, accountReady, handleLoadSavedPlan]);

  // Keep the active named plan's full grid in sync with live edits so Quarter
  // View / Planner changes aren't lost when loading another plan.
  useEffect(() => {
    if (!hydratedRef.current || !activeSavedPlan?.id) return;
    if (user && !accountReady) return;
    // An expired session can't reach the account's saved_plans rows — the
    // live blob keeps accumulating locally and reconciles on re-sign-in.
    if (!user && sessionExpired) return;

    const fp = JSON.stringify(schedule);
    if (fp === lastSyncedActivePlanFpRef.current) return;

    clearTimeout(activePlanSyncTimerRef.current);
    activePlanSyncTimerRef.current = setTimeout(async () => {
      try {
        await updateSavedPlan(user, activeSavedPlan.id, { schedule });
        lastSyncedActivePlanFpRef.current = fp;
      } catch (err) {
        console.error("Failed to sync active saved plan:", err);
      }
    }, ACTIVE_PLAN_SYNC_DEBOUNCE_MS);

    return () => clearTimeout(activePlanSyncTimerRef.current);
  }, [schedule, user, activeSavedPlan, accountReady, sessionExpired]);

  // Pull live TSS seats for courses on the enrollment quarter as soon as the
  // plan hydrates — no need to open Quarter View or click the Next filter.
  useEffect(() => {
    if (!hydratedRef.current || !enrollmentSlot) return;
    if (user && !accountReady) return;
    const ids = courseIdsInQuarter(
      schedule,
      enrollmentSlot.yearIndex,
      enrollmentSlot.term
    );
    if (!ids.length) return;
    syncLiveSeats(ids).catch(() => {});
  }, [schedule, enrollmentSlot, user, accountReady, syncLiveSeats]);

  // Open CourseDetails in the right rail from planner / quarter / search clicks.
  const handleOpenCourse = useCallback((courseOrId) => {
    const courseId =
      typeof courseOrId === "string"
        ? courseOrId
        : courseOrId?.course_id || courseOrId?.courseId;
    if (!courseId) return;
    // On a phone the details pane IS the assistant tab — bring it forward
    // instead of juggling column widths that don't exist here.
    if (compactRef.current) {
      setMobileView("assistant");
      setCourseOpenRequest({
        courseId,
        course: typeof courseOrId === "object" && courseOrId ? courseOrId : null,
        token: Date.now(),
      });
      return;
    }
    setRightMinimized(false);
    setExpandedPanel((current) => {
      // Details live in the search column — leave fullscreen main/requirements
      // and uncollapse chat-maximized so the details pane has room.
      if (
        current === "main" ||
        current === "requirements" ||
        current === "chat"
      ) {
        if (current === "requirements") {
          setLeftWidth(leftWidthBeforeExpandRef.current);
        }
        if (current === "chat") {
          setRightWidth(rightWidthBeforeExpandRef.current);
        }
        return null;
      }
      return current;
    });
    setCourseOpenRequest({
      courseId,
      course: typeof courseOrId === "object" && courseOrId ? courseOrId : null,
      token: Date.now(),
    });
  }, []);

  // Escape restores the three-column layout from a maximized panel
  useEffect(() => {
    if (!expandedPanel) return;
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      restoreExpandedWidths(expandedPanel);
      setExpandedPanel(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [expandedPanel, restoreExpandedWidths]);

  // Main expand is a Quarter View affordance — leave that page and restore columns
  useEffect(() => {
    if (currentPage !== "quarter" && expandedPanel === "main") {
      setExpandedPanel(null);
    }
  }, [currentPage, expandedPanel]);

  // Keep a maximized panel glued to the workspace edge on window resize
  useEffect(() => {
    if (!expandedPanel) return;
    const onResize = () => {
      const ws = workspaceWidth();
      if (expandedPanel === "requirements") setLeftWidth(ws);
      if (expandedPanel === "search" || expandedPanel === "chat") {
        setRightWidth(ws);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [expandedPanel, workspaceWidth]);

  // The planner stays mounted (hidden on other pages) so the schedule
  // isn't lost when switching tabs
  const renderPage = () => (
    <>
      <div
        className={
          currentPage === "storage" || currentPage === "quarter" || currentPage === "admin"
            ? "hidden"
            : ""
        }
      >
        <CoursePlannerContainer
          schedule={schedule}
          setSchedule={setSchedule}
          parsedCourseData={parsedCourseData}
          planWindow={planWindowValue}
          yearLabels={yearLabels}
          externalPlan={appliedPlan}
          restoredPlan={restoredPlan}
          activeSavedPlan={activeSavedPlan}
          onSavedPlanChange={handleSavedPlanChange}
          onLoadPlan={handleLoadSavedPlan}
          onChatCarryOver={handleChatCarryOver}
          onNavigate={setCurrentPage}
          onOpenCourse={handleOpenCourse}
          buildFreshSchedule={buildFreshSchedule}
          enrollmentSlot={enrollmentSlot}
          compact={isCompact}
          pendingPlacement={pendingPlacement}
          onQueuePlacement={handleQueuePlacement}
          onCancelPlacement={cancelPlacement}
        />
      </div>
      {currentPage === "storage" && (
        <CourseStorage
          schedule={schedule}
          activeSavedPlan={activeSavedPlan}
          onLoadPlan={handleLoadSavedPlan}
          onSavedPlanChange={handleSavedPlanChange}
          onSavedPlanDelete={handleSavedPlanDelete}
          onNavigate={setCurrentPage}
        />
      )}
      {currentPage === "admin" && <AdminSectionData />}
      {currentPage === "quarter" && (
        <QuarterlyView
          schedule={schedule}
          setSchedule={setSchedule}
          yearLabels={yearLabels}
          enrollmentSlot={enrollmentSlot}
          parsedCourseData={parsedCourseData}
          activeSavedPlan={activeSavedPlan}
          onSavedPlanChange={handleSavedPlanChange}
          onLoadPlan={handleLoadSavedPlan}
          onChatCarryOver={handleChatCarryOver}
          onNavigate={setCurrentPage}
          mainExpanded={expandedPanel === "main"}
          onToggleMainExpand={handleToggleMainExpand}
          onOpenCourse={handleOpenCourse}
          buildFreshSchedule={buildFreshSchedule}
          compact={isCompact}
          pendingPlacement={pendingPlacement}
          onCancelPlacement={cancelPlacement}
        />
      )}
    </>
  );

  // Which bottom tab reads as current. Storage / Admin are plan management,
  // so they keep the Plan tab lit rather than leaving nothing selected.
  const mobileTab =
    mobileView === "requirements"
      ? "progress"
      : mobileView === "assistant"
        ? "assistant"
        : currentPage === "quarter"
          ? "quarter"
          : "plan";

  const handleMobileTab = (tab) => {
    if (tab === "progress") {
      setMobileView("requirements");
      return;
    }
    if (tab === "assistant") {
      setMobileView("assistant");
      return;
    }
    setMobileView("main");
    setCurrentPage(tab === "quarter" ? "quarter" : "planner");
  };

  // On a phone exactly one column is on screen; the other two stay mounted
  // (hidden) so search results, a half-typed chat and the parsed audit all
  // survive tab switches.
  const leftPaneClass = isCompact
    ? mobileView === "requirements"
      ? "flex-1 min-w-0 h-full"
      : "hidden"
    : expandedPanel === "requirements"
      ? "flex-shrink-0 h-full min-w-0"
      : expandedPanel || leftMinimized
        ? "hidden"
        : "flex-shrink-0 h-full";

  const mainPaneClass = isCompact
    ? mobileView === "main"
      ? "flex-1 min-w-0 p-3 overflow-y-auto bg-slate-100"
      : "hidden"
    : expandedPanel && expandedPanel !== "main"
      ? "hidden"
      : "flex-grow min-w-0 p-6 overflow-y-auto bg-slate-100";

  const rightPaneClass = isCompact
    ? mobileView === "assistant"
      ? "flex-1 min-w-0 h-full"
      : "hidden"
    : expandedPanel === "search" || expandedPanel === "chat"
      ? "flex-shrink-0 h-full min-w-0 ml-auto"
      : expandedPanel || rightMinimized
        ? "hidden"
        : "flex-shrink-0 h-full";

  return (
    // 100dvh, not 100vh: mobile browser chrome otherwise pushes the tab bar
    // below the fold.
    <div className="flex flex-col h-[100dvh]">
      {/* Full-width app bar with brand + navigation */}
      <Header
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        syncStatus={syncStatus}
        isCompact={isCompact}
      />

      <div ref={workspaceRef} className="flex flex-1 overflow-hidden">
        {/* Thin restore rail when the left panel is tucked away */}
        {!isCompact && leftMinimized && !expandedPanel && (
          <button
            type="button"
            className="flex-shrink-0 w-9 h-full border-r border-slate-200 bg-white text-slate-400 hover:text-navy-600 hover:bg-slate-50 flex items-center justify-center transition-colors"
            onClick={() => setLeftMinimized(false)}
            title="Show graduation progress"
            aria-label="Show graduation progress"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}

        {/* Keep sidebars mounted when hidden so upload/chat/search state survives */}
        <div className={leftPaneClass}>
          <LeftSidebar
            auditData={parsedCourseData}
            schedule={schedule}
            onParsedDataUpdate={handleParsedDataUpdate}
            width={leftWidth}
            onWidthChange={handleLeftWidthChange}
            expanded={expandedPanel === "requirements"}
            onToggleExpand={isCompact ? undefined : handleToggleLeftExpand}
            onMinimize={isCompact ? undefined : () => setLeftMinimized(true)}
            compact={isCompact}
            onRequirementSearch={isCompact ? handleRequirementSearch : undefined}
          />
        </div>

        {/* Main content area — stays visible when expandedPanel is "main" */}
        <div className={mainPaneClass}>{renderPage()}</div>

        {/* Thin restore rail when the right panel is tucked away */}
        {!isCompact && rightMinimized && !expandedPanel && (
          <button
            type="button"
            className="flex-shrink-0 w-9 h-full border-l border-slate-200 bg-white text-slate-400 hover:text-navy-600 hover:bg-slate-50 flex items-center justify-center transition-colors"
            onClick={() => setRightMinimized(false)}
            title="Show course search & assistant"
            aria-label="Show course search and assistant"
          >
            <PanelRightOpen className="w-4 h-4" />
          </button>
        )}

        {/* Right sidebar with course search & assistant.
            ml-auto keeps it edge-anchored while full-bleed (other columns hidden). */}
        <div className={rightPaneClass}>
          <RightSidebar
            parsedCourseData={parsedCourseData}
            schedule={schedule}
            baseYear={planWindowValue.baseYear}
            planContextId={
              activeSavedPlan?.id ? `saved-${activeSavedPlan.id}` : "working-plan"
            }
            chatThreads={chatThreads}
            onChatThreadsChange={setChatThreads}
            onApplyPlan={handleApplyPlan}
            onApplySectionProposal={handleApplySectionProposal}
            width={rightWidth}
            onWidthChange={handleRightWidthChange}
            expandedPanel={
              expandedPanel === "search" || expandedPanel === "chat"
                ? expandedPanel
                : null
            }
            onExpandedPanelChange={handleExpandedPanelChange}
            layoutExpanded={
              expandedPanel === "search" || expandedPanel === "chat"
            }
            onMinimize={isCompact ? undefined : () => setRightMinimized(true)}
            courseOpenRequest={courseOpenRequest}
            currentPage={currentPage}
            compact={isCompact}
            requirementRequest={requirementRequest}
            onQueuePlacement={handleQueuePlacement}
          />
        </div>
      </div>

      {isCompact && (
        <MobileTabBar active={mobileTab} onSelect={handleMobileTab} />
      )}
    </div>
  );
};

export default MainLayout;
