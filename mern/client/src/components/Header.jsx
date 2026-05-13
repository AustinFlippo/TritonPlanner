import { useState } from "react";
import SignInButton from "./auth/SignInButton";
import ScheduleManager from "./schedules/ScheduleManager";
import useSchedules from "../hooks/useSchedules";
import { useAuth } from "../context/AuthContext";

const Header = ({
  currentScheduleName,
  setCurrentScheduleName,
  hasUnsavedChanges,
  schedule,
  currentScheduleId,
  setCurrentScheduleId,
  setSavedSchedule,
  onLoadSchedule,
}) => {
  const { currentUser } = useAuth();
  const { saveSchedule } = useSchedules();
  const [showManager, setShowManager] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!currentUser) return;
    setSaving(true);
    try {
      const id = await saveSchedule(currentScheduleName, schedule, currentScheduleId);
      setCurrentScheduleId(id);
      setSavedSchedule(schedule);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header
        className="flex items-center justify-between px-4 flex-shrink-0"
        style={{ height: "44px", background: "#003366" }}
      >
        {/* Left: logo + brand name */}
        <div className="flex items-center gap-3">
          <svg width="22" height="28" viewBox="0 0 22 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <polygon points="11,0 8.5,5.5 13.5,5.5" fill="white"/>
            <polygon points="2.5,3.5 0,9 5,9" fill="#7db8e8" opacity="0.85"/>
            <polygon points="19.5,3.5 17,9 22,9" fill="#7db8e8" opacity="0.85"/>
            <rect x="9" y="4" width="4" height="21" rx="2" fill="white"/>
            <rect x="0.5" y="7" width="3.5" height="15" rx="1.75" fill="#7db8e8"/>
            <rect x="18" y="7" width="3.5" height="15" rx="1.75" fill="#7db8e8"/>
            <rect x="0.5" y="8.5" width="21" height="2.5" rx="1.25" fill="#7db8e8" opacity="0.6"/>
            <rect x="9" y="25" width="4" height="3" rx="1" fill="#7db8e8" opacity="0.5"/>
          </svg>
          <div>
            <span style={{ color: "white", fontSize: "17px", fontWeight: 800, letterSpacing: "-0.3px" }}>Triton</span>
            <span style={{ color: "white", fontSize: "17px", fontWeight: 300, letterSpacing: "-0.3px" }}>Planner</span>
          </div>
        </div>

        {/* Center: schedule name + save controls (only when signed in) */}
        {currentUser && (
          <div className="flex items-center gap-2">
            <input
              value={currentScheduleName}
              onChange={(e) => setCurrentScheduleName(e.target.value)}
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "white",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "4px",
                padding: "3px 8px",
                width: "160px",
              }}
            />
            <button
              onClick={handleSave}
              disabled={saving || !hasUnsavedChanges}
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: hasUnsavedChanges ? "white" : "#7db8e8",
                background: hasUnsavedChanges ? "#0066cc" : "rgba(255,255,255,0.1)",
                border: "none",
                borderRadius: "4px",
                padding: "4px 12px",
                cursor: hasUnsavedChanges ? "pointer" : "default",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving…" : hasUnsavedChanges ? "Save" : "Saved"}
            </button>
            <button
              onClick={() => setShowManager(true)}
              style={{
                fontSize: "11px",
                color: "#7db8e8",
                background: "none",
                border: "1px solid rgba(125,184,232,0.4)",
                borderRadius: "4px",
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              My Schedules
            </button>
          </div>
        )}

        {/* Right: sign in / profile */}
        <SignInButton />
      </header>

      {showManager && (
        <ScheduleManager
          onLoad={onLoadSchedule}
          onClose={() => setShowManager(false)}
          currentScheduleId={currentScheduleId}
        />
      )}
    </>
  );
};

export default Header;
