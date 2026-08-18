import { useState, useEffect, useCallback, useRef } from "react";
import { Bookmark, Pencil, Trash2, Upload, Loader2, Check, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  listSavedPlans,
  updateSavedPlan,
  deleteSavedPlan,
  deleteSavedPlans,
  planStats,
} from "../utils/savedPlans";
import ConfirmDialog from "./ConfirmDialog";

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const iconButtonClass =
  "p-1.5 rounded-lg text-slate-400 hover:text-navy-600 hover:bg-navy-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 disabled:opacity-40 disabled:pointer-events-none";

const checkboxClass =
  "h-4 w-4 shrink-0 rounded border-slate-300 accent-navy-600 cursor-pointer disabled:opacity-40";

const CourseStorage = ({
  schedule = [],
  activeSavedPlan,
  onLoadPlan,
  onSavedPlanChange,
  onSavedPlanDelete,
  onNavigate,
}) => {
  const { user } = useAuth();

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Inline rename
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  // Id of the plan currently being written to / deleted, or "bulk"
  const [busyId, setBusyId] = useState(null);

  // Selected snapshot ids for bulk delete
  const [selected, setSelected] = useState(() => new Set());
  const selectAllRef = useRef(null);

  // Custom confirm dialog (replaces window.confirm)
  // { type: "delete" | "delete-many" | "overwrite", plan?, plans? }
  const [confirm, setConfirm] = useState(null);

  const current = planStats(schedule);
  const canSave = current.courses > 0;
  const selectedCount = selected.size;
  const allSelected = plans.length > 0 && selectedCount === plans.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const bulkBusy = busyId === "bulk";

  const refresh = useCallback(() => {
    setLoading(true);
    listSavedPlans(user)
      .then((data) => {
        setPlans(data);
        setError(null);
      })
      .catch((err) => {
        console.error("Failed to load saved plans:", err);
        setError("Couldn't load your saved plans.");
      })
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(refresh, [refresh]);

  // Drop selection for snapshots that disappeared (deleted, signed-in swap).
  useEffect(() => {
    const live = new Set(plans.map((p) => p.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [plans]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(plans.map((p) => p.id)));
  };

  const handleRename = async (id) => {
    if (!renameValue.trim()) return;
    setBusyId(id);
    try {
      const plan = await updateSavedPlan(user, id, { name: renameValue });
      setPlans((prev) => prev.map((p) => (p.id === id ? plan : p)));
      if (activeSavedPlan?.id === id) {
        onSavedPlanChange?.({ id: plan.id, name: plan.name });
      }
      setRenamingId(null);
      setError(null);
    } catch (err) {
      console.error("Failed to rename plan:", err);
      setError(err.message || "Couldn't rename this plan.");
    } finally {
      setBusyId(null);
    }
  };

  const runOverwrite = async (plan) => {
    setBusyId(plan.id);
    try {
      const updated = await updateSavedPlan(user, plan.id, { schedule });
      setPlans((prev) =>
        [updated, ...prev.filter((p) => p.id !== plan.id)]
      );
      if (activeSavedPlan?.id === plan.id) {
        onSavedPlanChange?.({ id: updated.id, name: updated.name });
      }
      setError(null);
      setConfirm(null);
    } catch (err) {
      console.error("Failed to update plan:", err);
      setError(err.message || "Couldn't update this plan.");
      setConfirm(null);
    } finally {
      setBusyId(null);
    }
  };

  const runDelete = async (plan) => {
    setBusyId(plan.id);
    try {
      await deleteSavedPlan(user, plan.id);
      setPlans((prev) => prev.filter((p) => p.id !== plan.id));
      onSavedPlanDelete?.(plan.id);
      setError(null);
      setConfirm(null);
    } catch (err) {
      console.error("Failed to delete plan:", err);
      setError(err.message || "Couldn't delete this plan.");
      setConfirm(null);
    } finally {
      setBusyId(null);
    }
  };

  const runDeleteMany = async (toDelete) => {
    const ids = toDelete.map((p) => p.id);
    setBusyId("bulk");
    try {
      await deleteSavedPlans(user, ids);
      const gone = new Set(ids);
      setPlans((prev) => prev.filter((p) => !gone.has(p.id)));
      onSavedPlanDelete?.(ids);
      setSelected(new Set());
      setError(null);
      setConfirm(null);
    } catch (err) {
      console.error("Failed to delete plans:", err);
      setError(err.message || "Couldn't delete the selected plans.");
      setConfirm(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirm = () => {
    if (!confirm) return;
    if (confirm.type === "overwrite") runOverwrite(confirm.plan);
    else if (confirm.type === "delete") runDelete(confirm.plan);
    else if (confirm.type === "delete-many") runDeleteMany(confirm.plans);
  };

  const confirmBusy =
    Boolean(confirm?.type === "overwrite" && busyId === confirm.plan.id) ||
    Boolean(confirm?.type === "delete" && busyId === confirm.plan.id) ||
    Boolean(confirm?.type === "delete-many" && bulkBusy);

  const confirmIsDelete =
    confirm?.type === "delete" || confirm?.type === "delete-many";

  return (
    <div className="max-w-5xl mx-auto">
      {/* Page heading */}
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-800">Saved Plans</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          {user
            ? "Snapshots you've saved from the planner."
            : "Snapshots you've saved from the planner, kept on this device. Sign in to keep them across devices."}
        </p>
      </div>

      {error && (
        <div className="mb-3 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-card px-6 py-12 flex items-center justify-center text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : plans.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-card px-6 py-12 text-center">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-navy-50 mb-3">
            <Bookmark className="w-5 h-5 text-navy-500" />
          </span>
          <h3 className="text-base font-semibold text-slate-800 mb-1">
            No saved plans yet
          </h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            {canSave
              ? "Use “Save plan” at the top of the planner to keep a snapshot of your schedule and come back to it later."
              : "Build a schedule in the planner, then use “Save plan” to keep a snapshot of it here."}
          </p>
          <button
            onClick={() => onNavigate?.("planner")}
            className="mt-4 px-3.5 py-2 text-sm font-medium rounded-lg border border-navy-200 text-navy-700 hover:bg-navy-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400"
          >
            Go to the planner
          </button>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-3 px-1 min-h-[36px]">
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                disabled={bulkBusy}
                className={checkboxClass}
                aria-label="Select all plans"
              />
              {selectedCount === 0
                ? "Select"
                : `${selectedCount} selected`}
            </label>
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setConfirm({
                    type: "delete-many",
                    plans: plans.filter((p) => selected.has(p.id)),
                  })
                }
                disabled={bulkBusy}
                className="ml-auto px-3 py-1.5 text-sm font-medium rounded-lg text-red-700 hover:bg-red-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-40 disabled:pointer-events-none"
              >
                Delete selected
              </button>
            )}
          </div>
          <ul className="space-y-2">
            {plans.map((plan) => {
              const stats = planStats(plan.schedule);
              const busy = busyId === plan.id || bulkBusy;
              const isRenaming = renamingId === plan.id;
              const isChecked = selected.has(plan.id);

              return (
                <li
                  key={plan.id}
                  className={`bg-white border rounded-xl shadow-card px-4 py-3 flex items-center gap-3 ${
                    isChecked
                      ? "border-navy-300 bg-navy-50/50"
                      : "border-slate-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSelected(plan.id)}
                    disabled={bulkBusy}
                    className={checkboxClass}
                    aria-label={`Select ${plan.name}`}
                  />
                  <span className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-navy-50">
                    <Bookmark className="w-4 h-4 text-navy-500" />
                  </span>

                  <div className="min-w-0 flex-1">
                    {isRenaming ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleRename(plan.id);
                        }}
                        className="flex items-center gap-2"
                      >
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          maxLength={80}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          className="flex-1 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-400"
                        />
                        <button
                          type="submit"
                          disabled={busy || !renameValue.trim()}
                          className={iconButtonClass}
                          aria-label="Save name"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          className={iconButtonClass}
                          aria-label="Cancel rename"
                        >
                          <X size={16} />
                        </button>
                      </form>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {plan.name}
                        </p>
                        {/* Courses whose units the catalog never published are
                            named, not folded into the total as zero. */}
                        <p className="text-xs text-slate-500 mt-0.5">
                          {stats.courses} courses · {stats.units} units
                          {stats.unknownUnits > 0 && (
                            <span
                              className="text-amber-600"
                              title={`${stats.unknownUnits} course${
                                stats.unknownUnits === 1 ? "" : "s"
                              } in this plan have no published unit count, so they are not included in the total.`}
                            >
                              {" "}
                              + {stats.unknownUnits} unknown
                            </span>
                          )}{" "}
                          · saved {formatDate(plan.updatedAt)}
                        </p>
                      </>
                    )}
                  </div>

                  {!isRenaming && (
                    <div className="flex-shrink-0 flex items-center gap-1">
                      <button
                        onClick={() => onLoadPlan?.(plan)}
                        disabled={busy}
                        className="px-3 py-1.5 text-sm font-medium rounded-lg border border-navy-200 text-navy-700 hover:bg-navy-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 disabled:opacity-40 disabled:pointer-events-none"
                      >
                        Load
                      </button>
                      <button
                        onClick={() =>
                          canSave && setConfirm({ type: "overwrite", plan })
                        }
                        disabled={busy || !canSave}
                        className={iconButtonClass}
                        title="Replace with the current planner schedule"
                        aria-label="Replace with current schedule"
                      >
                        {busy && busyId === plan.id ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Upload size={16} />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setRenameValue(plan.name);
                          setRenamingId(plan.id);
                        }}
                        disabled={busy}
                        className={iconButtonClass}
                        title="Rename"
                        aria-label="Rename plan"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => setConfirm({ type: "delete", plan })}
                        disabled={busy}
                        className={`${iconButtonClass} hover:text-red-600 hover:bg-red-50`}
                        title="Delete"
                        aria-label="Delete plan"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        variant={confirmIsDelete ? "danger" : "default"}
        title={
          confirm?.type === "delete"
            ? "Delete this plan?"
            : confirm?.type === "delete-many"
              ? `Delete ${confirm.plans.length} plan${
                  confirm.plans.length === 1 ? "" : "s"
                }?`
              : "Replace this plan?"
        }
        message={
          confirm?.type === "delete"
            ? `“${confirm.plan.name}” will be permanently removed. This can’t be undone.`
            : confirm?.type === "delete-many"
              ? `${confirm.plans.length} selected plan${
                  confirm.plans.length === 1 ? "" : "s"
                } will be permanently removed. This can’t be undone.`
              : confirm
                ? `Replace “${confirm.plan.name}” with the schedule currently in the planner? The previous snapshot will be lost.`
                : ""
        }
        confirmLabel={
          confirm?.type === "delete"
            ? "Delete plan"
            : confirm?.type === "delete-many"
              ? "Delete plans"
              : "Replace plan"
        }
        cancelLabel="Cancel"
        busy={confirmBusy}
        onConfirm={handleConfirm}
        onCancel={() => {
          if (!confirmBusy) setConfirm(null);
        }}
      />
    </div>
  );
};

export default CourseStorage;
