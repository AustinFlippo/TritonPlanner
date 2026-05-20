import { useState, useRef } from "react";
import useSchedules from "../../hooks/useSchedules";

const ScheduleManager = ({ onLoad, onClose, currentScheduleId, onNewSchedule }) => {
  const { schedules, loading, renameSchedule, deleteSchedule } = useSchedules();
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const skipBlurRef = useRef(false);

  const handleLoad = (s) => {
    onLoad(s.id, s.name, s.schedule, s.auditData || null);
    onClose();
  };

  const handleRenameStart = (s) => {
    setRenamingId(s.id);
    setRenameValue(s.name);
  };

  const handleRenameSubmit = async (id, fromBlur = false) => {
    if (fromBlur && skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    if (renameValue.trim()) await renameSchedule(id, renameValue.trim());
    setRenamingId(null);
  };

  const handleDelete = async (id) => {
    if (confirmDeleteId === id) {
      await deleteSchedule(id);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl overflow-hidden"
        style={{ width: 480, maxHeight: "70vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ background: "#003366" }}
        >
          <span style={{ color: "white", fontWeight: 700, fontSize: "15px" }}>
            My Schedules
          </span>
          <button
            onClick={onClose}
            style={{ color: "#7db8e8", background: "none", border: "none", cursor: "pointer", fontSize: "20px", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 px-4 py-3">
          {loading && (
            <p style={{ color: "#64748b", fontSize: "13px" }}>Loading...</p>
          )}
          {!loading && schedules.length === 0 && (
            <p style={{ color: "#64748b", fontSize: "13px" }}>
              No saved schedules yet.
            </p>
          )}
          {schedules.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 py-2"
              style={{ borderBottom: "1px solid #e2e8f0" }}
            >
              {renamingId === s.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => handleRenameSubmit(s.id, true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      skipBlurRef.current = true;
                      handleRenameSubmit(s.id);
                    }
                    if (e.key === "Escape") {
                      skipBlurRef.current = true;
                      setRenamingId(null);
                    }
                  }}
                  style={{
                    flex: 1,
                    fontSize: "13px",
                    border: "1px solid #0066cc",
                    borderRadius: "3px",
                    padding: "2px 6px",
                  }}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    fontSize: "13px",
                    fontWeight: s.id === currentScheduleId ? 700 : 400,
                    color: "#1e293b",
                  }}
                >
                  {s.name}
                  {s.id === currentScheduleId && (
                    <span style={{ marginLeft: "6px", fontSize: "10px", color: "#0066cc", fontWeight: 600 }}>
                      CURRENT
                    </span>
                  )}
                </span>
              )}
              <button
                onClick={() => handleLoad(s)}
                style={{ fontSize: "11px", color: "white", background: "#003366", border: "none", borderRadius: "3px", padding: "3px 8px", cursor: "pointer" }}
              >
                Load
              </button>
              <button
                onClick={() => handleRenameStart(s)}
                style={{ fontSize: "11px", color: "#0066cc", background: "none", border: "1px solid #0066cc", borderRadius: "3px", padding: "3px 8px", cursor: "pointer" }}
              >
                Rename
              </button>
              <button
                onClick={() => handleDelete(s.id)}
                style={{
                  fontSize: "11px",
                  color: confirmDeleteId === s.id ? "white" : "#dc2626",
                  background: confirmDeleteId === s.id ? "#dc2626" : "none",
                  border: "1px solid #dc2626",
                  borderRadius: "3px",
                  padding: "3px 8px",
                  cursor: "pointer",
                }}
              >
                {confirmDeleteId === s.id ? "Confirm" : "Delete"}
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-3" style={{ borderTop: "1px solid #e2e8f0" }}>
          <button
            onClick={() => { onNewSchedule?.(); onClose(); }}
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "white",
              background: "#0066cc",
              border: "none",
              borderRadius: "4px",
              padding: "5px 12px",
              cursor: "pointer",
            }}
          >
            + New Schedule
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScheduleManager;
