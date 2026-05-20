import { useState } from "react";
import SignInButton from "./auth/SignInButton";
import ScheduleManager from "./schedules/ScheduleManager";
import useSchedules from "../hooks/useSchedules";
import { useAuth } from "../context/AuthContext";
import tritonLogo from "../assets/tritonplannerlogo.png";

const Header = ({
  currentScheduleName,
  setCurrentScheduleName,
  hasUnsavedChanges,
  schedule,
  parsedCourseData,
  currentScheduleId,
  setCurrentScheduleId,
  setSavedSchedule,
  onLoadSchedule,
  onNewSchedule,
}) => {
  const { currentUser } = useAuth();
  const { saveSchedule } = useSchedules();
  const [showManager, setShowManager] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!currentUser) return;
    setSaving(true);
    try {
      const auditToSave = parsedCourseData?.sections?.length ? parsedCourseData : null;
      const id = await saveSchedule(currentScheduleName, schedule, currentScheduleId, auditToSave);
      setCurrentScheduleId(id);
      setSavedSchedule(JSON.parse(JSON.stringify(schedule)));
    } catch (err) {
      console.error("Failed to save schedule:", err);
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
          <svg width="40" height="40" style={{ flexShrink: 0 }}>
            <defs>
              <filter id="triton-white-base" colorInterpolationFilters="sRGB">
                <feColorMatrix
                  type="matrix"
                  values="0 0 0 0 1
                          0 0 0 0 1
                          0 0 0 0 1
                          -2 -2 -2 0 5"
                />
              </filter>
              <filter id="triton-gold" colorInterpolationFilters="sRGB">
                <feColorMatrix
                  type="matrix"
                  values="0 0 0 0 1.0
                          0 0 0 0 1.0
                          0 0 0 0 0.0
                          3 0 -3 0 -0.3"
                />
              </filter>
            </defs>
            <image href={tritonLogo} width="40" height="40" filter="url(#triton-white-base)" preserveAspectRatio="xMidYMid meet" />
            <image href={tritonLogo} width="40" height="40" filter="url(#triton-gold)" preserveAspectRatio="xMidYMid meet" />
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
          onNewSchedule={onNewSchedule}
        />
      )}
    </>
  );
};

export default Header;
