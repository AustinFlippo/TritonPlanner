import { useState, useRef, useEffect } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import {
  createSavedPlan,
  updateSavedPlan,
  planStats,
} from "../../utils/savedPlans";
import { keepTakenCourses } from "../../utils/scheduleOps";

const defaultPlanName = () => {
  const today = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `Plan (${today})`;
};

// Toolbar above the year blocks. Edits autosave onto the open named plan;
// this control only starts a fresh plan.
const SavePlanControl = ({
  schedule,
  activeSavedPlan,
  onSavedPlanChange,
  onResetSchedule,
  buildFreshSchedule,
  onNavigate,
}) => {
  const { user } = useAuth();

  const [creatingNew, setCreatingNew] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState(null);
  const [error, setError] = useState(null);

  const confirmTimer = useRef(null);
  const nameInputRef = useRef(null);
  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  useEffect(() => {
    if (!creatingNew) return;
    const id = requestAnimationFrame(() => nameInputRef.current?.select());
    return () => cancelAnimationFrame(id);
  }, [creatingNew]);

  useEffect(() => {
    if (!creatingNew) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !saving) setCreatingNew(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [creatingNew, saving]);

  const stats = planStats(schedule);

  const openCreateNew = () => {
    setName(defaultPlanName());
    setSavedName(null);
    setError(null);
    setCreatingNew(true);
  };

  const flashSaved = (planName) => {
    setSavedName(planName);
    clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setSavedName(null), 12000);
  };

  // Flush the open plan (if any), then start a blank schedule under the new name
  // — keeping completed / in-progress courses from the degree audit.
  const handleCreateNew = async (e) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (activeSavedPlan) {
        await updateSavedPlan(user, activeSavedPlan.id, { schedule });
      }
      const fresh =
        typeof buildFreshSchedule === "function"
          ? buildFreshSchedule()
          : keepTakenCourses(schedule);
      const plan = await createSavedPlan(user, name, fresh);
      // Switch active plan before clearing the grid so a debounced autosave
      // cannot write the empty schedule onto the plan we just finished.
      onSavedPlanChange?.({ id: plan.id, name: plan.name });
      onResetSchedule?.(fresh);
      setCreatingNew(false);
      flashSaved(plan.name);
    } catch (err) {
      console.error("Failed to create new plan:", err);
      setError(err.message || "Couldn't create a new plan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-3 min-h-[38px]">
        <p className="text-xs text-slate-500">
          {activeSavedPlan ? `Editing “${activeSavedPlan.name}” · ` : ""}
          {stats.courses} courses · {stats.units} units planned
        </p>

        <div className="flex items-center gap-3">
          {savedName && (
            <p className="flex items-center gap-1.5 text-sm text-slate-600">
              <Check size={15} className="text-emerald-600" />
              Created “{savedName}”
              <button
                onClick={() => onNavigate?.("storage")}
                className="ml-1 text-navy-600 font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 rounded"
              >
                View in Saved Plans
              </button>
            </p>
          )}
          <button
            type="button"
            onClick={openCreateNew}
            disabled={saving}
            title={
              activeSavedPlan
                ? "Start a fresh plan (completed courses stay; current plan stays saved)"
                : "Start a new named plan (completed courses stay)"
            }
            className="flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-lg bg-white border border-slate-200 text-slate-700 shadow-card hover:border-navy-300 hover:text-navy-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Plus size={15} className="text-navy-500" />
            Create new plan
          </button>
        </div>
      </div>

      {error && !creatingNew && (
        <p className="mt-2 text-right text-xs text-red-600">{error}</p>
      )}

      {creatingNew && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) setCreatingNew(false);
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
                Create a new plan
              </h2>
              <button
                type="button"
                onClick={() => !saving && setCreatingNew(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-sm text-slate-600 mb-4 leading-relaxed">
              {activeSavedPlan
                ? `“${activeSavedPlan.name}” is already saved. You’ll start a fresh plan with the name below — completed and in-progress courses from your degree audit stay on the grid.`
                : "Start a fresh plan with the name below — completed and in-progress courses from your degree audit stay on the grid."}
            </p>

            <form onSubmit={handleCreateNew} className="space-y-4">
              <label className="block">
                <span className="block text-xs font-medium text-slate-500 mb-1.5">
                  New plan name
                </span>
                <input
                  ref={nameInputRef}
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  placeholder="Name this plan"
                  disabled={saving}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-400 disabled:opacity-60"
                />
              </label>

              {error && <p className="text-xs text-red-600">{error}</p>}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCreatingNew(false)}
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
                  Create plan
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
