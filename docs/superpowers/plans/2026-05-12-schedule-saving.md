# Schedule Saving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow authenticated users to save, load, rename, and delete multiple named course schedules using Google OAuth and Firebase Firestore.

**Architecture:** Firebase Auth handles Google OAuth entirely on the client; Firestore stores schedule documents under `users/{userId}/schedules/{scheduleId}`. React context provides auth state app-wide. Schedule state is lifted to MainLayout so Header and ScheduleManager can read/write it. Express is untouched.

**Tech Stack:** Firebase 10 (Auth + Firestore client SDK), React context, Tailwind CSS

---

## Prerequisites (do before Task 1)

Set up a Firebase project:
1. Go to https://console.firebase.google.com → Create project
2. **Authentication** → Sign-in method → Google → Enable
3. **Firestore Database** → Create database → Start in **production mode**
4. Project Settings → Your apps → Add web app → copy the config object
5. You will need: `apiKey`, `authDomain`, `projectId`, `appId`

---

## File Map

**Create:**
- `mern/client/src/firebase.js` — Firebase app init, exports `auth` and `db`
- `mern/client/src/context/AuthContext.jsx` — Google OAuth state provider + `useAuth` hook
- `mern/client/src/hooks/useSchedules.js` — Firestore schedule CRUD
- `mern/client/src/components/auth/SignInButton.jsx` — Google sign-in/out button with profile photo
- `mern/client/src/components/schedules/ScheduleManager.jsx` — Modal to list/load/rename/delete schedules
- `firestore.rules` — Security rules (at repo root)

**Modify:**
- `mern/client/.env.example` — add Firebase env var keys
- `mern/client/src/main.jsx` — wrap app in `AuthProvider`
- `mern/client/src/components/Header.jsx` — add schedule name, save, my schedules, sign-in
- `mern/client/src/components/MainLayout.jsx` — own schedule state, thread save/load callbacks
- `mern/client/src/components/planner/CoursePlannerContainer.jsx` — accept `schedule`/`setSchedule` as props

---

### Task 1: Install Firebase and create firebase.js

**Files:**
- Modify: `mern/client/package.json` (via npm install)
- Create: `mern/client/src/firebase.js`
- Modify: `mern/client/.env.example`

- [ ] **Step 1: Install Firebase SDK**

Run from `mern/client/`:
```bash
npm install firebase
```
Expected: `firebase` appears in `package.json` dependencies, no errors.

- [ ] **Step 2: Add env var placeholders to .env.example**

In `mern/client/.env.example`, append:
```
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=your-app-id
```

- [ ] **Step 3: Create your local .env file**

Copy `.env.example` to `mern/client/.env` and fill in the real Firebase values from the Firebase console (Project Settings → Your apps → Config object).

- [ ] **Step 4: Create firebase.js**

Create `mern/client/src/firebase.js`:
```js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
```

- [ ] **Step 5: Verify no import errors**

Run `npm run dev` from `mern/client/`. Expected: dev server starts, no console errors about Firebase config.

- [ ] **Step 6: Commit**

```bash
git add mern/client/src/firebase.js mern/client/.env.example mern/client/package.json mern/client/package-lock.json
git commit -m "feat: add Firebase SDK and config"
```

---

### Task 2: AuthContext — Google OAuth state provider

**Files:**
- Create: `mern/client/src/context/AuthContext.jsx`
- Modify: `mern/client/src/main.jsx`

- [ ] **Step 1: Create AuthContext.jsx**

Create `mern/client/src/context/AuthContext.jsx`:
```jsx
import { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
} from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  // undefined = still loading, null = logged out, object = logged in
  const [currentUser, setCurrentUser] = useState(undefined);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          await setDoc(userRef, {
            email: user.email,
            name: user.displayName,
            photoURL: user.photoURL,
          });
        }
      }
      setCurrentUser(user ?? null);
    });
    return unsubscribe;
  }, []);

  const signInWithGoogle = () => {
    const provider = new GoogleAuthProvider();
    return signInWithPopup(auth, provider);
  };

  const signOutUser = () => signOut(auth);

  return (
    <AuthContext.Provider value={{ currentUser, signInWithGoogle, signOutUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
```

- [ ] **Step 2: Wrap app in AuthProvider in main.jsx**

Replace `mern/client/src/main.jsx` with:
```jsx
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import App from "./App";
import "./index.css";

const router = createBrowserRouter([
  { path: "/", element: <App /> },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);
```

- [ ] **Step 3: Verify app loads normally**

Open `http://localhost:5173`. Expected: app loads with no console errors. Auth state is loading briefly then resolves to null (logged out).

- [ ] **Step 4: Commit**

```bash
git add mern/client/src/context/AuthContext.jsx mern/client/src/main.jsx
git commit -m "feat: add AuthContext with Google OAuth"
```

---

### Task 3: SignInButton component

**Files:**
- Create: `mern/client/src/components/auth/SignInButton.jsx`

- [ ] **Step 1: Create SignInButton.jsx**

Create `mern/client/src/components/auth/SignInButton.jsx`:
```jsx
import { useAuth } from "../../context/AuthContext";

const SignInButton = () => {
  const { currentUser, signInWithGoogle, signOutUser } = useAuth();

  if (currentUser === undefined) return null;

  if (currentUser) {
    return (
      <div className="flex items-center gap-2">
        {currentUser.photoURL && (
          <img
            src={currentUser.photoURL}
            alt={currentUser.displayName}
            className="w-7 h-7 rounded-full"
          />
        )}
        <span style={{ color: "white", fontSize: "12px" }}>
          {currentUser.displayName}
        </span>
        <button
          onClick={signOutUser}
          style={{
            fontSize: "11px",
            color: "#7db8e8",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0 4px",
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={signInWithGoogle}
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
      Sign in with Google
    </button>
  );
};

export default SignInButton;
```

- [ ] **Step 2: Commit**

```bash
git add mern/client/src/components/auth/SignInButton.jsx
git commit -m "feat: add SignInButton with Google OAuth"
```

---

### Task 4: Lift schedule state to MainLayout

The schedule state currently lives in `CoursePlannerContainer`. It needs to live in `MainLayout` so the Header and ScheduleManager can read and write it.

**Files:**
- Modify: `mern/client/src/components/MainLayout.jsx`
- Modify: `mern/client/src/components/planner/CoursePlannerContainer.jsx`

- [ ] **Step 1: Replace MainLayout.jsx**

Replace `mern/client/src/components/MainLayout.jsx` with:
```jsx
import React, { useState } from "react";
import RightSidebar from "./right-sidebar/RightSidebar";
import LeftSidebar from "./LeftSidebar";
import CoursePlannerContainer from "./planner/CoursePlannerContainer";
import CourseStorage from "./CourseStorage";
import QuarterlyView from "./QuarterlyView";
import Header from "./Header";

const EMPTY_SCHEDULE = () =>
  Array(4).fill(null).map(() => ({
    fall: Array(3).fill(null),
    winter: Array(3).fill(null),
    spring: Array(3).fill(null),
  }));

const MainLayout = () => {
  const [currentPage, setCurrentPage] = useState("planner");
  const [parsedCourseData, setParsedCourseData] = useState({ sections: [], metadata: {} });
  const [plannerCourse, setPlannerCourse] = useState(null);

  // Schedule state lifted here so Header and ScheduleManager can access it
  const [schedule, setSchedule] = useState(EMPTY_SCHEDULE());
  const [currentScheduleId, setCurrentScheduleId] = useState(null);
  const [currentScheduleName, setCurrentScheduleName] = useState("My Schedule");
  const [savedSchedule, setSavedSchedule] = useState(null);

  // True when logged in and schedule differs from last save (or has never been saved)
  const hasUnsavedChanges =
    savedSchedule === null ||
    JSON.stringify(schedule) !== JSON.stringify(savedSchedule);

  const handleLoadSchedule = (id, name, grid) => {
    setSchedule(grid);
    setCurrentScheduleId(id);
    setCurrentScheduleName(name);
    setSavedSchedule(grid);
  };

  const renderPage = () => {
    switch (currentPage) {
      case "planner":
        return (
          <CoursePlannerContainer
            parsedCourseData={parsedCourseData}
            onCourseClick={setPlannerCourse}
            schedule={schedule}
            setSchedule={setSchedule}
          />
        );
      case "storage":
        return <CourseStorage />;
      case "quarter":
        return <QuarterlyView />;
      default:
        return (
          <CoursePlannerContainer
            parsedCourseData={parsedCourseData}
            onCourseClick={setPlannerCourse}
            schedule={schedule}
            setSchedule={setSchedule}
          />
        );
    }
  };

  return (
    <div className="flex h-screen">
      <LeftSidebar onParsedDataUpdate={setParsedCourseData} />
      <div className="flex flex-col flex-grow overflow-hidden">
        <Header
          currentScheduleName={currentScheduleName}
          setCurrentScheduleName={setCurrentScheduleName}
          hasUnsavedChanges={hasUnsavedChanges}
          schedule={schedule}
          currentScheduleId={currentScheduleId}
          setCurrentScheduleId={setCurrentScheduleId}
          setSavedSchedule={setSavedSchedule}
          onLoadSchedule={handleLoadSchedule}
        />
        <div className="flex-grow p-6 overflow-y-auto">
          {renderPage()}
        </div>
      </div>
      <RightSidebar plannerCourse={plannerCourse} parsedCourseData={parsedCourseData} />
    </div>
  );
};

export default MainLayout;
```

- [ ] **Step 2: Refactor CoursePlannerContainer to accept schedule/setSchedule as props**

Replace `mern/client/src/components/planner/CoursePlannerContainer.jsx` with:
```jsx
import { useEffect, useState } from "react";
import CoursePlanner from "./CoursePlanner";
import { processAuditForPlanner } from "../../utils/auditCoursePlanner";

const CoursePlannerContainer = ({
  parsedCourseData = { sections: [], metadata: {} },
  onCourseClick,
  schedule,
  setSchedule,
}) => {
  const [yearLabels] = useState([
    "2024-2025", "2025-2026", "2026-2027", "2027-2028",
  ]);
  const [collapsedYears, setCollapsedYears] = useState(Array(4).fill(false));
  const [previewState, setPreviewState] = useState(null);
  const [dragTarget, setDragTarget] = useState({ yearIndex: null, term: null, courseIndex: null });
  const [invalidDrop, setInvalidDrop] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!parsedCourseData.sections || parsedCourseData.sections.length === 0) return;
    const emptySchedule = Array(4).fill(null).map(() => ({
      fall: Array(3).fill(null),
      winter: Array(3).fill(null),
      spring: Array(3).fill(null),
    }));
    const updatedSchedule = processAuditForPlanner(parsedCourseData.sections, emptySchedule);
    setSchedule(updatedSchedule);
  }, [parsedCourseData]);

  const toggleYearCollapse = (yearIndex) => {
    const newState = [...collapsedYears];
    newState[yearIndex] = !newState[yearIndex];
    setCollapsedYears(newState);
  };

  const calculateTermUnits = (courses) =>
    courses.reduce((total, course) => total + (course ? course.credits : 0), 0);

  const calculateAnnualUnits = (yearIndex) => {
    const year = schedule[yearIndex];
    return (
      calculateTermUnits(year.fall) +
      calculateTermUnits(year.winter) +
      calculateTermUnits(year.spring)
    );
  };

  const handleDragStart = (e, course, isFromSidebar = false, yearIndex = null, term = null, courseIndex = null) => {
    e.dataTransfer.setData("course", JSON.stringify(course));
    e.dataTransfer.setData("isFromSidebar", isFromSidebar.toString());
    if (!isFromSidebar) {
      e.dataTransfer.setData("sourceYearIndex", yearIndex.toString());
      e.dataTransfer.setData("sourceTerm", term);
      e.dataTransfer.setData("sourceCourseIndex", courseIndex.toString());
    }
  };

  const handleDragOver = (e, yearIndex, term, courseIndex) => {
    e.preventDefault();
    setDragTarget({ yearIndex, term, courseIndex });
  };

  const handleDrop = (e, yearIndex, term, courseIndex) => {
    e.preventDefault();
    const courseData = e.dataTransfer.getData("course");
    const isFromSidebar = e.dataTransfer.getData("isFromSidebar") === "true";
    if (!courseData) return;
    const course = JSON.parse(courseData);
    const newSchedule = [...schedule];
    const targetYear = newSchedule[yearIndex];
    if (!targetYear || !targetYear[term]) return;
    const targetSlot = targetYear[term];
    const existingCourse = targetSlot[courseIndex];
    if (!isFromSidebar) {
      const sourceYearIndex = parseInt(e.dataTransfer.getData("sourceYearIndex"));
      const sourceTerm = e.dataTransfer.getData("sourceTerm");
      const sourceCourseIndex = parseInt(e.dataTransfer.getData("sourceCourseIndex"));
      if (sourceYearIndex === yearIndex && sourceTerm === term && sourceCourseIndex === courseIndex) return;
      if (existingCourse) {
        newSchedule[sourceYearIndex][sourceTerm][sourceCourseIndex] = existingCourse;
      } else {
        newSchedule[sourceYearIndex][sourceTerm][sourceCourseIndex] = null;
      }
    }
    targetSlot[courseIndex] = course;
    if (!targetSlot.some((c) => c === null)) targetSlot.push(null);
    setSchedule(newSchedule);
    setPreviewState(null);
  };

  const handleDragEnd = () => {
    setPreviewState(null);
    setInvalidDrop(false);
    setDragTarget({ yearIndex: null, term: null, courseIndex: null });
  };

  const handleRemoveCourse = (yearIndex, term, courseIndex) => {
    const newSchedule = [...schedule];
    const termCourses = newSchedule[yearIndex][term];
    termCourses[courseIndex] = null;
    const nullCount = termCourses.filter((c) => c === null).length;
    if (termCourses.length > 3 && nullCount > 1) {
      const trimmed = termCourses.filter((c) => c !== null);
      while (trimmed.length < 2) trimmed.push(null);
      trimmed.push(null);
      newSchedule[yearIndex][term] = trimmed;
    }
    setSchedule(newSchedule);
  };

  const getSlotClassName = (yearIndex, term, courseIndex) => {
    let className = "border rounded mb-2 p-2 ";
    if (
      dragTarget.yearIndex === yearIndex &&
      dragTarget.term === term &&
      dragTarget.courseIndex === courseIndex
    ) {
      className += invalidDrop
        ? "border-red-500 border-2 bg-red-50 "
        : "border-blue-500 border-2 bg-blue-50 ";
    }
    if (
      previewState &&
      previewState.targetYearIndex === yearIndex &&
      previewState.targetTerm === term &&
      previewState.targetCourseIndex === courseIndex
    ) {
      className += "border-yellow-400 border-2 bg-yellow-50 ";
    }
    return className;
  };

  const handleExportToSheets = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/export/google-sheets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule, yearLabels }),
      });
      const data = await response.json();
      if (data.success) {
        window.open(data.url, "_blank");
        alert("Schedule exported successfully! Opening Google Sheets...");
      } else {
        alert(`Export failed: ${data.error}`);
      }
    } catch {
      alert("Failed to export schedule. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <CoursePlanner
        schedule={schedule}
        yearLabels={yearLabels}
        collapsedYears={collapsedYears}
        toggleYearCollapse={toggleYearCollapse}
        calculateAnnualUnits={calculateAnnualUnits}
        calculateTermUnits={calculateTermUnits}
        handleDragStart={handleDragStart}
        handleDragEnd={handleDragEnd}
        handleDragOver={handleDragOver}
        handleDrop={handleDrop}
        handleRemoveCourse={handleRemoveCourse}
        previewState={previewState}
        dragTarget={dragTarget}
        invalidDrop={invalidDrop}
        getSlotClassName={getSlotClassName}
        onExportToSheets={handleExportToSheets}
        loading={loading}
        onCourseClick={onCourseClick}
      />
    </div>
  );
};

export default CoursePlannerContainer;
```

- [ ] **Step 3: Verify planner still works**

Open `http://localhost:5173`. Drag a course from the right sidebar to the planner grid. Expected: course appears in the slot, drag-and-drop behaves identically to before.

- [ ] **Step 4: Commit**

```bash
git add mern/client/src/components/MainLayout.jsx mern/client/src/components/planner/CoursePlannerContainer.jsx
git commit -m "refactor: lift schedule state to MainLayout"
```

---

### Task 5: useSchedules hook

**Files:**
- Create: `mern/client/src/hooks/useSchedules.js`

- [ ] **Step 1: Create useSchedules.js**

Create `mern/client/src/hooks/useSchedules.js`:
```js
import { useState, useEffect } from "react";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";

const useSchedules = () => {
  const { currentUser } = useAuth();
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(false);

  const getRef = () =>
    currentUser ? collection(db, "users", currentUser.uid, "schedules") : null;

  const fetchSchedules = async () => {
    const ref = getRef();
    if (!ref) return;
    setLoading(true);
    try {
      const q = query(ref, orderBy("updatedAt", "desc"));
      const snap = await getDocs(q);
      setSchedules(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, [currentUser]);

  // Creates or updates a schedule. Returns the document id.
  const saveSchedule = async (name, grid, existingId = null) => {
    const ref = getRef();
    if (!ref) throw new Error("Not signed in");
    const docRef = existingId ? doc(ref, existingId) : doc(ref);
    await setDoc(
      docRef,
      {
        name,
        schedule: grid,
        updatedAt: serverTimestamp(),
        ...(existingId ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );
    await fetchSchedules();
    return docRef.id;
  };

  const renameSchedule = async (id, newName) => {
    const ref = getRef();
    if (!ref) return;
    await updateDoc(doc(ref, id), { name: newName, updatedAt: serverTimestamp() });
    setSchedules((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: newName } : s))
    );
  };

  const deleteSchedule = async (id) => {
    const ref = getRef();
    if (!ref) return;
    await deleteDoc(doc(ref, id));
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  };

  return { schedules, loading, saveSchedule, renameSchedule, deleteSchedule, fetchSchedules };
};

export default useSchedules;
```

- [ ] **Step 2: Commit**

```bash
git add mern/client/src/hooks/useSchedules.js
git commit -m "feat: add useSchedules hook for Firestore CRUD"
```

---

### Task 6: ScheduleManager modal

**Files:**
- Create: `mern/client/src/components/schedules/ScheduleManager.jsx`

- [ ] **Step 1: Create ScheduleManager.jsx**

Create `mern/client/src/components/schedules/ScheduleManager.jsx`:
```jsx
import { useState } from "react";
import useSchedules from "../../hooks/useSchedules";

const ScheduleManager = ({ onLoad, onClose, currentScheduleId }) => {
  const { schedules, loading, renameSchedule, deleteSchedule } = useSchedules();
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const handleLoad = (s) => {
    onLoad(s.id, s.name, s.schedule);
    onClose();
  };

  const handleRenameStart = (s) => {
    setRenamingId(s.id);
    setRenameValue(s.name);
  };

  const handleRenameSubmit = async (id) => {
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
                  onBlur={() => handleRenameSubmit(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameSubmit(s.id);
                    if (e.key === "Escape") setRenamingId(null);
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
            onClick={onClose}
            style={{ fontSize: "12px", color: "#64748b", background: "none", border: "none", cursor: "pointer" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScheduleManager;
```

- [ ] **Step 2: Commit**

```bash
git add mern/client/src/components/schedules/ScheduleManager.jsx
git commit -m "feat: add ScheduleManager modal"
```

---

### Task 7: Wire Header

**Files:**
- Modify: `mern/client/src/components/Header.jsx`

- [ ] **Step 1: Replace Header.jsx**

Replace `mern/client/src/components/Header.jsx` with:
```jsx
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
```

- [ ] **Step 2: Verify header when logged out**

Open `http://localhost:5173`. Expected: header shows logo + "Sign in with Google" button. No schedule controls visible.

- [ ] **Step 3: Sign in and verify header controls appear**

Click "Sign in with Google", complete the popup. Expected: schedule name input + Save button + My Schedules button appear in the center of the header. Google profile photo shown on the right.

- [ ] **Step 4: Commit**

```bash
git add mern/client/src/components/Header.jsx
git commit -m "feat: wire Header with save, schedule manager, and sign-in"
```

---

### Task 8: Firestore security rules

**Files:**
- Create: `firestore.rules` (at repo root `/Users/davidli/AIVac/`)

- [ ] **Step 1: Create firestore.rules**

Create `/Users/davidli/AIVac/firestore.rules`:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

- [ ] **Step 2: Install Firebase CLI and deploy rules**

```bash
npm install -g firebase-tools
firebase login
firebase use --add
```
Select your project when prompted. Then deploy:
```bash
firebase deploy --only firestore:rules
```
Expected: `✔  firestore: released rules`

- [ ] **Step 3: Verify rules in Firebase console**

Firebase console → Firestore → Rules tab. Confirm the deployed rules match the file.

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -m "feat: add Firestore security rules"
```

---

### Task 9: End-to-end verification

No new files — manual test walkthrough.

- [ ] **Step 1: Test save flow**

1. Sign in with Google
2. Drag 3 courses into the planner grid
3. Save button in header should be blue ("Save")
4. Click Save — button shows "Saving…" briefly then "Saved"
5. In Firebase console → Firestore → `users/{uid}/schedules` — confirm a document exists with `name`, `schedule`, `createdAt`, `updatedAt` fields

- [ ] **Step 2: Test load flow**

1. Refresh the page — schedule grid is empty (no auto-load on refresh, expected)
2. Click "My Schedules" — modal opens listing the saved schedule
3. Click Load — grid populates with the saved courses, header shows the schedule name
4. Save button shows "Saved" (no unsaved changes)

- [ ] **Step 3: Test multiple schedules**

1. Drag different courses, change the name in the header input to "Plan B", click Save
2. Open "My Schedules" — two schedules listed
3. Load "My Schedule" (first one) — grid changes back to original courses

- [ ] **Step 4: Test rename**

1. Open "My Schedules", click Rename on a schedule
2. Type a new name, press Enter
3. Name updates in the list

- [ ] **Step 5: Test delete**

1. Click Delete on a schedule — button turns red "Confirm"
2. Click Confirm — schedule removed from list

- [ ] **Step 6: Test unsaved changes indicator**

1. Save a schedule (Save button shows "Saved")
2. Drag a new course into the grid — Save button turns blue "Save"
3. Click Save — returns to "Saved"

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete schedule saving with Google OAuth and Firestore"
```
