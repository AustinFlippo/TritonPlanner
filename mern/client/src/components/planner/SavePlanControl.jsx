import { useState, useRef, useEffect } from "react";
import { Bookmark, Check, Loader2, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { createSavedPlan, planStats } from "../../utils/savedPlans";

// Toolbar above the year blocks: names the current grid and files it away as a
// snapshot on the Storage page.
const SavePlanControl = ({ schedule, onNavigate }) => {
  const { user } = useAuth();

  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState(null);
  const [error, setError] = useState(null);

  const confirmTimer = useRef(null);
  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  const stats = planStats(schedule);
  const canSave = stats.courses > 0;

  const open = () => {
    const today = new Date().toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    setName(`Plan (${today})`);
    setSavedName(null);
    setError(null);
    setNaming(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const plan = await createSavedPlan(user, name, schedule);
      setNaming(false);
      setSavedName(plan.name);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setSavedName(null), 12000);
    } catch (err) {
      console.error("Failed to save plan:", err);
      setError(err.message || "Couldn't save this plan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-3 min-h-[38px]">
        <p className="text-xs text-slate-500">
          {stats.courses} courses · {stats.units} units planned
        </p>

        {naming ? (
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Name this plan"
              onKeyDown={(e) => {
                if (e.key === "Escape") setNaming(false);
              }}
              className="w-56 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-400"
            />
            <button
              type="submit"
              disabled={!name.trim() || saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-navy-700 text-white hover:bg-navy-800 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              Save
            </button>
            <button
              type="button"
              onClick={() => setNaming(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/70 transition-colors"
              aria-label="Cancel"
            >
              <X size={16} />
            </button>
          </form>
        ) : savedName ? (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <Check size={15} className="text-emerald-600" />
            Saved “{savedName}”
            <button
              onClick={() => onNavigate?.("storage")}
              className="text-navy-600 font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 rounded"
            >
              View in Storage
            </button>
          </p>
        ) : (
          <button
            onClick={open}
            disabled={!canSave}
            title={
              canSave
                ? "Save this schedule as a named plan"
                : "Add courses to your plan first"
            }
            className="flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-lg bg-white border border-slate-200 text-slate-700 shadow-card hover:border-navy-300 hover:text-navy-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Bookmark size={15} className="text-navy-500" />
            Save plan
          </button>
        )}
      </div>

      {error && (
        <p className="mt-2 text-right text-xs text-red-600">{error}</p>
      )}
    </div>
  );
};

export default SavePlanControl;
