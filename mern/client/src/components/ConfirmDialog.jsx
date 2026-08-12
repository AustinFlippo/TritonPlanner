import { useEffect, useRef } from "react";
import { X, Loader2 } from "lucide-react";

/**
 * ConfirmDialog — TritonPlanner-styled modal that replaces window.confirm / alert.
 *
 * variant:
 *   - "default" — navy primary confirm
 *   - "danger"  — red confirm (delete / destructive)
 *   - "alert"   — single dismiss button (replaces window.alert)
 */
const ConfirmDialog = ({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  variant = "default",
  busy = false,
}) => {
  const confirmRef = useRef(null);
  const isAlert = variant === "alert";

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onCancel?.();
    };
    window.addEventListener("keydown", onKey);
    // Focus the primary action once the dialog mounts
    const t = requestAnimationFrame(() => confirmRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(t);
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmClass =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700 text-white"
      : "bg-navy-700 hover:bg-navy-800 text-white";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md rounded-xl bg-white border border-slate-200 shadow-panel p-5"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2
            id="confirm-dialog-title"
            className="text-base font-semibold text-slate-800"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={() => !busy && onCancel?.()}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {message && (
          <p className="text-sm text-slate-600 mb-5 leading-relaxed whitespace-pre-wrap">
            {message}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          {!isAlert && (
            <button
              type="button"
              onClick={() => onCancel?.()}
              disabled={busy}
              className="px-3.5 py-1.5 text-sm font-medium rounded-lg text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40"
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onConfirm?.()}
            disabled={busy}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400 ${confirmClass}`}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
