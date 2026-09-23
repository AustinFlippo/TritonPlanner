import { useState, useRef, useEffect } from "react";
import {
  Bookmark,
  Check,
  ChevronDown,
  FilePlus2,
  FolderOpen,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import {
  createSavedPlan,
  listSavedPlans,
  updateSavedPlan,
  planStats,
  isPlanNotFound,
} from "../../utils/savedPlans";
import { keepTakenCourses } from "../../utils/scheduleOps";

const defaultPlanName = () => {
  const today = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `Plan (${today})`;
};

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const menuItemClass =
  "w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-slate-700 hover:bg-slate-50 transition-colors focus:outline-none focus-visible:bg-slate-50";

// Toolbar above the year blocks: shows WHICH plan is open and owns switching.
// Edits autosave onto the open named plan; this control switches between
// plans, names the current grid as a plan, or starts a blank one. Loading and
// flushing the outgoing plan happen in MainLayout (onLoadPlan).
const SavePlanControl = ({
  schedule,
  activeSavedPlan,
  onSavedPlanChange,
  onLoadPlan,
  onChatCarryOver,
  onResetSchedule,
  buildFreshSchedule,
  onNavigate,
}) => {
  const { user } = useAuth();

  const [menuOpen, setMenuOpen] = useState(false);
  const [plans, setPlans] = useState(null); // null = loading
  const [plansError, setPlansError] = useState(null);
  // null | "copy" (name the current grid) | "fresh" (start blank)
  const [dialogMode, setDialogMode] = useState(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState(null);
  const [error, setError] = useState(null);

  const confirmTimer = useRef(null);
  const nameInputRef = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  useEffect(() => {
    if (!dialogMode) return;
    const id = requestAnimationFrame(() => nameInputRef.current?.select());
    return () => cancelAnimationFrame(id);
  }, [dialogMode]);

  useEffect(() => {
    if (!dialogMode) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !saving) setDialogMode(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialogMode, saving]);

  // Close the plan menu on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Refresh the plan list each time the menu opens (cheap; always current)
  useEffect(() => {
    if (!menuOpen) return;
    let cancelled = false;
    setPlans(null);
    setPlansError(null);
    listSavedPlans(user)
      .then((data) => {
        if (!cancelled) setPlans(data);
      })
      .catch((err) => {
        console.error("Failed to list saved plans:", err);
        if (!cancelled) {
          setPlans([]);
          setPlansError("Couldn't load your plans.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [menuOpen, user]);

  const stats = planStats(schedule);

  const openDialog = (mode) => {
    setMenuOpen(false);
    setName(defaultPlanName());
    setSavedName(null);
    setError(null);
    setDialogMode(mode);
  };

  const flashSaved = (planName, verb = "Created") => {
    setSavedName({ name: planName, verb });
    clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setSavedName(null), 12000);
  };

  const handleSwitchPlan = (plan) => {
    setMenuOpen(false);
    if (plan.id === activeSavedPlan?.id) return;
    onLoadPlan?.(plan);
  };

  // Flush the open plan (if any) so its final edits are not lost to the switch.
  const flushActivePlan = async () => {
    if (!activeSavedPlan) return;
    try {
      await updateSavedPlan(user, activeSavedPlan.id, { schedule });
    } catch (err) {
      // Session restore can remember a named-plan id whose snapshot was
      // never in this device's library (signed-out local list, or a
      // leftover pointer from another localhost tab). Don't block create.
      if (!isPlanNotFound(err)) throw err;
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await flushActivePlan();
      if (dialogMode === "copy") {
        // Name the grid as it stands — nothing on screen changes. The
        // conversation belongs to this work, so it follows the new plan.
        const plan = await createSavedPlan(user, name, schedule);
        onChatCarryOver?.(plan.id);
        onSavedPlanChange?.({ id: plan.id, name: plan.name });
        setDialogMode(null);
        flashSaved(plan.name, "Saved");
      } else {
        // Start over: fresh grid keeping completed / in-progress courses
        // from the degree audit.
        const fresh =
          typeof buildFreshSchedule === "function"
            ? buildFreshSchedule()
            : keepTakenCourses(schedule);
        const plan = await createSavedPlan(user, name, fresh);
        // Switch active plan before clearing the grid so a debounced autosave
        // cannot write the empty schedule onto the plan we just finished.
        onSavedPlanChange?.({ id: plan.id, name: plan.name });
        onResetSchedule?.(fresh);
        setDialogMode(null);
        flashSaved(plan.name, "Created");
      }
    } catch (err) {
      console.error("Failed to create plan:", err);
      setError(err.message || "Couldn't create the plan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 min-h-[38px]">
        <div className="flex items-center gap-3 min-w-0">
          {/* Plan switcher — always shows which plan is being edited */}
          <div ref={menuRef} className="relative flex-shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Switch plans, save this plan, or start a new one"
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-slate-200 text-slate-700 shadow-card hover:border-navy-300 hover:text-navy-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
            >
              <Bookmark size={14} className="text-navy-500 flex-shrink-0" />
              <span className="max-w-[150px] sm:max-w-[220px] truncate">
                {activeSavedPlan ? activeSavedPlan.name : "Untitled plan"}
              </span>
              <ChevronDown
                size={14}
                className={`text-slate-400 transition-transform ${
                  menuOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute left-0 top-full mt-1.5 w-72 z-40 rounded-xl bg-white border border-slate-200 shadow-panel py-1.5 overflow-hidden"
              >
                <p className="px-3 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Your plans
                </p>
                <div className="max-h-56 overflow-y-auto">
                  {plans === null ? (
                    <div className="px-3 py-2.5 flex items-center gap-2 text-sm text-slate-400">
                      <Loader2 size={14} className="animate-spin" /> Loading…
                    </div>
                  ) : plans.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-slate-400">
                      {plansError || "No saved plans yet."}
                    </p>
                  ) : (
                    plans.map((plan) => {
                      const isActive = plan.id === activeSavedPlan?.id;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          role="menuitem"
                          onClick={() => handleSwitchPlan(plan)}
                          className={`${menuItemClass} ${
                            isActive ? "bg-navy-50/60" : ""
                          }`}
                        >
                          <span className="w-4 flex-shrink-0">
                            {isActive && (
                              <Check size={14} className="text-navy-600" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-slate-700">
                              {plan.name}
                            </span>
                            <span className="block text-[11px] text-slate-400">
                              {isActive
                                ? "Currently open"
                                : `Updated ${formatDate(plan.updatedAt)}`}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="my-1 border-t border-slate-100" />

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openDialog("copy")}
                  disabled={stats.courses === 0}
                  className={`${menuItemClass} disabled:opacity-40 disabled:pointer-events-none`}
                >
                  <Plus size={14} className="text-navy-500 flex-shrink-0" />
                  {activeSavedPlan
                    ? "Save a copy as new plan…"
                    : "Save this plan as…"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openDialog("fresh")}
                  className={menuItemClass}
                >
                  <FilePlus2 size={14} className="text-navy-500 flex-shrink-0" />
                  Start a blank plan…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onNavigate?.("storage");
                  }}
                  className={menuItemClass}
                >
                  <FolderOpen size={14} className="text-navy-500 flex-shrink-0" />
                  Manage plans…
                </button>
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500 truncate">
            {stats.courses} courses · {stats.units} units planned
            {!activeSavedPlan && stats.courses > 0 && (
              // Hidden rather than truncated on a phone: "· a…" tells the
              // student nothing, and the switcher above already offers naming.
              <span className="hidden lg:inline text-slate-400">
                {" "}
                · autosaved — name it to keep it in your plan library
              </span>
            )}
          </p>
        </div>

        {savedName && (
          <p className="flex items-center gap-1.5 text-sm text-slate-600 flex-shrink-0 min-w-0">
            <Check size={15} className="text-emerald-600" />
            {savedName.verb} “{savedName.name}”
            <button
              onClick={() => onNavigate?.("storage")}
              className="ml-1 text-navy-600 font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 rounded"
            >
              View in Saved Plans
            </button>
          </p>
        )}
      </div>

      {error && !dialogMode && (
        <p className="mt-2 text-right text-xs text-red-600">{error}</p>
      )}

      {dialogMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) setDialogMode(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-plan-title"
            className="w-full max-w-md rounded-xl bg-white border border-slate-200 shadow-panel p-5"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <h2
                id="create-plan-title"
                className="text-base font-semibold text-slate-800"
              >
                {dialogMode === "copy"
                  ? activeSavedPlan
                    ? "Save a copy as a new plan"
                    : "Save this plan"
                  : "Start a blank plan"}
              </h2>
              <button
                type="button"
                onClick={() => !saving && setDialogMode(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-sm text-slate-600 mb-4 leading-relaxed">
              {dialogMode === "copy"
                ? activeSavedPlan
                  ? `The current schedule will be saved as a separate plan with the name below, and you'll continue editing the copy. “${activeSavedPlan.name}” keeps its own version.`
                  : "Your current schedule will be saved under the name below and keep autosaving as you edit."
                : activeSavedPlan
                  ? `“${activeSavedPlan.name}” is already saved. You'll start a fresh plan with the name below — completed and in-progress courses from your degree audit stay on the grid.`
                  : "Start a fresh plan with the name below — completed and in-progress courses from your degree audit stay on the grid."}
            </p>

            <form onSubmit={handleCreate} className="space-y-4">
              <label className="block">
                <span className="block text-xs font-medium text-slate-500 mb-1.5">
                  Plan name
                </span>
                <input
                  ref={nameInputRef}
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  placeholder="Name this plan"
                  disabled={saving}
                  className="w-full px-3 py-2 text-base lg:text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-400 disabled:opacity-60"
                />
              </label>

              {error && <p className="text-xs text-red-600">{error}</p>}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDialogMode(null)}
                  disabled={saving}
                  className="px-3.5 py-1.5 text-sm font-medium rounded-lg text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!name.trim() || saving}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-lg bg-navy-700 text-white hover:bg-navy-800 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  {saving ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  {dialogMode === "copy" ? "Save plan" : "Create plan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SavePlanControl;
